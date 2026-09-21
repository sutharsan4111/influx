const { ClientSecretCredential } = require('@azure/identity');
const https = require('https');

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

let credential = null;

function getCredential() {
  if (!credential) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET must be set in environment');
    }
    credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
  }
  return credential;
}

async function getToken() {
  const cred = getCredential();
  const tokenResponse = await cred.getToken('https://management.azure.com/.default');
  return tokenResponse.token;
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    }).on('error', reject);
  });
}

// Azure Resource Manager list endpoints page results via `nextLink` once a subscription has
// enough resources. The previous implementation only ever read page 1, which (depending on
// tenant size) could silently drop items. This follows nextLink until exhausted.
async function httpsGetAllPages(url, token) {
  let results = [];
  let nextUrl = url;
  let guard = 0;
  while (nextUrl && guard < 50) {
    const response = await httpsGet(nextUrl, token);
    results = results.concat(response.value || []);
    nextUrl = response.nextLink || null;
    guard++;
  }
  return results;
}

// Runs `fn` over `items` with at most `limit` in flight at once. Recovery-point lookups are
// one HTTP call per protected item — across a few hundred items that's enough concurrent
// requests to trigger Azure ARM throttling (429s), which paradoxically makes collection
// *slower* because each throttled call sits and retries. Capping concurrency keeps us under
// the throttle limit while still being far faster than doing them one at a time.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function listAllSubscriptions(token) {
  const url = 'https://management.azure.com/subscriptions?api-version=2020-01-01';
  return httpsGetAllPages(url, token);
}

// Falls back to vaults seen in the most recent successful report (passed in by the
// caller, which reads it from Postgres) when the live vault-listing API call comes
// back empty \u2014 e.g. a transient ARM permissions/throttling issue.
function knownVaultsFromLatestReport(subscriptionName, subscriptionId, knownRecords) {
  try {
    const records = Array.isArray(knownRecords) ? knownRecords : [];
    const byKey = new Map();

    for (const record of records) {
      const matchesSubscription = [record.SubscriptionName, record.SubscriptionId, record.SubscriptionID]
        .filter(Boolean)
        .some(value => String(value).toLowerCase() === String(subscriptionName || subscriptionId).toLowerCase() || String(value).toLowerCase() === String(subscriptionId).toLowerCase());
      if (!matchesSubscription || !record.VaultName || !record.ResourceGroup || record.VaultName === 'N/A') continue;

      const key = `${record.ResourceGroup}/${record.VaultName}`.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: `/subscriptions/${subscriptionId}/resourceGroups/${record.ResourceGroup}/providers/Microsoft.RecoveryServices/vaults/${record.VaultName}`,
          name: record.VaultName,
          resourceGroup: record.ResourceGroup
        });
      }
    }

    const vaults = [...byKey.values()];
    if (vaults.length) {
      console.log(`[AZ-SDK]   Using ${vaults.length} known vault(s) from the last report`);
    }
    return vaults;
  } catch (e) {
    console.warn(`[AZ-SDK] Cannot read known vault fallback: ${e.message}`);
    return [];
  }
}

function resourceGroupFromId(id) {
  const match = /\/resourceGroups\/([^/]+)/i.exec(id || '');
  return match ? decodeURIComponent(match[1]) : '';
}

async function listResourcesByType(token, subscriptionId, resourceType) {
  const filter = encodeURIComponent(`resourceType eq '${resourceType}'`);
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resources?$filter=${filter}&api-version=2021-04-01`;
  try {
    const resources = await httpsGetAllPages(url, token);
    return resources.map(resource => ({
      ...resource,
      resourceGroup: resource.resourceGroup || resourceGroupFromId(resource.id)
    }));
  } catch (e) {
    console.warn(`[AZ-SDK] Cannot list ${resourceType} resources for sub ${subscriptionId}: ${e.message}`);
    return [];
  }
}

async function listVaultsForSubscription(token, subscriptionId) {
  try {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.RecoveryServices/vaults?api-version=2023-04-01`;
    const vaults = await httpsGetAllPages(url, token);
    if (vaults.length) return vaults.map(vault => ({ ...vault, resourceGroup: vault.resourceGroup || resourceGroupFromId(vault.id) }));
  } catch (e) {
    console.warn(`[AZ-SDK] Cannot list vaults for sub ${subscriptionId}: ${e.message}`);
  }
  return listResourcesByType(token, subscriptionId, 'Microsoft.RecoveryServices/vaults');
}

// The Recovery Services API version that actually works is consistent for a given tenant/region
// combo. Trying 3 versions sequentially on *every single call* (per vault, per item) is what was
// adding most of the 20-25s. We remember whichever version succeeds first and try that one only
// on subsequent calls, falling back to the full list only if it ever stops working.
const BACKUP_API_VERSIONS = ['2023-02-01', '2024-04-01', '2024-10-01'];
let workingBackupItemsApiVersion = null;
let workingRecoveryPointsApiVersion = null;

async function listBackupProtectedItems(token, subscriptionId, resourceGroup, vaultName) {
  const baseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.RecoveryServices/vaults/${vaultName}/backupProtectedItems`;
  const versionsToTry = workingBackupItemsApiVersion
    ? [workingBackupItemsApiVersion, ...BACKUP_API_VERSIONS.filter(v => v !== workingBackupItemsApiVersion)]
    : BACKUP_API_VERSIONS;

  for (const apiVersion of versionsToTry) {
    try {
      const items = await httpsGetAllPages(`${baseUrl}?api-version=${apiVersion}`, token);
      workingBackupItemsApiVersion = apiVersion;
      return items;
    } catch (e) {
      console.warn(`[AZ-SDK] Cannot list backup items for ${vaultName} with ${apiVersion}: ${e.message}`);
    }
  }
  return [];
}

async function listRecoveryPointsForBackupItem(token, item) {
  const itemId = item?.id || '';
  const itemName = item?.name || 'Unknown';
  if (!itemId) return [];

  const versionsToTry = workingRecoveryPointsApiVersion
    ? [workingRecoveryPointsApiVersion, ...BACKUP_API_VERSIONS.filter(v => v !== workingRecoveryPointsApiVersion)]
    : BACKUP_API_VERSIONS;

  for (const apiVersion of versionsToTry) {
    try {
      const points = await httpsGetAllPages(`https://management.azure.com${itemId}/recoveryPoints?api-version=${apiVersion}`, token);
      workingRecoveryPointsApiVersion = apiVersion;
      return points;
    } catch (e) {
      console.warn(`[AZ-SDK] Cannot list recovery points for ${itemName} with ${apiVersion}: ${e.message}`);
    }
  }
  return [];
}

async function listStorageAccounts(token, subscriptionId) {
  try {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`;
    const accounts = await httpsGetAllPages(url, token);
    if (accounts.length) return accounts.map(account => ({ ...account, resourceGroup: account.resourceGroup || resourceGroupFromId(account.id) }));
  } catch (e) {
    console.warn(`[AZ-SDK] Cannot list storage accounts for sub ${subscriptionId}: ${e.message}`);
  }
  return listResourcesByType(token, subscriptionId, 'Microsoft.Storage/storageAccounts');
}

async function listFileSharesInStorageAccount(token, subscriptionId, resourceGroup, storageAccountName) {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}/fileServices/default/shares?api-version=2023-01-01`;
  try {
    return await httpsGetAllPages(url, token);
  } catch (e) {
    console.warn(`[AZ-SDK] Cannot list file shares for ${storageAccountName}: ${e.message}`);
    return [];
  }
}

async function listFileShareSnapshots(token, subscriptionId, resourceGroup, storageAccountName, fileShareName) {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}/fileServices/default/shares/${fileShareName}/snapshots?api-version=2023-01-01`;
  try {
    const response = await httpsGet(url, token);
    return response.value || [];
  } catch (e) {
    return [];
  }
}

function statusFromProtectionState(state) {
  const s = (state || '').toLowerCase();
  if (s === 'protected' || s === 'irpending' || s === 'backupupfront') return 'Healthy';
  if (s === 'unprotected' || s === 'protectionstopped') return 'Warning';
  if (s === 'protectionerror') return 'Failed';
  return 'Warning';
}

function consistencyFromHealth(health) {
  const h = (health || '').toLowerCase();
  if (h.includes('application')) return 'Application Consistent';
  if (h.includes('file')) return 'File-System Consistent';
  if (h.includes('crash') || h === 'invalid' || !h) return 'Crash Consistent';
  if (h === 'passed' || h === 'success' || h === 'succeeded' || h === 'healthy') return 'N/A';
  return health || 'N/A';
}

function consistencyFromRecoveryPoint(recoveryPoint) {
  const props = recoveryPoint?.properties || {};
  const text = [
    props.recoveryPointType,
    props.consistencyType,
    props.recoveryPointAdditionalInfo,
    props.recoveryPointProperties
  ].filter(Boolean).join(' ').toLowerCase();

  if (text.includes('appconsistent') || text.includes('application')) return 'Application Consistent';
  if (text.includes('crashconsistent') || text.includes('crash')) return 'Crash Consistent';
  if (text.includes('filesystemconsistent') || text.includes('file-system') || text.includes('file system')) return 'File-System Consistent';
  return '';
}

function recoveryTypeFromRecoveryPoint(recoveryPoint, fallback) {
  const props = recoveryPoint?.properties || {};
  const tierText = JSON.stringify(props.recoveryPointTierDetails || props.tierDetails || []);
  const combined = `${props.recoveryPointTierType || ''} ${props.recoveryPointType || ''} ${tierText} ${fallback || ''}`.toLowerCase();
  const hasSnapshot = combined.includes('snapshot') || combined.includes('instant');
  const hasVault = combined.includes('vault') || combined.includes('hardened') || combined.includes('standard');

  if (hasSnapshot && hasVault) return 'Snapshot and Vault-Standard';
  if (hasSnapshot) return 'Snapshot';
  if (hasVault) return 'Vault-Standard';
  return fallback || 'N/A';
}

function recoveryPointTime(recoveryPoint) {
  const props = recoveryPoint?.properties || {};
  return props.recoveryPointTime || props.recoveryPointTimeInUTC || props.recoveryPointTimeInUtc || props.creationTime || props.createdTime || '';
}

function latestRecoveryPoint(recoveryPoints) {
  return [...(recoveryPoints || [])]
    .filter(rp => recoveryPointTime(rp))
    .sort((a, b) => new Date(recoveryPointTime(b)) - new Date(recoveryPointTime(a)))[0] || null;
}

function getItemType(item) {
  const props = item.properties || {};
  const mgmtType = (props.backupManagementType || '').toLowerCase();
  const itemType = (item.type || '').toLowerCase();
  const itemName = (item.name || '').toLowerCase();
  
  if (mgmtType === 'azurestorage' || itemType.includes('azurefileshare') || itemType.includes('fileshare') || itemName.startsWith('azurefileshare;')) {
    return 'File Share';
  }
  if (mgmtType === 'azureiaasvm' || mgmtType === 'iaasvm' || itemType.includes('virtualmachine') || itemName.startsWith('vm;')) {
    return 'Azure VM';
  }
  return 'Azure VM';
}

// Vault-protected file share items are named like "AzureFileShare;<storageAccountName>;<fileShareName>"
// (mirroring the "vm;iaasvmcontainer;<vmName>" pattern for VMs). Previously the code passed the
// *Recovery Services vault's* name in as the "storage account" for these records, and the storage
// native-snapshot scan used the *real* storage account name — so the same file share ended up
// tagged with two different storage account values and never matched during dedup. This parses the
// real identity directly off the raw item name so both collection paths agree.
function parseFileShareIdentity(item) {
  const raw = String(item?.name || item?.id?.split('/').pop() || '');
  const parts = raw.split(';').filter(Boolean);
  if (parts.length >= 3 && parts[0].toLowerCase() === 'azurefileshare') {
    return { storageAccountName: parts[1], fileShareName: parts[parts.length - 1] };
  }
  // Fallback: pull the storage account name out of the protection container segment of the id,
  // e.g. .../protectionContainers/StorageContainer;Storage;<storageAccountName>/protectedItems/...
  const containerMatch = /protectionContainers\/StorageContainer;[^/]*;([^/]+)\//i.exec(item?.id || '');
  return {
    storageAccountName: containerMatch ? containerMatch[1] : '',
    fileShareName: parts[parts.length - 1] || raw
  };
}

function getResourceName(item, itemType) {
  const props = item.properties || {};
  const rawName = item.name || item.id?.split('/').pop() || 'Unknown';
  const friendlyName = props.friendlyName || props.protectedItemDataSourceId?.split('/').pop();

  if (friendlyName && !String(friendlyName).includes(';')) return friendlyName;
  if (itemType === 'Azure VM' && rawName.toLowerCase().startsWith('vm;')) {
    return rawName.split(';').filter(Boolean).pop() || rawName;
  }
  return rawName;
}

function convertToBackupRecord(item, vault, subscriptionName, subscriptionId, latestRp = null, storageAccountName = null) {
  const props = item.properties || {};
  const rpTime = recoveryPointTime(latestRp);
  const lastBackup = rpTime ? new Date(rpTime) : props.lastBackupTime ? new Date(props.lastBackupTime) : null;
  const now = new Date();
  const ageHours = lastBackup ? Math.round((now - lastBackup) / 3600000) : -1;
  const protectionState = props.protectionState || 'N/A';
  const status = statusFromProtectionState(protectionState);
  const itemType = getItemType(item);
  const recoveryPointConsistency = consistencyFromRecoveryPoint(latestRp);
  const consistency = recoveryPointConsistency || consistencyFromHealth(props.healthStatus);
  const itemName = getResourceName(item, itemType);
  const rawItemName = item.name || item.id?.split('/').pop() || 'Unknown';
  const recoveryType = recoveryTypeFromRecoveryPoint(
    latestRp,
    itemType === 'File Share' ? 'Snapshot' : 'Snapshot and Vault-Standard'
  );

  const actualStorageAccount = storageAccountName || (itemType === 'File Share' ? vault.name : '');

  const baseRecord = {
    TenantId: TENANT_ID || '',
    TenantName: '',
    SubscriptionName: subscriptionName || subscriptionId,
    ResourceGroup: vault.resourceGroup || 'N/A',
    VaultName: vault.name || 'N/A',
    BackupType: itemType,
    ResourceName: itemName,
    RawResourceName: rawItemName,
    BackupStatus: status,
    LastBackupStatus: props.lastBackupStatus || 'N/A',
    PreBackupStatus: props.lastBackupStatus || 'N/A',
    ConsistencyType: consistency,
    RecoveryType: recoveryType,
    LatestRPTime: lastBackup ? lastBackup.toISOString() : 'N/A',
    LastBackupTime: lastBackup ? lastBackup.toISOString() : 'N/A',
    BackupAge: ageHours >= 0 ? `${ageHours}h ago` : 'N/A',
    BackupAgeHours: ageHours,
    PolicyName: props.policyName || 'N/A',
    ProtectionState: protectionState,
    StorageAccount: actualStorageAccount
  };

  if (itemType === 'File Share') {
    baseRecord.ConsistencyType = 'File-System Consistent';
    baseRecord.RecoveryType = 'Snapshot';
  }

  return baseRecord;
}

const RECOVERY_POINT_FETCH_CONCURRENCY = 15;

async function collectVaultRecords(accessToken, subId, subName, vault) {
  const vaultName = vault.name;
  const rg = vault.resourceGroup || resourceGroupFromId(vault.id);
  console.log(`[AZ-SDK]   Vault: ${vaultName} (rg: ${rg})`);

  const items = await listBackupProtectedItems(accessToken, subId, rg, vaultName);
  console.log(`[AZ-SDK]     ${items.length} backup item(s)`);

  // Fetch recovery points with bounded concurrency (unbounded Promise.all across hundreds of
  // items triggers Azure ARM throttling, which ends up slower overall than a sane concurrency cap).
  return mapWithConcurrency(items, RECOVERY_POINT_FETCH_CONCURRENCY, async (item) => {
    const recoveryPoints = await listRecoveryPointsForBackupItem(accessToken, item);
    const latestRp = latestRecoveryPoint(recoveryPoints);
    const itemType = getItemType(item);
    const storageAccountName = itemType === 'File Share'
      ? (parseFileShareIdentity(item).storageAccountName || vaultName)
      : null;
    const record = convertToBackupRecord(item, { name: vaultName, resourceGroup: rg }, subName, subId, latestRp, storageAccountName);
    return record;
  });
}

async function collectStorageAccountRecords(accessToken, subId, subName, sa) {
  const saName = sa.name;
  const saRg = sa.resourceGroup || resourceGroupFromId(sa.id);
  console.log(`[AZ-SDK]   Storage Account: ${saName} (rg: ${saRg})`);

  const fileShares = await listFileSharesInStorageAccount(accessToken, subId, saRg, saName);
  console.log(`[AZ-SDK]     ${fileShares.length} file share(s)`);

  const records = await mapWithConcurrency(fileShares, RECOVERY_POINT_FETCH_CONCURRENCY, async (fs) => {
    const fsName = fs.name;
    const snapshots = await listFileShareSnapshots(accessToken, subId, saRg, saName, fsName);
    const latestSnapshot = snapshots.length > 0
      ? snapshots.sort((a, b) => new Date(b.properties.snapshotTime) - new Date(a.properties.snapshotTime))[0]
      : null;

    const lastBackupTime = latestSnapshot ? latestSnapshot.properties.snapshotTime : null;

    // A file share with zero snapshots was never actually backed up via this native-snapshot
    // path — it's just a share that happens to live in the storage account (very common with
    // Kubernetes/CSI dynamic provisioning, which leaves orphaned "pvc-..." shares behind after
    // volumes are deleted). Azure's own Backup Center doesn't count these, so neither should we;
    // including them was the main source of the inflated totals.
    if (!lastBackupTime) return null;

    const now = new Date();
    const ageHours = Math.round((now - new Date(lastBackupTime)) / 3600000);

    return {
      TenantId: TENANT_ID || '',
      TenantName: '',
      SubscriptionName: subName,
      ResourceGroup: saRg,
      VaultName: saName,
      BackupType: 'File Share',
      ResourceName: fsName,
      RawResourceName: `AzureFileShare;${saName};${fsName}`,
      BackupStatus: 'Healthy',
      LastBackupStatus: 'Completed',
      PreBackupStatus: 'Succeeded',
      ConsistencyType: 'File-System Consistent',
      RecoveryType: 'Snapshot',
      LatestRPTime: lastBackupTime,
      LastBackupTime: lastBackupTime,
      BackupAge: `${ageHours}h ago`,
      BackupAgeHours: ageHours,
      PolicyName: 'Native Snapshot',
      ProtectionState: 'Protected',
      StorageAccount: saName
    };
  });

  return records.filter(Boolean);
}

async function collectSubscriptionRecords(accessToken, sub, knownRecords) {
  const subId = sub.subscriptionId;
  const subName = sub.displayName || subId;
  console.log(`[AZ-SDK] Processing subscription: ${subName} (${subId})`);

  let vaults = await listVaultsForSubscription(accessToken, subId);
  if (!vaults.length) {
    vaults = knownVaultsFromLatestReport(subName, subId, knownRecords);
  }
  console.log(`[AZ-SDK]   Found ${vaults.length} Recovery Services vault(s)`);

  // Vault-backed items and storage-account native snapshots are independent of each other —
  // fetch both concurrently instead of one phase after the other.
  const [vaultResults, storageAccounts] = await Promise.all([
    Promise.all(vaults.map(vault => collectVaultRecords(accessToken, subId, subName, vault))),
    listStorageAccounts(accessToken, subId)
  ]);
  console.log(`[AZ-SDK]   Found ${storageAccounts.length} storage account(s)`);

  const saResults = await Promise.all(
    storageAccounts.map(sa => collectStorageAccountRecords(accessToken, subId, subName, sa))
  );

  return [...vaultResults.flat(), ...saResults.flat()];
}

async function collectAzureBackupData(token, knownRecords = []) {
  const accessToken = token || await getToken();
  console.log('[AZ-SDK] Starting Azure backup collection via REST API');

  const subs = await listAllSubscriptions(accessToken);
  console.log(`[AZ-SDK] Found ${subs.length} subscription(s)`);

  // Subscriptions are independent — collect all of them concurrently. Rate-limit protection
  // now happens at the recovery-point/snapshot fetch level (mapWithConcurrency) instead of by
  // serializing whole subscriptions, which is what was making this take 20-25s.
  const subResults = await Promise.all(subs.map(sub => collectSubscriptionRecords(accessToken, sub, knownRecords)));
  const allRecords = subResults.flat();

  console.log(`[AZ-SDK] Total records collected: ${allRecords.length}`);
  return allRecords;
}

// Deduplicate file shares that appear both in vault backup and storage account native snapshots.
//
// Root cause of the old duplicates: vault-sourced records used the *vault's* resource group and
// the *vault's* name as the "storage account", while native-snapshot records used the storage
// account's own resource group and real name. Same file share, two different keys, both survived
// dedup. Vault items now carry the real storage account name (parsed off the raw item name in
// collectVaultRecords), so both sources agree and this key actually matches.
function fileShareDedupeKey(record) {
  const raw = String(record.RawResourceName || record.ResourceName || '').toLowerCase();
  const parts = raw.split(';').filter(Boolean);
  const shareName = (parts[parts.length - 1] || raw).toLowerCase();
  const storageAccount = String(record.StorageAccount || '').toLowerCase();
  return `${record.SubscriptionName}:${storageAccount}:${shareName}`.toLowerCase();
}

function deduplicateFileShares(records) {
  const seen = new Map();
  const deduped = [];

  for (const record of records) {
    const isFileShare = record.BackupType === 'File Share' ||
      (record.ResourceName && record.ResourceName.toLowerCase().startsWith('azurefileshare;')) ||
      (record.RawResourceName && record.RawResourceName.toLowerCase().startsWith('azurefileshare;'));

    if (!isFileShare) {
      deduped.push(record);
      continue;
    }

    const key = fileShareDedupeKey(record);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, record);
      deduped.push(record);
      continue;
    }

    // Prefer the vault-managed backup record over the native-snapshot fallback regardless of
    // recency, since it carries the real policy/status data. Only fall back to "newest wins"
    // when both records are the same kind.
    const existingIsNative = existing.PolicyName === 'Native Snapshot';
    const currentIsNative = record.PolicyName === 'Native Snapshot';
    let replace;
    if (existingIsNative !== currentIsNative) {
      replace = existingIsNative && !currentIsNative;
    } else {
      const existingTime = new Date(existing.LatestRPTime || 0).getTime();
      const newTime = new Date(record.LatestRPTime || 0).getTime();
      replace = newTime > existingTime;
    }

    if (replace) {
      seen.set(key, record);
      const idx = deduped.indexOf(existing);
      if (idx >= 0) deduped[idx] = record;
    }
  }

  console.log(`[AZ-SDK] After deduplication: ${deduped.length} records (removed ${records.length - deduped.length} duplicate file shares)`);
  return deduped;
}

module.exports = { collectAzureBackupData, deduplicateFileShares };
