#Requires -Version 5.1
<#
.SYNOPSIS
    Azure Backup Monitor v5.2 - Token-Cached, MFA-Resilient HTML Dashboard

.DESCRIPTION
    Fully automated backup monitoring across ALL tenants, subscriptions, resource
    groups, and Recovery Services Vaults. Zero manual input required.

    FIXES IN v5.2 over v5.1:
      ► BUG 1 — CRITICAL: Cache-hit path skipped context switch validation.
        If in-memory cache said "valid" but the real MSAL token had expired
        (e.g. ran >45 min), Invoke-SilentContextSwitch was never called, the
        PowerShell context remained on the PREVIOUS tenant, and all API calls
        silently targeted the wrong tenant.
        FIX: Cache hit now always calls Invoke-SilentContextSwitch to set the
        correct tenant context, and falls through to interactive auth if that
        switch fails (invalidates stale cache entry automatically).

      ► BUG 2 — Invoke-PostConnectSetup added empty TenantId key to $ctxParams
        hashtable when $TenantId was an empty string, causing Set-AzContext to
        throw "Cannot bind parameter TenantId" on some Az module versions.
        FIX: Only add TenantId to $ctxParams when the string is non-empty.

      ► BUG 3 — WarningPreference not restored on exception.
        Several code blocks set $WarningPreference = 'SilentlyContinue' and
        restored it manually, but a thrown exception would skip the restore
        line, permanently suppressing warnings for the rest of the session.
        FIX: All WarningPreference changes now use try/finally blocks.

      ► BUG 4 — Fallback-2 token refresh (stale management token) invalidated
        the cache entry for the current tenant but did not reset the loop state,
        so the next tenant iteration could re-enter the stale-cache branch if
        the previous refresh re-populated the cache for the same key.
        FIX: After refresh and re-authentication, Set-TokenCacheValid is called
        only after a confirmed successful Invoke-PostConnectSetup; the Remove
        call is kept as a guard so a failed refresh leaves the cache clean.

      ► BUG 5 — Invoke-PostConnectSetup: when Get-AzSubscription (no -TenantId)
        returned results but the subsequent Set-AzContext failed silently, the
        function returned $true giving a false-positive "token valid" signal.
        FIX: Set-AzContext call is now wrapped with ErrorAction Stop and the
        return value is $false if it throws.

      ► SAFETY: Confirmed all cmdlets are strictly read-only (Get-* only).
        No Add-, Set-, New-, Remove-, or Update- calls touch any resource.
        Set-AzContext and Set-AzRecoveryServicesVaultContext are PowerShell
        session-state operations only — they make no changes in Azure.

.NOTES
    Requirements  : PowerShell 5.1, Az.Accounts >= 2.12, Az.RecoveryServices, Az.Resources
    Authentication: MFA login is the only interactive step; all discovery is automated
    Safety        : READ-ONLY MODE — Zero resource modifications
    Version       : 5.2
#>

Set-StrictMode -Off   # Keep off — strict mode breaks some Az module property probes

# =============================================================================
# REGION: CONFIGURATION
# =============================================================================

$Script:Config = @{
    OutputDir           = $(
        $sys32 = [System.IO.Path]::Combine($env:SystemRoot, 'system32')
        if ($env:AZURE_BACKUP_REPORT_DIR) {
            $env:AZURE_BACKUP_REPORT_DIR
        } elseif ($PSScriptRoot -and (Test-Path $PSScriptRoot -ErrorAction SilentlyContinue) -and $PSScriptRoot -ne $sys32) {
            $PSScriptRoot
        } else {
            [System.Environment]::GetFolderPath('MyDocuments')
        }
    )
    MaxRetryCount        = 2
    RetryDelaySeconds    = 3
    FetchRecoveryPoints  = $true
    # 45 min is a safe conservative TTL (Azure access tokens last 60-90 min).
    # The in-memory cache prevents repeated MSAL probes within a single run.
    # NOTE (v5.2): a cache HIT still validates the PS context per tenant to
    # prevent silent cross-tenant token mismatch (see BUG 1 fix above).
    TokenCacheTTLMinutes = 45
}

$Script:RunTimestamp             = Get-Date -Format 'yyyyMMdd_HHmmss'
$Script:Config.ReportOutputPath  = Join-Path $Script:Config.OutputDir ("AzureBackupReport_"  + $Script:RunTimestamp + ".html")
$Script:Config.LogOutputPath     = Join-Path $Script:Config.OutputDir ("AzureBackupMonitor_" + $Script:RunTimestamp + ".log")

# In-memory token validity cache: key=TenantId, value=[datetime]UtcNow at last confirmation
$Script:TokenCache = @{}

if (-not (Test-Path $Script:Config.OutputDir)) {
    New-Item -ItemType Directory -Path $Script:Config.OutputDir -Force | Out-Null
}

# =============================================================================
# REGION: LOGGING
# =============================================================================

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO','WARN','ERROR','SUCCESS','SECTION')]
        [string]$Level = 'INFO'
    )
    $ts      = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $logLine = "[$ts] [$Level] $Message"
    switch ($Level) {
        'INFO'    { Write-Host $logLine -ForegroundColor Cyan    }
        'WARN'    { Write-Host $logLine -ForegroundColor Yellow  }
        'ERROR'   { Write-Host $logLine -ForegroundColor Red     }
        'SUCCESS' { Write-Host $logLine -ForegroundColor Green   }
        'SECTION' { Write-Host $logLine -ForegroundColor Magenta }
    }
    $logLine | Out-File -FilePath $Script:Config.LogOutputPath -Append -Encoding UTF8
}

# =============================================================================
# REGION: PREREQUISITES
# =============================================================================

function Test-Prerequisites {
    Write-Log "Checking prerequisites..." -Level INFO
    $required = @('Az.Accounts', 'Az.RecoveryServices', 'Az.Resources')
    $missing  = @()
    foreach ($mod in $required) {
        if (-not (Get-Module -ListAvailable -Name $mod)) { $missing += $mod }
    }
    if ($missing.Count -gt 0) {
        Write-Log "Missing modules: $($missing -join ', ')" -Level ERROR
        throw "Install missing Az modules: Install-Module Az -Scope CurrentUser -Force"
    }

    $acctMod = Get-Module -ListAvailable -Name Az.Accounts |
               Sort-Object Version -Descending | Select-Object -First 1
    if ($acctMod -and $acctMod.Version -lt [version]'2.12.0') {
        Write-Log "Az.Accounts $($acctMod.Version) is old. Upgrade >= 2.12 for reliable token caching: Update-Module Az.Accounts" -Level WARN
    }
    Write-Log "All prerequisites satisfied." -Level SUCCESS
}

# =============================================================================
# REGION: SAFE API WRAPPER  (READ-ONLY — wraps Get-* cmdlets only)
# =============================================================================

function Invoke-SafeAzCommand {
    param(
        [scriptblock]$ScriptBlock,
        [string]$Context  = 'operation',
        [int]$MaxRetries  = $Script:Config.MaxRetryCount
    )
    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return (& $ScriptBlock)
        } catch {
            $attempt++
            if ($attempt -gt $MaxRetries) {
                Write-Log "[$Context] Failed after $MaxRetries retries: [$($_.Exception.GetType().Name)] $($_.Exception.Message)" -Level WARN
                return $null
            }
            Write-Log "[$Context] Attempt $attempt failed, retrying in $($Script:Config.RetryDelaySeconds)s..." -Level WARN
            Start-Sleep -Seconds $Script:Config.RetryDelaySeconds
        }
    }
}

# =============================================================================
# REGION: TOKEN CACHE HELPERS
# =============================================================================

function Test-TokenCacheValid {
    <#
    .SYNOPSIS
        Returns $true if the in-memory cache has an entry for this tenant
        that is younger than TokenCacheTTLMinutes.
        NOTE: A cache hit does NOT mean the PS context is set correctly.
        Always call Invoke-SilentContextSwitch after a hit (v5.2 fix).
    #>
    param([string]$TenantId)
    if (-not $Script:TokenCache.ContainsKey($TenantId)) { return $false }
    $ageMin = ([datetime]::UtcNow - $Script:TokenCache[$TenantId]).TotalMinutes
    return ($ageMin -lt $Script:Config.TokenCacheTTLMinutes)
}

function Set-TokenCacheValid {
    param([string]$TenantId)
    $Script:TokenCache[$TenantId] = [datetime]::UtcNow
}

function Clear-TokenCache {
    param([string]$TenantId)
    if ($Script:TokenCache.ContainsKey($TenantId)) {
        $Script:TokenCache.Remove($TenantId)
    }
}

function Invoke-SilentContextSwitch {
    <#
    .SYNOPSIS
        Silently switches the Az PowerShell context to the given tenant
        using whatever token the MSAL disk cache already holds.
        Returns $true on success, $false on any failure.
        Never prompts — callers handle interactive flow on $false.
    #>
    param([string]$TenantId, [string]$SubscriptionId = $null)
    # FIX v5.2 (BUG 3): use try/finally so WarningPreference is always restored
    $oldPref           = $WarningPreference
    $WarningPreference = 'SilentlyContinue'
    try {
        $params = @{ TenantId = $TenantId; ErrorAction = 'Stop' }
        if ($SubscriptionId) { $params['SubscriptionId'] = $SubscriptionId }
        $ctx = Set-AzContext @params
        return ($ctx -and $ctx.Tenant.Id -eq $TenantId)
    } catch {
        return $false
    } finally {
        $WarningPreference = $oldPref
    }
}

function Invoke-PostConnectSetup {
    <#
    .SYNOPSIS
        Called after Connect-AzAccount -SkipContextPopulation.
        -SkipContextPopulation caches the MSAL token but creates no PS context,
        which means subsequent Set-AzContext / Get-AzContext calls fail.

        This function:
          1. Probes Get-AzSubscription to confirm the management token works
          2. Calls Set-AzContext to establish a real PS context for this session
        Returns $true on full success, $false otherwise.

    .NOTES
        FIX v5.2 (BUG 2): TenantId is only added to parameter hashtables when
        the string is non-empty, preventing "Cannot bind parameter TenantId"
        errors on some Az.Accounts versions when $TenantId is ''.
        FIX v5.2 (BUG 5): Set-AzContext is now called with ErrorAction Stop and
        wrapped in try/catch; returns $false if context establishment fails.
    #>
    param([string]$TenantId = '')

    $oldPref           = $WarningPreference
    $WarningPreference = 'SilentlyContinue'
    $probeSubs         = $null
    try {
        # BUG 2 FIX: only include TenantId param when it is non-empty
        if ($TenantId -and $TenantId.Trim() -ne '') {
            try { $probeSubs = @(Get-AzSubscription -TenantId $TenantId -ErrorAction Stop) } catch {}
        }
        # Fallback: no TenantId filter (handles first-time login before TenantId is known)
        if (-not $probeSubs -or $probeSubs.Count -eq 0) {
            try { $probeSubs = @(Get-AzSubscription -ErrorAction Stop) } catch {}
        }
    } finally {
        $WarningPreference = $oldPref
    }

    if (-not $probeSubs -or $probeSubs.Count -eq 0) { return $false }

    # BUG 5 FIX: wrap Set-AzContext in try/catch and return $false on failure
    $ctxParams = @{ SubscriptionId = $probeSubs[0].Id; ErrorAction = 'Stop' }
    # BUG 2 FIX: only add TenantId when non-empty
    if ($TenantId -and $TenantId.Trim() -ne '') { $ctxParams['TenantId'] = $TenantId }
    try {
        Set-AzContext @ctxParams | Out-Null
        return $true
    } catch {
        Write-Log "  [PostConnectSetup] Set-AzContext failed: $($_.Exception.Message)" -Level WARN
        return $false
    }
}

# =============================================================================
# REGION: AUTHENTICATION & TENANT AUTO-DISCOVERY
# =============================================================================

function Get-TenantDisplayName {
    param($Tenant)
    if ($Tenant.PSObject.Properties['Name'] -and
        $Tenant.Name -and
        $Tenant.Name -ne $Tenant.TenantId) {
        return "$($Tenant.Name) ($($Tenant.TenantId))"
    }
    return $Tenant.TenantId
}

function Connect-AzureSession {
    <#
    .SYNOPSIS
        TOKEN ACQUISITION FLOW (per tenant, in priority order):
          1. In-memory cache hit  → still validates PS context (v5.2 BUG 1 fix)
          2. Silent Set-AzContext → reuses MSAL disk cache (no prompt)
          3. Interactive browser  → Connect-AzAccount -TenantId (MFA prompt)
          4. Device-code          → fallback for RDP / headless environments

        TENANT DISCOVERY:
          1. Get-AzTenant (CA warnings suppressed)
          2. Falls back to current context tenant when CA blocks enumeration
    #>
    Write-Log "-- Azure Session Check (v5.2 Token-Cache Mode) --" -Level SECTION

    # ── Step 1: Ensure a base context exists ─────────────────────────────────
    $ctx = Get-AzContext -ErrorAction SilentlyContinue
    if ($null -eq $ctx -or $null -eq $ctx.Account) {
        Write-Log "No active session. Initiating first-time login..." -Level WARN
        try {
            Connect-AzAccount -SkipContextPopulation -ErrorAction Stop | Out-Null
            Invoke-PostConnectSetup | Out-Null
            $ctx    = Get-AzContext -ErrorAction SilentlyContinue
            $acctId = if ($ctx -and $ctx.Account) { $ctx.Account.Id } else { 'authenticated' }
            Write-Log "Authenticated as: $acctId" -Level SUCCESS
        } catch {
            Write-Log "Initial login failed: $($_.Exception.Message)" -Level ERROR
            throw
        }
    } else {
        Write-Log "Active session: $($ctx.Account.Id)" -Level SUCCESS
    }

    # ── Step 2: Enumerate tenants ─────────────────────────────────────────────
    Write-Log "Discovering tenants..." -Level INFO
    $tenants = $null
    # BUG 3 FIX: use try/finally to guarantee WarningPreference is restored
    $oldPref           = $WarningPreference
    $WarningPreference = 'SilentlyContinue'
    try   { $tenants = Get-AzTenant -ErrorAction SilentlyContinue }
    catch { Write-Log "Get-AzTenant threw: $($_.Exception.Message) — using context tenant fallback." -Level WARN }
    finally { $WarningPreference = $oldPref }

    if (-not $tenants -or @($tenants).Count -eq 0) {
        Write-Log "Get-AzTenant returned nothing (CA policy likely). Falling back to current context tenant." -Level WARN
        $curCtx = Get-AzContext
        if ($curCtx -and $curCtx.Tenant) {
            # Attempt to get display name from context subscription info
            $tenantDisplayName = $curCtx.Tenant.Id
            $tenants = @([PSCustomObject]@{ TenantId = $curCtx.Tenant.Id; Name = $tenantDisplayName })
        } else {
            throw "No tenants found and current context has no tenant. Cannot proceed."
        }
    }

    Write-Log "Tenants to process: $(@($tenants).Count)" -Level SUCCESS
    foreach ($t in @($tenants)) { Write-Log "  + $(Get-TenantDisplayName -Tenant $t)" -Level INFO }

    # ── Step 3: Token acquisition per tenant ──────────────────────────────────
    Write-Log "Acquiring/validating tokens per tenant..." -Level INFO
    $validTenants = @()

    foreach ($t in @($tenants)) {
        $tId      = $t.TenantId
        $tDisplay = Get-TenantDisplayName -Tenant $t

        # ── Path A: In-memory cache hit ────────────────────────────────────
        # BUG 1 FIX (v5.2 CRITICAL): Cache hit no longer skips context switch.
        # We MUST call Invoke-SilentContextSwitch even on a cache hit to ensure
        # the PowerShell Az context is pointed at THIS tenant. Without this,
        # if the previous iteration set context to tenant X and this tenant Y
        # is "cache valid", all API calls for Y would silently target X.
        if (Test-TokenCacheValid -TenantId $tId) {
            Write-Log "  ✓ [CACHE HIT] $tDisplay — validating PS context..." -Level SUCCESS
            if (Invoke-SilentContextSwitch -TenantId $tId) {
                Write-Log "    ✓ Context set correctly for cached tenant." -Level SUCCESS
                $validTenants += $t
                continue
            } else {
                # Cache entry is stale (token actually expired) — fall through to fresh auth
                Write-Log "    ✗ Context switch failed despite cache hit — token may be expired. Clearing cache." -Level WARN
                Clear-TokenCache -TenantId $tId
                # fall through to Path B / C / D below
            }
        }

        # ── Path B: Silent (MSAL disk cache) ──────────────────────────────
        Write-Log "  ⟳ [SILENT] Trying MSAL cache: $tDisplay" -Level INFO
        if (Invoke-SilentContextSwitch -TenantId $tId) {
            Write-Log "  ✓ [SILENT OK] $tDisplay" -Level SUCCESS
            Set-TokenCacheValid -TenantId $tId
            $validTenants += $t
            continue
        }

        # ── Path C: Interactive browser MFA ───────────────────────────────
        Write-Log "  ⚠ [SILENT FAIL] Cache miss for: $tDisplay" -Level WARN
        Write-Log "    Launching interactive login (MFA)..." -Level WARN
        $acquired = $false
        try {
            Connect-AzAccount -TenantId $tId -SkipContextPopulation -ErrorAction Stop | Out-Null
            if (Invoke-PostConnectSetup -TenantId $tId) {
                Write-Log "  ✓ [INTERACTIVE] MFA success: $tDisplay" -Level SUCCESS
                Set-TokenCacheValid -TenantId $tId
                $acquired = $true
            } else {
                Write-Log "  ✗ [INTERACTIVE] Login OK but management API verify failed: $tDisplay" -Level WARN
            }
        } catch {
            Write-Log "  ✗ [INTERACTIVE] Failed: $($_.Exception.Message)" -Level WARN

            # ── Path D: Device-code (RDP / headless) ──────────────────────
            Write-Log "    Retrying with device-code auth..." -Level WARN
            try {
                Connect-AzAccount -TenantId $tId -UseDeviceAuthentication -SkipContextPopulation -ErrorAction Stop | Out-Null
                if (Invoke-PostConnectSetup -TenantId $tId) {
                    Write-Log "  ✓ [DEVICE CODE] Success: $tDisplay" -Level SUCCESS
                    Set-TokenCacheValid -TenantId $tId
                    $acquired = $true
                } else {
                    Write-Log "  ✗ [DEVICE CODE] Auth OK but management verify failed: $tDisplay" -Level WARN
                }
            } catch {
                Write-Log "  ✗ [DEVICE CODE] Also failed for: $tDisplay — tenant will be skipped." -Level WARN
            }
        }

        if ($acquired) { $validTenants += $t }
    }

    if ($validTenants.Count -eq 0) {
        throw "All tenant authentication attempts failed. No tenants accessible."
    }
    Write-Log "Ready. Valid tenant(s): $($validTenants.Count)" -Level SUCCESS
    return $validTenants
}

# =============================================================================
# REGION: HELPERS
# =============================================================================

function Get-NormalizedBackupStatus {
    param([string]$ProtectionStatus, [string]$HealthStatus, [string]$LastBackupStatus)
    $combined = ("$ProtectionStatus $HealthStatus $LastBackupStatus").ToLower()
    if ($combined -match 'failed|unhealthy|error')                                                      { return 'Failed'  }
    if ($combined -match 'notprotected')                                                                 { return 'Failed'  }
    if ($combined -match 'warning|actionrequired|actionsuggested|irpending|initialdp|initialdppending') { return 'Warning' }
    if ($combined -match 'healthy|protected|passed|completed')                                          { return 'Healthy' }
    if ($combined -match 'stopped|protectionstopped')                                                   { return 'Warning' }
    return 'Warning'
}

function Format-LastBackupTime {
    param($LastBackupTime)
    if ($null -eq $LastBackupTime -or $LastBackupTime -eq [datetime]::MinValue) { return 'Never' }
    try {
        $dt = [datetime]$LastBackupTime
        if ($dt.Kind -ne [System.DateTimeKind]::Utc) { $dt = [datetime]::SpecifyKind($dt, [System.DateTimeKind]::Utc) }
        return $dt.ToString('dd MMM yyyy, HH:mm UTC')
    } catch { return 'N/A' }
}

function Format-BackupAge {
    param($LastBackupTime)
    if ($null -eq $LastBackupTime -or $LastBackupTime -eq [datetime]::MinValue) { return 'Never' }
    try {
        $dt = [datetime]$LastBackupTime
        if ($dt.Kind -ne [System.DateTimeKind]::Utc) { $dt = [datetime]::SpecifyKind($dt, [System.DateTimeKind]::Utc) }
        $hours = ([datetime]::UtcNow - $dt).TotalHours
        if ($hours -lt 0)  { return 'N/A' }
        if ($hours -lt 1)  { return "$([int]($hours * 60))m ago" }
        if ($hours -lt 24) { return "$([int]$hours)h ago" }
        $days = [int]($hours / 24)
        if ($days -lt 7)   { return "${days}d ago" }
        if ($days -lt 30)  { return "$([int]($days/7))w ago" }
        return "$([int]($days/30))mo ago"
    } catch { return 'N/A' }
}

function Get-BackupAgeHours {
    param($LastBackupTime)
    if ($null -eq $LastBackupTime -or $LastBackupTime -eq [datetime]::MinValue) { return -1 }
    try {
        $dt = [datetime]$LastBackupTime
        if ($dt.Kind -ne [System.DateTimeKind]::Utc) { $dt = [datetime]::SpecifyKind($dt, [System.DateTimeKind]::Utc) }
        $h = ([datetime]::UtcNow - $dt).TotalHours
        return if ($h -lt 0) { -1 } else { [int][math]::Round($h) }
    } catch { return -1 }
}

function ConvertTo-SafeHtml {
    param([string]$Text)
    if (-not $Text) { return '' }
    return $Text.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&#39;')
}

function Get-PreBackupBadgeCss {
    param([string]$Status)
    $s = $Status.ToLower()
    if ($s -match '^healthy')              { return 'pre-ok'   }
    if ($s -match 'actionrequired|failed') { return 'pre-fail' }
    if ($s -match 'actionsuggested|warn')  { return 'pre-warn' }
    return 'pre-na'
}

function Get-RecoveryTypeBadgeCss {
    param([string]$RType)
    $r = $RType.ToLower()
    if ($r -match 'snapshot.*vault|vault.*snapshot') { return 'rt-snapvault' }
    if ($r -match 'vault.*standard|vault-standard')  { return 'rt-vault'     }
    if ($r -match 'vault.*archive|vault-archive')    { return 'rt-archive'   }
    if ($r -match 'snapshot')                        { return 'rt-snap'      }
    return 'rt-na'
}

function Get-ConsistencyBadgeCss {
    param([string]$Cons)
    $c = $Cons.ToLower()
    if ($c -match 'app')   { return 'cn-app'   }
    if ($c -match 'crash') { return 'cn-crash'  }
    if ($c -match 'file')  { return 'cn-file'   }
    return 'cn-na'
}

function Get-ConsistencyDisplayName {
    param([string]$RawType)
    if (-not $RawType -or $RawType -eq 'N/A') { return 'N/A' }
    $r = $RawType.ToLower().Trim()
    if ($r -match 'appconsistent|applicationconsistent|app_consistent|appcons')           { return 'Application Consistent'  }
    if ($r -match 'crashconsistent|crash_consistent|crashcons')                            { return 'Crash Consistent'        }
    if ($r -match 'filesystemconsistent|filesystem_consistent|filesystemcons|filssystem')  { return 'File-System Consistent'  }
    return $RawType
}

function Get-RPTierDisplayName {
    param($RecoveryPoint)
    if (-not $RecoveryPoint) { return 'N/A' }
    $hasSnapshot = $false; $hasVault = $false; $hasArchive = $false

    if ($RecoveryPoint.PSObject.Properties['RecoveryPointTierDetails'] -and $RecoveryPoint.RecoveryPointTierDetails) {
        foreach ($d in @($RecoveryPoint.RecoveryPointTierDetails)) {
            $tierStatus = if ($d.PSObject.Properties['Status']) { "$($d.Status)" } else { '' }
            if ($tierStatus -and $tierStatus -notin @('Valid','Rehydrated','')) { continue }
            $tierType = if ($d.PSObject.Properties['Type']) { "$($d.Type)" } else { '' }
            if (-not $tierType -and $d.PSObject.Properties['Tier']) { $tierType = "$($d.Tier)" }
            if ($tierType) {
                $tl = $tierType.ToLower()
                if ($tl -match 'instant|snapshot')          { $hasSnapshot = $true }
                if ($tl -match 'hardenedrp|vault|standard') { $hasVault    = $true }
                if ($tl -match 'archive')                   { $hasArchive  = $true }
            }
        }
    }

    if (-not $hasSnapshot -and -not $hasVault -and -not $hasArchive) {
        foreach ($pn in @('RecoveryPointTier','Tier','TierType')) {
            if ($RecoveryPoint.PSObject.Properties[$pn]) {
                $tv = "$($RecoveryPoint.$pn)".ToLower().Trim()
                if ($tv -match 'instant|snapshot')          { $hasSnapshot = $true }
                if ($tv -match 'hardenedrp|vault|standard') { $hasVault    = $true }
                if ($tv -match 'archive')                   { $hasArchive  = $true }
                if ($hasSnapshot -or $hasVault -or $hasArchive) { break }
            }
        }
    }

    if ($hasSnapshot -and $hasVault) { return 'Snapshot and Vault-Standard' }
    if ($hasVault)                   { return 'Vault-Standard'              }
    if ($hasArchive)                 { return 'Vault-Archive'               }
    if ($hasSnapshot)                { return 'Snapshot'                    }
    return 'Snapshot'
}

function Get-CleanResourceName {
    param([string]$Name)
    if (-not $Name) { return '' }
    if ($Name -match ';') {
        $parts = $Name.Split(';') | Where-Object { $_ -and $_.Trim() }
        if ($parts.Count -ge 2) { return $parts[-1].Trim() }
    }
    return $Name
}

function Get-ParsedStorageAccount {
    param([string]$ContainerName)
    if (-not $ContainerName) { return '' }
    $parts = $ContainerName.Split(';')
    if ($parts.Count -ge 2) { return $parts[-1].Trim() }
    return $ContainerName
}

function Get-PolicyNameFromId {
    param([string]$PolicyId)
    if (-not $PolicyId) { return 'N/A' }
    if ($PolicyId -match '/backupPolicies/([^/]+)/?$') { return $Matches[1] }
    $parts = $PolicyId.TrimEnd('/').Split('/') | Where-Object { $_ }
    if ($parts.Count -gt 0) { return $parts[-1] }
    return 'N/A'
}

# =============================================================================
# REGION: DATA COLLECTION  (READ-ONLY — Get-* cmdlets only)
# =============================================================================

function Get-AllBackupData {
    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    $tenants = Connect-AzureSession
    if (-not $tenants -or @($tenants).Count -eq 0) {
        Write-Log "No tenants accessible." -Level ERROR
        return $allResults
    }

    foreach ($tenant in @($tenants)) {
        $tenantId   = "$($tenant.TenantId)"
        $tenantName = Get-TenantDisplayName -Tenant $tenant

        Write-Log "=================================================" -Level SECTION
        Write-Log "TENANT: $tenantName"                               -Level SECTION
        Write-Log "=================================================" -Level SECTION

        # ── Set context for this tenant (v5.2: cache hit still sets context) ──
        # The cache was already validated in Connect-AzureSession (Path A fix),
        # so here we just ensure context is on the right tenant before API calls.
        if (-not (Invoke-SilentContextSwitch -TenantId $tenantId)) {
            # Silent switch failed — try to re-authenticate
            Write-Log "  Cannot set context for [$tenantName] — attempting re-auth..." -Level WARN
            $reOk = $false
            try {
                Connect-AzAccount -TenantId $tenantId -SkipContextPopulation -ErrorAction Stop | Out-Null
                $reOk = Invoke-PostConnectSetup -TenantId $tenantId
            } catch {}
            if (-not $reOk) {
                # Try device code as last resort
                try {
                    Connect-AzAccount -TenantId $tenantId -UseDeviceAuthentication -SkipContextPopulation -ErrorAction Stop | Out-Null
                    $reOk = Invoke-PostConnectSetup -TenantId $tenantId
                } catch {}
            }
            if ($reOk) {
                Set-TokenCacheValid -TenantId $tenantId
            } else {
                Write-Log "  Re-auth failed for [$tenantName]. Skipping tenant." -Level WARN
                continue
            }
        }

        # ── Get subscriptions ─────────────────────────────────────────────────
        # BUG 3 FIX: try/finally for WarningPreference
        $subscriptions = $null
        $oldPref           = $WarningPreference
        $WarningPreference = 'SilentlyContinue'
        try {
            $subscriptions = Invoke-SafeAzCommand -Context "Get-AzSubscription [$tenantName]" -ScriptBlock {
                Get-AzSubscription -TenantId $tenantId -ErrorAction Stop |
                    Where-Object { $_.State -in @('Enabled', 'Warned', 'PastDue') }
            }
        } finally {
            $WarningPreference = $oldPref
        }

        # ── Fallback 1: context-only query (no -TenantId) ────────────────────
        if (-not $subscriptions -or @($subscriptions).Count -eq 0) {
            Write-Log "  [SUB-FALLBACK1] -TenantId query empty; retrying context-only..." -Level WARN
            $oldPref           = $WarningPreference
            $WarningPreference = 'SilentlyContinue'
            try {
                $subscriptions = Invoke-SafeAzCommand -Context "Get-AzSubscription-NoFilter [$tenantName]" -ScriptBlock {
                    Get-AzSubscription -ErrorAction Stop |
                        Where-Object { $_.State -in @('Enabled', 'Warned', 'PastDue') }
                }
            } finally {
                $WarningPreference = $oldPref
            }
            if ($subscriptions -and @($subscriptions).Count -gt 0) {
                Write-Log "  [SUB-FALLBACK1] Found $(@($subscriptions).Count) subscription(s) via context-only." -Level SUCCESS
            }
        }

        # ── Fallback 2: stale management token — force re-auth ───────────────
        # BUG 4 FIX: Clear-TokenCache before re-auth, and only re-populate
        # the cache after a confirmed successful Invoke-PostConnectSetup.
        if (-not $subscriptions -or @($subscriptions).Count -eq 0) {
            Write-Log "  [TOKEN-REFRESH] Management token stale for [$tenantName] — forcing re-auth..." -Level WARN
            Clear-TokenCache -TenantId $tenantId    # BUG 4 FIX: explicit helper
            $reAuthOk = $false
            try {
                Connect-AzAccount -TenantId $tenantId -SkipContextPopulation -ErrorAction Stop | Out-Null
                if (Invoke-PostConnectSetup -TenantId $tenantId) {
                    $reAuthOk = $true
                }
            } catch {
                Write-Log "  [TOKEN-REFRESH] Browser auth failed ($($_.Exception.Message)); trying device-code..." -Level WARN
                try {
                    Connect-AzAccount -TenantId $tenantId -UseDeviceAuthentication -SkipContextPopulation -ErrorAction Stop | Out-Null
                    if (Invoke-PostConnectSetup -TenantId $tenantId) {
                        $reAuthOk = $true
                    }
                } catch {
                    Write-Log "  [TOKEN-REFRESH] Device-code also failed: $($_.Exception.Message)" -Level WARN
                }
            }

            if ($reAuthOk) {
                Set-TokenCacheValid -TenantId $tenantId   # BUG 4 FIX: only set AFTER confirmed success
                $oldPref           = $WarningPreference
                $WarningPreference = 'SilentlyContinue'
                try {
                    $subscriptions = Invoke-SafeAzCommand -Context "Get-AzSubscription-Refresh [$tenantName]" -ScriptBlock {
                        Get-AzSubscription -TenantId $tenantId -ErrorAction Stop |
                            Where-Object { $_.State -in @('Enabled', 'Warned', 'PastDue') }
                    }
                } finally {
                    $WarningPreference = $oldPref
                }
                if ($subscriptions -and @($subscriptions).Count -gt 0) {
                    Write-Log "  [TOKEN-REFRESH] Retry succeeded: $(@($subscriptions).Count) subscription(s) found." -Level SUCCESS
                }
            }
        }

        if (-not $subscriptions -or @($subscriptions).Count -eq 0) {
            Write-Log "No enabled subscriptions in [$tenantName]." -Level WARN
            continue
        }
        Write-Log "Found $(@($subscriptions).Count) subscription(s) in [$tenantName]." -Level SUCCESS

        # ── Iterate subscriptions (auto-scan, no manual input) ────────────────
        foreach ($sub in @($subscriptions)) {
            $subName = $sub.Name
            $subId   = $sub.Id
            Write-Log "  Subscription: [$subName] ($subId)" -Level INFO

            $switched = Invoke-SafeAzCommand -Context "Set-AzContext [$subName]" -ScriptBlock {
                Set-AzContext -SubscriptionId $subId -TenantId $tenantId -ErrorAction Stop | Out-Null
                return $true
            }
            if (-not $switched) { Write-Log "  Cannot switch to [$subName]. Skipping." -Level WARN; continue }

            $vaults = Invoke-SafeAzCommand -Context "Get-Vaults [$subName]" -ScriptBlock {
                Get-AzRecoveryServicesVault -ErrorAction Stop
            }

            if (-not $vaults -or $vaults.Count -eq 0) {
                Write-Log "    No vaults in [$subName]." -Level INFO
                $allResults.Add([PSCustomObject]@{
                    TenantId=$tenantId; TenantName=$tenantName; SubscriptionName=$subName
                    ResourceGroup='N/A'; VaultName='N/A'; BackupType='N/A'
                    ResourceName='No Vaults Found'; BackupStatus='N/A'; LastBackupStatus='N/A'
                    PreBackupStatus='N/A'; ConsistencyType='N/A'; RecoveryType='N/A'
                    LatestRPTime='N/A'; LastBackupTime='N/A'; BackupAge='N/A'
                    BackupAgeHours=-1; PolicyName='N/A'; ProtectionState='N/A'; StorageAccount=''
                })
                continue
            }
            Write-Log "    Found $($vaults.Count) vault(s)." -Level INFO

            foreach ($vault in $vaults) {
                $vaultName = $vault.Name
                $rgName    = $vault.ResourceGroupName
                Write-Log "      Vault: [$vaultName]  RG: [$rgName]" -Level INFO

                $vaultCtxOk = Invoke-SafeAzCommand -Context "Set-VaultCtx [$vaultName]" -ScriptBlock {
                    Set-AzRecoveryServicesVaultContext -Vault $vault -ErrorAction Stop
                    return $true
                }
                if (-not $vaultCtxOk) { Write-Log "      Cannot set vault context. Skipping." -Level WARN; continue }

                $vaultHasItems = $false

                # ── VM Backup Items ───────────────────────────────────────────
                $vmItems = Invoke-SafeAzCommand -Context "GetVMItems [$vaultName]" -ScriptBlock {
                    Get-AzRecoveryServicesBackupItem -BackupManagementType AzureVM -WorkloadType AzureVM -VaultId $vault.ID -ErrorAction Stop
                }

                if ($vmItems -and $vmItems.Count -gt 0) {
                    $vaultHasItems = $true
                    foreach ($item in $vmItems) {
                        try {
                            $fnProp        = $item.PSObject.Properties['FriendlyName']
                            $rawName       = if ($fnProp -and $fnProp.Value) { $fnProp.Value } else { $item.Name }
                            $resourceName  = Get-CleanResourceName -Name $rawName
                            $protStatus    = if ($item.PSObject.Properties['ProtectionStatus'])  { "$($item.ProtectionStatus)" }  else { '' }
                            $healthStatus  = if ($item.PSObject.Properties['HealthStatus'])      { "$($item.HealthStatus)" }      else { '' }
                            $lastBkpStatus = if ($item.PSObject.Properties['LastBackupStatus'])  { "$($item.LastBackupStatus)" }  else { '' }
                            $protState     = if ($item.PSObject.Properties['ProtectionState'])   { "$($item.ProtectionState)" }   else { '' }
                            $lastBkpTime   = if ($item.PSObject.Properties['LastBackupTime'])    { $item.LastBackupTime }         else { $null }

                            $policyName = 'N/A'
                            if ($item.PSObject.Properties['PolicyName'] -and $item.PolicyName) { $policyName = "$($item.PolicyName)" }
                            elseif ($item.PSObject.Properties['PolicyId'] -and $item.PolicyId) { $policyName = Get-PolicyNameFromId -PolicyId "$($item.PolicyId)" }

                            $preBackupStatus = if ($healthStatus) { $healthStatus } else { 'N/A' }
                            if ($healthStatus -and $healthStatus -ne 'Healthy' -and
                                $item.PSObject.Properties['HealthDetails'] -and $item.HealthDetails -and $item.HealthDetails.Count -gt 0) {
                                $hdMsg = $item.HealthDetails[0].PSObject.Properties['Message']
                                if ($hdMsg -and $hdMsg.Value) {
                                    $trim = ($hdMsg.Value -replace '\s+', ' ').Trim()
                                    if ($trim.Length -gt 70) { $trim = $trim.Substring(0, 70) + '...' }
                                    $preBackupStatus = "$healthStatus - $trim"
                                }
                            }

                            $status          = Get-NormalizedBackupStatus -ProtectionStatus $protStatus -HealthStatus $healthStatus -LastBackupStatus $lastBkpStatus
                            $consistencyType = 'N/A'; $recoveryType = 'N/A'; $latestRPTime = 'N/A'

                            if ($Script:Config.FetchRecoveryPoints) {
                                $rpsRaw = Invoke-SafeAzCommand -Context "GetVMRP [$resourceName]" -ScriptBlock {
                                    Get-AzRecoveryServicesBackupRecoveryPoint -Item $item -VaultId $vault.ID -ErrorAction Stop
                                }
                                if ($rpsRaw) {
                                    $rpsArr   = @($rpsRaw) | Sort-Object {
                                        if ($_.PSObject.Properties['RecoveryPointTime'] -and $_.RecoveryPointTime) {
                                            [datetime]$_.RecoveryPointTime
                                        } else { [datetime]::MinValue }
                                    } -Descending
                                    $newestRP = $rpsArr[0]
                                    if ($newestRP.PSObject.Properties['RecoveryPointTime'] -and $newestRP.RecoveryPointTime) {
                                        $rpDt = [datetime]$newestRP.RecoveryPointTime
                                        if ($rpDt.Kind -ne [System.DateTimeKind]::Utc) { $rpDt = [datetime]::SpecifyKind($rpDt, [System.DateTimeKind]::Utc) }
                                        $latestRPTime = $rpDt.ToString('dd MMM yyyy, HH:mm UTC')
                                    } elseif ($lastBkpTime) { $latestRPTime = Format-LastBackupTime -LastBackupTime $lastBkpTime }

                                    $recoveryType = Get-RPTierDisplayName -RecoveryPoint $newestRP
                                    $consRaw = ''; $scanLimit = [math]::Min(5, $rpsArr.Count)
                                    for ($ri = 0; $ri -lt $scanLimit -and -not $consRaw; $ri++) {
                                        $rp = $rpsArr[$ri]
                                        foreach ($pn in @('RecoveryPointType','SnapshotConsistencyType','ConsistencyType')) {
                                            $val = if ($rp.PSObject.Properties[$pn]) { "$($rp.$pn)" } else { '' }
                                            if ($val -and $val -ne '0') { $consRaw = $val; break }
                                        }
                                    }
                                    if ($consRaw) { $consistencyType = Get-ConsistencyDisplayName -RawType $consRaw }
                                    Write-Log "          [RP-OK] $resourceName : $consistencyType | $recoveryType ($($rpsArr.Count) RPs)" -Level INFO
                                } elseif ($lastBkpTime) {
                                    $latestRPTime = Format-LastBackupTime -LastBackupTime $lastBkpTime
                                    Write-Log "          [RP-MISS] $resourceName" -Level WARN
                                }
                            }

                            $allResults.Add([PSCustomObject]@{
                                TenantId=$tenantId; TenantName=$tenantName; SubscriptionName=$subName
                                ResourceGroup=$rgName; VaultName=$vaultName; BackupType='Azure VM'
                                ResourceName=$resourceName; BackupStatus=$status
                                LastBackupStatus=if ($lastBkpStatus) { $lastBkpStatus } else { 'N/A' }
                                PreBackupStatus=$preBackupStatus; ConsistencyType=$consistencyType
                                RecoveryType=$recoveryType; LatestRPTime=$latestRPTime
                                LastBackupTime=Format-LastBackupTime -LastBackupTime $lastBkpTime
                                BackupAge=Format-BackupAge           -LastBackupTime $lastBkpTime
                                BackupAgeHours=Get-BackupAgeHours    -LastBackupTime $lastBkpTime
                                PolicyName=if ($policyName) { $policyName } else { 'N/A' }
                                ProtectionState=$protState; StorageAccount=''
                            })
                        } catch {
                            Write-Log "      [SKIP-VM] $($_.Exception.Message)" -Level WARN
                        }
                    }
                    Write-Log "        VM backups processed: $($vmItems.Count)" -Level SUCCESS
                }

                # ── Azure File Share Backup Items ─────────────────────────────
                $afsItems = Invoke-SafeAzCommand -Context "GetAFSItems [$vaultName]" -ScriptBlock {
                    Get-AzRecoveryServicesBackupItem -BackupManagementType AzureStorage -WorkloadType AzureFiles -VaultId $vault.ID -ErrorAction Stop
                }

                if ($afsItems -and $afsItems.Count -gt 0) {
                    $vaultHasItems = $true
                    foreach ($item in $afsItems) {
                        try {
                            $fnProp        = $item.PSObject.Properties['FriendlyName']
                            $rawName       = if ($fnProp -and $fnProp.Value) { $fnProp.Value } else { $item.Name }
                            $resourceName  = Get-CleanResourceName -Name $rawName
                            $protStatus    = if ($item.PSObject.Properties['ProtectionStatus'])  { "$($item.ProtectionStatus)" }  else { '' }
                            $healthStatus  = if ($item.PSObject.Properties['HealthStatus'])      { "$($item.HealthStatus)" }      else { '' }
                            $lastBkpStatus = if ($item.PSObject.Properties['LastBackupStatus'])  { "$($item.LastBackupStatus)" }  else { '' }
                            $protState     = if ($item.PSObject.Properties['ProtectionState'])   { "$($item.ProtectionState)" }   else { '' }
                            $lastBkpTime   = if ($item.PSObject.Properties['LastBackupTime'])    { $item.LastBackupTime }         else { $null }

                            $policyName = 'N/A'
                            if ($item.PSObject.Properties['PolicyName'] -and $item.PolicyName) { $policyName = "$($item.PolicyName)" }
                            elseif ($item.PSObject.Properties['PolicyId'] -and $item.PolicyId) { $policyName = Get-PolicyNameFromId -PolicyId "$($item.PolicyId)" }

                            $storAcct = ''
                            if ($item.PSObject.Properties['ParentContainerFriendlyName'] -and $item.ParentContainerFriendlyName) { $storAcct = "$($item.ParentContainerFriendlyName)" }
                            elseif ($item.PSObject.Properties['ContainerName'] -and $item.ContainerName)                         { $storAcct = Get-ParsedStorageAccount -ContainerName "$($item.ContainerName)" }

                            $status = Get-NormalizedBackupStatus -ProtectionStatus $protStatus -HealthStatus $healthStatus -LastBackupStatus $lastBkpStatus

                            $recoveryType = 'Snapshot'; $latestRPTime = 'N/A'
                            if ($Script:Config.FetchRecoveryPoints) {
                                $afsRPs = $null; $rpEndDt = [datetime]::UtcNow; $rpStDt = $rpEndDt.AddDays(-90)
                                try   { $afsRPs = @(Get-AzRecoveryServicesBackupRecoveryPoint -Item $item -VaultId $vault.ID -StartDate $rpStDt -EndDate $rpEndDt -ErrorAction Stop) }
                                catch {
                                    try   { $afsRPs = @(Get-AzRecoveryServicesBackupRecoveryPoint -Item $item -VaultId $vault.ID -ErrorAction Stop) }
                                    catch { Write-Log "          [RP-ERR] $resourceName : $($_.Exception.Message)" -Level WARN }
                                }

                                if ($afsRPs -and $afsRPs.Count -gt 0) {
                                    $sorted = @($afsRPs) | Sort-Object {
                                        if ($_.PSObject.Properties['RecoveryPointTime'] -and $_.RecoveryPointTime) {
                                            [datetime]$_.RecoveryPointTime
                                        } else { [datetime]::MinValue }
                                    } -Descending
                                    $latestAfsRP = $sorted[0]
                                    if ($latestAfsRP.PSObject.Properties['RecoveryPointTime'] -and $latestAfsRP.RecoveryPointTime) {
                                        $rpDt = [datetime]$latestAfsRP.RecoveryPointTime
                                        if ($rpDt.Kind -ne [System.DateTimeKind]::Utc) { $rpDt = [datetime]::SpecifyKind($rpDt, [System.DateTimeKind]::Utc) }
                                        $latestRPTime = $rpDt.ToString('dd MMM yyyy, HH:mm UTC')
                                    } elseif ($lastBkpTime) { $latestRPTime = Format-LastBackupTime -LastBackupTime $lastBkpTime }
                                    $recoveryType = Get-RPTierDisplayName -RecoveryPoint $latestAfsRP
                                } elseif ($lastBkpTime) { $latestRPTime = Format-LastBackupTime -LastBackupTime $lastBkpTime }
                            } elseif ($lastBkpTime) { $latestRPTime = Format-LastBackupTime -LastBackupTime $lastBkpTime }

                            $allResults.Add([PSCustomObject]@{
                                TenantId=$tenantId; TenantName=$tenantName; SubscriptionName=$subName
                                ResourceGroup=$rgName; VaultName=$vaultName; BackupType='File Share'
                                ResourceName=$resourceName; BackupStatus=$status
                                LastBackupStatus=if ($lastBkpStatus) { $lastBkpStatus } else { 'N/A' }
                                PreBackupStatus='N/A'; ConsistencyType='N/A'
                                RecoveryType=$recoveryType; LatestRPTime=$latestRPTime
                                LastBackupTime=Format-LastBackupTime -LastBackupTime $lastBkpTime
                                BackupAge=Format-BackupAge           -LastBackupTime $lastBkpTime
                                BackupAgeHours=Get-BackupAgeHours    -LastBackupTime $lastBkpTime
                                PolicyName=if ($policyName) { $policyName } else { 'N/A' }
                                ProtectionState=$protState; StorageAccount=$storAcct
                            })
                        } catch {
                            Write-Log "      [SKIP-AFS] $($_.Exception.Message)" -Level WARN
                        }
                    }
                    Write-Log "        File Share backups processed: $($afsItems.Count)" -Level SUCCESS
                }

                if (-not $vaultHasItems) {
                    Write-Log "        No backup items in vault [$vaultName]." -Level INFO
                    $allResults.Add([PSCustomObject]@{
                        TenantId=$tenantId; TenantName=$tenantName; SubscriptionName=$subName
                        ResourceGroup=$rgName; VaultName=$vaultName; BackupType='N/A'
                        ResourceName='No Backup Items'; BackupStatus='N/A'; LastBackupStatus='N/A'
                        PreBackupStatus='N/A'; ConsistencyType='N/A'; RecoveryType='N/A'
                        LatestRPTime='N/A'; LastBackupTime='N/A'; BackupAge='N/A'
                        BackupAgeHours=-1; PolicyName='N/A'; ProtectionState='N/A'; StorageAccount=''
                    })
                }
            }   # end vault loop
        }   # end subscription loop
    }   # end tenant loop

    Write-Log "Data collection complete. Total records: $($allResults.Count)" -Level SUCCESS
    return $allResults
}

# =============================================================================
# REGION: HTML REPORT  (Azure Portal Dashboard Style)
# =============================================================================

function New-HtmlReport {
    param(
        [System.Collections.Generic.List[PSCustomObject]]$Data,
        [string]$OutputPath
    )
    Write-Log "Building HTML report..." -Level INFO

    $realItems    = $Data | Where-Object { $_.BackupStatus -ne 'N/A' }
    $totalCount   = ($realItems | Measure-Object).Count
    $healthyCount = ($realItems | Where-Object { $_.BackupStatus -eq 'Healthy'    } | Measure-Object).Count
    $warningCount = ($realItems | Where-Object { $_.BackupStatus -eq 'Warning'    } | Measure-Object).Count
    $failedCount  = ($realItems | Where-Object { $_.BackupStatus -eq 'Failed'     } | Measure-Object).Count
    $vmCount      = ($realItems | Where-Object { $_.BackupType   -eq 'Azure VM'   } | Measure-Object).Count
    $afsCount     = ($realItems | Where-Object { $_.BackupType   -eq 'File Share' } | Measure-Object).Count
    $tenantCount  = ($Data | Select-Object -ExpandProperty TenantName -Unique | Measure-Object).Count
    $subCount     = ($Data | ForEach-Object { "$($_.TenantName)|$($_.SubscriptionName)" } | Select-Object -Unique | Measure-Object).Count
    $rgCount      = ($Data | Select-Object -ExpandProperty ResourceGroup -Unique | Where-Object { $_ -ne 'N/A' } | Measure-Object).Count
    $vaultCount        = ($Data | Select-Object -ExpandProperty VaultName -Unique | Where-Object { $_ -ne 'N/A' } | Measure-Object).Count
    $appConsistCount   = ($realItems | Where-Object { $_.BackupType -eq 'Azure VM' -and $_.ConsistencyType -eq 'Application Consistent' } | Measure-Object).Count
    $crashConsistCount = ($realItems | Where-Object { $_.BackupType -eq 'Azure VM' -and $_.ConsistencyType -eq 'Crash Consistent'        } | Measure-Object).Count
    $fileConsistCount  = ($realItems | Where-Object { $_.BackupType -eq 'Azure VM' -and $_.ConsistencyType -eq 'File-System Consistent'  } | Measure-Object).Count
    $reportTime   = [datetime]::UtcNow.ToString('dd MMM yyyy, HH:mm:ss') + ' UTC'
    $loggedInUser = try { (Get-AzContext).Account.Id } catch { 'N/A' }

    $consDropAppHtml   = [System.Text.StringBuilder]::new()
    $consDropCrashHtml = [System.Text.StringBuilder]::new()
    $consDropFileHtml  = [System.Text.StringBuilder]::new()
    $vmConsItems = $realItems | Where-Object { $_.BackupType -eq 'Azure VM' } | Sort-Object SubscriptionName, ResourceName
    foreach ($vm in $vmConsItems) {
        $vmSafe  = ConvertTo-SafeHtml $vm.ResourceName
        $subSafe = ConvertTo-SafeHtml $vm.SubscriptionName
        $vltSafe = ConvertTo-SafeHtml $vm.VaultName
        $stDot   = switch ($vm.BackupStatus) { 'Healthy'{'&#9679;'} 'Warning'{'&#9651;'} 'Failed'{'&#10005;'} default{'-'} }
        $stCls   = switch ($vm.BackupStatus) { 'Healthy'{'vl-ok'} 'Warning'{'vl-wn'} 'Failed'{'vl-fl'} default{'vl-na'} }
        $baseLine = "<div class='vl-row"+$(if($vm.ConsistencyType -eq 'Crash Consistent'){" vl-crash"}else{''})+"'><span class='vl-dot $stCls'>$stDot</span><span class='vl-name'>$vmSafe</span><span class='vl-sub'>$subSafe</span><span class='vl-vault'>$vltSafe</span></div>"
        switch ($vm.ConsistencyType) {
            'Application Consistent' { [void]$consDropAppHtml.Append($baseLine)   }
            'Crash Consistent'       { [void]$consDropCrashHtml.Append($baseLine) }
            'File-System Consistent' { [void]$consDropFileHtml.Append($baseLine)  }
        }
    }
    if ($consDropAppHtml.Length   -eq 0) { [void]$consDropAppHtml.Append("<div class='vl-empty'>No Application Consistent VMs</div>")  }
    if ($consDropCrashHtml.Length -eq 0) { [void]$consDropCrashHtml.Append("<div class='vl-empty'>No Crash Consistent VMs</div>")      }
    if ($consDropFileHtml.Length  -eq 0) { [void]$consDropFileHtml.Append("<div class='vl-empty'>No File-System Consistent VMs</div>") }

    $subKeys  = $Data | ForEach-Object { "$($_.TenantName)|$($_.SubscriptionName)" } | Select-Object -Unique
    $subStats = @{}
    foreach ($sKey in $subKeys) {
        $parts  = $sKey.Split('|', 2); $tn = $parts[0]; $sn = $parts[1]
        $sItems = $realItems | Where-Object { $_.TenantName -eq $tn -and $_.SubscriptionName -eq $sn }
        $sTotal = ($sItems | Measure-Object).Count
        $sOk    = ($sItems | Where-Object { $_.BackupStatus -eq 'Healthy' } | Measure-Object).Count
        $sWn    = ($sItems | Where-Object { $_.BackupStatus -eq 'Warning' } | Measure-Object).Count
        $sFl    = ($sItems | Where-Object { $_.BackupStatus -eq 'Failed'  } | Measure-Object).Count
        $sVm    = ($sItems | Where-Object { $_.BackupType   -eq 'Azure VM'   } | Measure-Object).Count
        $sAfs   = ($sItems | Where-Object { $_.BackupType   -eq 'File Share' } | Measure-Object).Count
        $sPct   = if ($sTotal -gt 0) { [int](($sOk / $sTotal) * 100) } else { 0 }
        $sColor = if ($sFl -gt 0) { '#ef4444' } elseif ($sWn -gt 0) { '#f59e0b' } else { '#22c55e' }
        $sDot   = if ($sFl -gt 0) { 'dot-r'  } elseif ($sWn -gt 0) { 'dot-y'  } else { 'dot-g'  }
        $subStats[$sKey] = @{ Tn=$tn; Sn=$sn; Total=$sTotal; Ok=$sOk; Warn=$sWn; Fail=$sFl; Vm=$sVm; Afs=$sAfs; Pct=$sPct; Color=$sColor; Dot=$sDot }
    }

    $alertItems = $realItems | Where-Object { $_.BackupStatus -in 'Failed','Warning' } | Sort-Object BackupStatus, SubscriptionName
    $alertCount = if ($alertItems) { @($alertItems).Count } else { 0 }

    $tabBarHtml   = [System.Text.StringBuilder]::new()
    $tabPanelHtml = [System.Text.StringBuilder]::new()
    $subCardHtml  = [System.Text.StringBuilder]::new()
    $isFirst      = $true

    foreach ($sKey in $subKeys) {
        $st     = $subStats[$sKey]; $tn = $st.Tn; $sn = $st.Sn
        $safeId = $sKey -replace '[^A-Za-z0-9]', '_'
        $tabDisplayName = if ($tenantCount -gt 1) {
            $tnShort = if ($tn.Length -gt 10) { $tn.Substring(0,10) + '..' } else { $tn }
            "$sn [$tnShort]"
        } else { $sn }
        $tabAct  = if ($isFirst) { ' tab-active' } else { '' }
        $panAct  = if ($isFirst) { ' pan-active'  } else { '' }
        $isFirst = $false

        [void]$tabBarHtml.Append(
            "<button class='tab-btn$tabAct' id='tab_$safeId' onclick='activateTab(`"$safeId`")'>" +
            "<span class='tab-dot $($st.Dot)'></span><span class='tab-nm'>$(ConvertTo-SafeHtml $tabDisplayName)</span>" +
            "<span class='tab-ct'>$($st.Total)</span></button>"
        )

        $circ = if ($st.Total -gt 0) { [int](($st.Ok / $st.Total) * 188.5) } else { 0 }
        $rem  = [int](188.5 - $circ)
        $cardTenantBadge = if ($tenantCount -gt 1) { "<span class='t-badge'>$(ConvertTo-SafeHtml $tn)</span>" } else { '' }

        [void]$subCardHtml.Append(
            "<div class='sub-card' onclick='activateTab(`"$safeId`")'><div class='sc-top'>" +
            "<svg viewBox='0 0 80 80' class='donut-svg'><circle cx='40' cy='40' r='30' fill='none' stroke='#e0e4ea' stroke-width='7'/>" +
            "<circle cx='40' cy='40' r='30' fill='none' stroke='$($st.Color)' stroke-width='7' stroke-dasharray='$circ $rem' stroke-linecap='round' transform='rotate(-90 40 40)'/>" +
            "<text x='40' y='45' text-anchor='middle' font-size='13' font-weight='700' fill='#1a1a2e' font-family='Inter,sans-serif'>$($st.Pct)%</text></svg>" +
            "<div class='sc-info'><div class='sc-name'><span class='sc-dot' style='background:$($st.Color)'></span>$(ConvertTo-SafeHtml $sn)</div>$cardTenantBadge" +
            "<div class='sc-counts'><span class='ok-ct'>$($st.Ok) ok</span>&nbsp;<span class='wn-ct'>$($st.Warn) warn</span>&nbsp;<span class='fl-ct'>$($st.Fail) fail</span></div></div></div>" +
            "<div class='sc-bar'><div class='sc-bar-fill' style='width:$($st.Pct)%;background:$($st.Color)'></div></div>" +
            "<div class='sc-tags'><span class='sc-tag vm-tag'>$($st.Vm) VMs</span><span class='sc-tag afs-tag'>$($st.Afs) File Shares</span></div></div>"
        )

        [void]$tabPanelHtml.Append("<div class='tab-panel$panAct' id='pan_$safeId'>")
        $okPct = if ($st.Total -gt 0) { [int](($st.Ok / $st.Total) * 100) } else { 0 }
        [void]$tabPanelHtml.Append(
            "<div class='sub-strip'>" +
            "<div class='ss-kpi'><div class='ss-v'>$($st.Total)</div><div class='ss-l'>Total</div></div><div class='ss-divider'></div>" +
            "<div class='ss-kpi ok-kpi'><div class='ss-v'>$($st.Ok)</div><div class='ss-l'>Healthy</div></div>" +
            "<div class='ss-kpi wn-kpi'><div class='ss-v'>$($st.Warn)</div><div class='ss-l'>Warning</div></div>" +
            "<div class='ss-kpi fl-kpi'><div class='ss-v'>$($st.Fail)</div><div class='ss-l'>Failed</div></div><div class='ss-divider'></div>" +
            "<div class='ss-kpi'><div class='ss-v'>$($st.Vm)</div><div class='ss-l'>VMs</div></div>" +
            "<div class='ss-kpi'><div class='ss-v'>$($st.Afs)</div><div class='ss-l'>File Shares</div></div>" +
            "<div class='ss-bar-wrap'><div class='ss-bar-lbl'><b>${okPct}%</b> healthy</div><div class='ss-bar'><div class='ss-fill' style='width:${okPct}%'></div></div></div></div>"
        )

        [void]$tabPanelHtml.Append("<div class='rg-list'>")
        $rgGroups = $Data | Where-Object { $_.TenantName -eq $tn -and $_.SubscriptionName -eq $sn } | Group-Object -Property ResourceGroup

        foreach ($rgGrp in $rgGroups) {
            $rgName   = $rgGrp.Name
            $rgItems  = $realItems | Where-Object { $_.TenantName -eq $tn -and $_.SubscriptionName -eq $sn -and $_.ResourceGroup -eq $rgName }
            $rgTotal  = ($rgItems | Measure-Object).Count
            $rgOk     = ($rgItems | Where-Object { $_.BackupStatus -eq 'Healthy' } | Measure-Object).Count
            $rgWn     = ($rgItems | Where-Object { $_.BackupStatus -eq 'Warning' } | Measure-Object).Count
            $rgFl     = ($rgItems | Where-Object { $_.BackupStatus -eq 'Failed'  } | Measure-Object).Count
            $rgPct    = if ($rgTotal -gt 0) { [int](($rgOk / $rgTotal) * 100) } else { 0 }
            $rgDot    = if ($rgFl -gt 0) { '#ef4444' } elseif ($rgWn -gt 0) { '#f59e0b' } else { '#22c55e' }
            $rgVaults = ($rgGrp.Group | Select-Object -ExpandProperty VaultName -Unique | Where-Object { $_ -ne 'N/A' }).Count
            $rgOpen   = if ($rgFl -gt 0 -or $rgWn -gt 0) { ' rg-open' } else { '' }

            [void]$tabPanelHtml.Append(
                "<div class='rgc$rgOpen'><div class='rg-hdr' onclick='this.parentElement.classList.toggle(`"rg-open`")'>" +
                "<div class='rg-l'><span class='rg-dot' style='background:$rgDot'></span>" +
                "<svg class='rg-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 7l9-4 9 4v10l-9 4-9-4V7z'/></svg>" +
                "<div><div class='rg-name'>$(ConvertTo-SafeHtml $rgName)</div><div class='rg-meta'>${rgVaults} vault(s) &nbsp;|&nbsp; ${rgTotal} item(s)</div></div></div>" +
                "<div class='rg-r'>"
            )
            if ($rgOk -gt 0) { [void]$tabPanelHtml.Append("<span class='pill ok-pill'>${rgOk} Healthy</span>") }
            if ($rgWn -gt 0) { [void]$tabPanelHtml.Append("<span class='pill wn-pill'>${rgWn} Warning</span>") }
            if ($rgFl -gt 0) { [void]$tabPanelHtml.Append("<span class='pill fl-pill'>${rgFl} Failed</span>")  }
            [void]$tabPanelHtml.Append(
                "<div class='rg-hp'><div class='rg-hp-fill' style='width:${rgPct}%'></div></div>" +
                "<svg class='chev' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>" +
                "</div></div><div class='rg-body'>"
            )

            $vaultGroups = $rgGrp.Group | Group-Object -Property VaultName
            foreach ($vGrp in $vaultGroups) {
                $vName   = $vGrp.Name
                $vSafeId = "${safeId}_$($vName -replace '[^A-Za-z0-9]','_')"
                $vmRows  = @($vGrp.Group | Where-Object { $_.BackupType -eq 'Azure VM'   })
                $afsRows = @($vGrp.Group | Where-Object { $_.BackupType -eq 'File Share' })
                $naRows  = @($vGrp.Group | Where-Object { $_.BackupType -eq 'N/A'        })

                if ($vmRows.Count -gt 0) {
                    $vmTblId   = "vm_$vSafeId"; $vmFgId = "vmfg_$vSafeId"
                    $vmAppCt   = ($vmRows | Where-Object { $_.ConsistencyType -eq 'Application Consistent' }).Count
                    $vmCrashCt = ($vmRows | Where-Object { $_.ConsistencyType -eq 'Crash Consistent'       }).Count
                    $vmFileCt  = ($vmRows | Where-Object { $_.ConsistencyType -eq 'File-System Consistent' }).Count
                    [void]$tabPanelHtml.Append(
                        "<div class='tbl-block'><div class='tbl-hdr tbl-hdr-vm'><div class='tbl-hl'>" +
                        "<svg class='tbl-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><rect x='2' y='3' width='20' height='14' rx='2'/><line x1='8' y1='21' x2='16' y2='21'/><line x1='12' y1='17' x2='12' y2='21'/></svg>" +
                        "<span class='tbl-title'>Azure Virtual Machines</span><span class='tbl-ct'>$($vmRows.Count) items</span><span class='vault-lbl'>Vault: $(ConvertTo-SafeHtml $vName)</span></div>" +
                        "<div class='tbl-hr'><div class='fgrp' id='$vmFgId'>" +
                        "<button class='fb on' onclick='filterTable(`"$vmTblId`",`"$vmFgId`",`"all`",this)'>All</button>" +
                        "<button class='fb' onclick='filterTable(`"$vmTblId`",`"$vmFgId`",`"Healthy`",this)'>Healthy</button>" +
                        "<button class='fb' onclick='filterTable(`"$vmTblId`",`"$vmFgId`",`"Warning`",this)'>Warning</button>" +
                        "<button class='fb' onclick='filterTable(`"$vmTblId`",`"$vmFgId`",`"Failed`",this)'>Failed</button></div>" +
                        "<select class='cdd' id='cg_$vmTblId' onchange='filterCons(`"$vmTblId`",this.value)'>" +
                        "<option value='all'>&#9679; All Consistency ($($vmRows.Count))</option>" +
                        "<option value='Application Consistent'>&#10003; App Consistent ($vmAppCt)</option>" +
                        "<option value='Crash Consistent' style='color:#c41e1e;font-weight:700'>&#9888; Crash Consistent ($vmCrashCt)</option>" +
                        "<option value='File-System Consistent'>&#128194; File-System ($vmFileCt)</option>" +
                        "</select>" +
                        "<input class='srch' type='text' placeholder='Search VMs...' oninput='searchTable(`"$vmTblId`",this.value)'>" +
                        "</div></div><div class='tbl-scroll'><table class='dt' id='$vmTblId'><thead><tr>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",0)'>VM Name &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",1)'>Status &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",2)'>Last Backup &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",3)' data-sort-numeric='1'>Age &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",4)'>Last Bkp Status &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",5)'>Pre-Backup Health &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",6)'>Consistency &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",7)'>Recovery Type &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",8)'>Latest RP &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$vmTblId`",9)'>Policy &#8597;</th>" +
                        "<th>Protection State</th></tr></thead><tbody>"
                    )
                    foreach ($row in $vmRows) {
                        $stCls = switch ($row.BackupStatus) { 'Healthy'{'st-ok'} 'Warning'{'st-warn'} 'Failed'{'st-fail'} default{'st-na'} }
                        $stSvg = switch ($row.BackupStatus) {
                            'Healthy' { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' }
                            'Warning' { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
                            'Failed'  { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' }
                            default   { '' }
                        }
                        $rowCls  = switch ($row.BackupStatus) { 'Failed'{'row-f'} 'Warning'{'row-w'} default{''} }
                        $consCls = if ($row.ConsistencyType -eq 'Crash Consistent') { ' row-crash-cons' } else { '' }
                        $preCss  = Get-PreBackupBadgeCss    -Status $row.PreBackupStatus
                        $cnCss   = Get-ConsistencyBadgeCss  -Cons   $row.ConsistencyType
                        $rtCss   = Get-RecoveryTypeBadgeCss -RType  $row.RecoveryType
                        [void]$tabPanelHtml.Append(
                            "<tr class='$rowCls$consCls' data-status='$($row.BackupStatus)' data-cons='$($row.ConsistencyType)' data-age='$($row.BackupAgeHours)'>" +
                            "<td class='c-name'>$(ConvertTo-SafeHtml $row.ResourceName)</td>" +
                            "<td><span class='badge $stCls'>$stSvg $($row.BackupStatus)</span></td>" +
                            "<td class='c-dt'>$($row.LastBackupTime)</td><td class='c-age'>$($row.BackupAge)</td>" +
                            "<td class='c-lbs'>$(ConvertTo-SafeHtml $row.LastBackupStatus)</td>" +
                            "<td><span class='badge $preCss'>$(ConvertTo-SafeHtml $row.PreBackupStatus)</span></td>" +
                            "<td><span class='badge $cnCss'>$(ConvertTo-SafeHtml $row.ConsistencyType)</span></td>" +
                            "<td><span class='badge $rtCss'>$(ConvertTo-SafeHtml $row.RecoveryType)</span></td>" +
                            "<td class='c-rp'>$($row.LatestRPTime)</td>" +
                            "<td class='c-pol'>$(ConvertTo-SafeHtml $row.PolicyName)</td>" +
                            "<td class='c-ps'>$(ConvertTo-SafeHtml $row.ProtectionState)</td></tr>"
                        )
                    }
                    [void]$tabPanelHtml.Append("</tbody></table></div></div>")
                }

                if ($afsRows.Count -gt 0) {
                    $afsTblId = "afs_$vSafeId"; $afsFgId = "afsfg_$vSafeId"
                    [void]$tabPanelHtml.Append(
                        "<div class='tbl-block'><div class='tbl-hdr tbl-hdr-afs'><div class='tbl-hl'>" +
                        "<svg class='tbl-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z'/></svg>" +
                        "<span class='tbl-title'>Azure File Shares</span><span class='tbl-ct'>$($afsRows.Count) items</span><span class='vault-lbl'>Vault: $(ConvertTo-SafeHtml $vName)</span></div>" +
                        "<div class='tbl-hr'><div class='fgrp' id='$afsFgId'>" +
                        "<button class='fb on' onclick='filterTable(`"$afsTblId`",`"$afsFgId`",`"all`",this)'>All</button>" +
                        "<button class='fb' onclick='filterTable(`"$afsTblId`",`"$afsFgId`",`"Healthy`",this)'>Healthy</button>" +
                        "<button class='fb' onclick='filterTable(`"$afsTblId`",`"$afsFgId`",`"Warning`",this)'>Warning</button>" +
                        "<button class='fb' onclick='filterTable(`"$afsTblId`",`"$afsFgId`",`"Failed`",this)'>Failed</button></div>" +
                        "<input class='srch' type='text' placeholder='Search shares...' oninput='searchTable(`"$afsTblId`",this.value)'>" +
                        "</div></div><div class='tbl-scroll'><table class='dt' id='$afsTblId'><thead><tr>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",0)'>Share Name &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",1)'>Status &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",2)'>Last Backup &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",3)' data-sort-numeric='1'>Age &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",4)'>Last Bkp Status &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",5)'>Recovery Type &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",6)'>Latest RP &#8597;</th>" +
                        "<th class='sh' onclick='sortTable(`"$afsTblId`",7)'>Policy &#8597;</th>" +
                        "<th>Storage Account</th></tr></thead><tbody>"
                    )
                    foreach ($row in $afsRows) {
                        $stCls = switch ($row.BackupStatus) { 'Healthy'{'st-ok'} 'Warning'{'st-warn'} 'Failed'{'st-fail'} default{'st-na'} }
                        $stSvg = switch ($row.BackupStatus) {
                            'Healthy' { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' }
                            'Warning' { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
                            'Failed'  { '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' }
                            default   { '' }
                        }
                        $rowCls = switch ($row.BackupStatus) { 'Failed'{'row-f'} 'Warning'{'row-w'} default{''} }
                        $rtCss  = Get-RecoveryTypeBadgeCss -RType $row.RecoveryType
                        [void]$tabPanelHtml.Append(
                            "<tr class='$rowCls' data-status='$($row.BackupStatus)' data-age='$($row.BackupAgeHours)'>" +
                            "<td class='c-name'>$(ConvertTo-SafeHtml $row.ResourceName)</td>" +
                            "<td><span class='badge $stCls'>$stSvg $($row.BackupStatus)</span></td>" +
                            "<td class='c-dt'>$($row.LastBackupTime)</td><td class='c-age'>$($row.BackupAge)</td>" +
                            "<td class='c-lbs'>$(ConvertTo-SafeHtml $row.LastBackupStatus)</td>" +
                            "<td><span class='badge $rtCss'>$(ConvertTo-SafeHtml $row.RecoveryType)</span></td>" +
                            "<td class='c-rp'>$($row.LatestRPTime)</td>" +
                            "<td class='c-pol'>$(ConvertTo-SafeHtml $row.PolicyName)</td>" +
                            "<td class='c-sa'>$(ConvertTo-SafeHtml $row.StorageAccount)</td></tr>"
                        )
                    }
                    [void]$tabPanelHtml.Append("</tbody></table></div></div>")
                }

                if ($naRows.Count -gt 0) {
                    [void]$tabPanelHtml.Append(
                        "<div class='tbl-block'><div style='padding:14px 16px;font-size:12.5px;color:#9ca3af;font-style:italic'>" +
                        "$(ConvertTo-SafeHtml $naRows[0].ResourceName) &mdash; Vault: $(ConvertTo-SafeHtml $vName)</div></div>"
                    )
                }
            }
            [void]$tabPanelHtml.Append("</div></div>")
        }
        [void]$tabPanelHtml.Append("</div></div>")
    }

    # Alert HTML
    $alertHtml = [System.Text.StringBuilder]::new()
    if ($alertCount -gt 0) {
        foreach ($item in $alertItems) {
            $stCls = if ($item.BackupStatus -eq 'Failed') { 'st-fail' } else { 'st-warn' }
            $stIcon= if ($item.BackupStatus -eq 'Failed') { '&#10007;' } else { '&#9888;' }
            $tpCls = if ($item.BackupType -eq 'Azure VM') { 'tp-vm' } else { 'tp-afs' }
            $tpTxt = if ($item.BackupType -eq 'Azure VM') { '&#128187; VM' } else { '&#128193; Share' }
            $preCss= Get-PreBackupBadgeCss -Status $item.PreBackupStatus
            [void]$alertHtml.Append(
                "<tr class='alert-row'><td><span class='tp $tpCls'>$tpTxt</span></td>" +
                "<td class='an'>$(ConvertTo-SafeHtml $item.ResourceName)</td>" +
                "<td><span class='badge $stCls'>$stIcon $($item.BackupStatus)</span></td>" +
                "<td class='asub'>$(ConvertTo-SafeHtml $item.SubscriptionName)</td>" +
                "<td class='arg'>$(ConvertTo-SafeHtml $item.ResourceGroup)</td>" +
                "<td class='avt'>$(ConvertTo-SafeHtml $item.VaultName)</td>" +
                "<td class='adt'>$($item.LastBackupTime)</td><td class='cage'>$($item.BackupAge)</td>" +
                "<td><span class='badge $preCss'>$(ConvertTo-SafeHtml $item.PreBackupStatus)</span></td></tr>"
            )
        }
    } else {
        [void]$alertHtml.Append("<tr><td colspan='9' class='all-ok-cell'>&#10003; All backup items are healthy</td></tr>")
    }
    $alertHdrTxt = if ($alertCount -gt 0) { "Critical Alerts &mdash; ${alertCount} item(s) Failed or Warning" } else { "No Critical Alerts" }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Azure Backup Dashboard v5.2</title>')
    [void]$sb.Append('<style>@import url(''https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'');')
    [void]$sb.Append('*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:root{--bg:#f0f2f5;--card:#fff;--bdr:#e1e4e8;--bdr2:#c9cdd2;--tx:#1a1a2e;--tx2:#2d3748;--tx3:#718096;--tx4:#a0aec0;--ok:#107c10;--ok-bg:#f3faf3;--ok-b:#9fd89f;--wn:#b45309;--wn-bg:#fffbeb;--wn-b:#fcd34d;--fl:#c41e1e;--fl-bg:#fdf3f3;--fl-b:#f5a5a5;--bl:#0078d4;--bl-bg:#eff6ff;--bl-b:#90c8f0;--or:#b36200;--or-bg:#fff4e5;--or-b:#ffc97e;--te:#0e7c7b;--te-bg:#f0fafa;--te-b:#81cfce;--az:#0072c6;--f:"Inter",system-ui,sans-serif;--m:"JetBrains Mono",monospace}')
    [void]$sb.Append('html{scroll-behavior:smooth}body{font-family:var(--f);background:var(--bg);color:var(--tx);font-size:13.5px;line-height:1.5;min-height:100vh}')
    [void]$sb.Append('.topbar{background:linear-gradient(120deg,#003a6b 0%,#0050a0 50%,#006bc1 100%);padding:0 32px;display:flex;align-items:stretch;min-height:68px;box-shadow:0 2px 12px rgba(0,0,0,.25)}.tb-brand{display:flex;flex-direction:column;justify-content:center;padding:14px 0;flex:1;min-width:0}.tb-eyebrow{font-size:9px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}.tb-title{font-size:20px;font-weight:700;color:#fff;letter-spacing:-.025em}.tb-title span{color:#7ec8ff}.tb-sub{font-size:10.5px;color:rgba(255,255,255,.35);font-family:var(--m);margin-top:2px}.tb-kpis{display:flex;border-left:1px solid rgba(255,255,255,.12);margin-left:20px}.kp{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:76px;padding:12px 18px;border-right:1px solid rgba(255,255,255,.08)}.kv{font-size:28px;font-weight:700;font-family:var(--m);color:#fff;line-height:1}.kl{font-size:9px;text-transform:uppercase;letter-spacing:.13em;color:rgba(255,255,255,.38);margin-top:3px;white-space:nowrap}.kp.k-ok .kv{color:#5dd55d}.kp.k-wn .kv{color:#ffc060}.kp.k-fl .kv{color:#ff7070}')
    [void]$sb.Append('.meta-bar{background:#162032;padding:7px 32px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;border-bottom:1px solid #1e2d3d}.mb-item{font-size:11px;color:#8da5be;font-family:var(--m);display:flex;align-items:center;gap:5px}.mb-item b{color:#c8daf0}.mb-sep{width:1px;height:14px;background:#253448}')
    [void]$sb.Append('.sum-sec{padding:18px 32px 4px}.sec-label{font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);margin-bottom:10px}.sub-cards{display:flex;gap:10px;flex-wrap:wrap}.sub-card{background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:14px;cursor:pointer;min-width:190px;flex:1 1 190px;max-width:320px;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:all .18s;position:relative;overflow:hidden}.sub-card::after{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--az),#60b8ff)}.sub-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.11)}.sc-top{display:flex;align-items:center;gap:11px;margin-bottom:9px}.donut-svg{width:52px;height:52px;flex-shrink:0}.sc-info{flex:1;min-width:0}.sc-name{font-size:13px;font-weight:700;color:var(--tx);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}.sc-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}.sc-counts{display:flex;gap:8px;margin-top:3px}.ok-ct{font-size:11px;font-weight:700;color:var(--ok)}.wn-ct{font-size:11px;font-weight:700;color:var(--wn)}.fl-ct{font-size:11px;font-weight:700;color:var(--fl)}.sc-bar{height:3px;background:#e8ecf0;border-radius:3px;overflow:hidden;margin:6px 0 8px}.sc-bar-fill{height:100%;border-radius:3px}.sc-tags{display:flex;gap:5px;flex-wrap:wrap}.sc-tag{font-size:10px;padding:1px 7px;border-radius:20px;font-weight:600}.vm-tag{background:var(--or-bg);color:var(--or);border:1px solid var(--or-b)}.afs-tag{background:var(--te-bg);color:var(--te);border:1px solid var(--te-b)}.t-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:var(--bl-bg);color:var(--bl);border:1px solid var(--bl-b);font-family:var(--m);font-weight:600}')
    [void]$sb.Append('.alert-sec{padding:12px 32px}.alert-box{background:var(--card);border:1px solid var(--fl-b);border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)}.alert-ok-box{border-color:var(--ok-b)}.alert-hdr{background:#fdf3f3;border-bottom:1px solid var(--fl-b);padding:10px 16px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#9b1c1c}.alert-ok-box .alert-hdr{background:var(--ok-bg);border-bottom-color:var(--ok-b);color:var(--ok)}.alert-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.alert-tbl th{padding:7px 12px;text-align:left;font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);background:#fafbfc;border-bottom:1px solid var(--bdr2);white-space:nowrap}.alert-tbl td{padding:8px 12px;border-bottom:1px solid rgba(220,38,38,.07);vertical-align:middle}.alert-row:hover td{background:#fff7f7}.all-ok-cell{text-align:center;padding:14px!important;color:var(--ok);font-weight:500}.an{font-family:var(--m);font-size:11.5px;font-weight:700;max-width:220px;word-break:break-all}.asub{font-weight:600;font-size:12px}.arg,.avt{font-family:var(--m);font-size:11px;color:var(--tx3)}.adt{font-family:var(--m);font-size:11.5px;white-space:nowrap}')
    [void]$sb.Append('.tab-bar{background:var(--card);border-bottom:2px solid var(--bdr);padding:0 32px;display:flex;align-items:flex-end;gap:1px;flex-wrap:wrap;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.07)}.tab-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border:none;border-bottom:3px solid transparent;margin-bottom:-2px;background:none;cursor:pointer;font-family:var(--f);font-size:13px;font-weight:500;color:var(--tx3);transition:.15s;white-space:nowrap}.tab-btn:hover{color:var(--az);background:#f0f7ff}.tab-active{color:var(--az)!important;border-bottom-color:var(--az)!important;font-weight:700}.tab-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}.dot-g{background:#107c10}.dot-y{background:#f59e0b}.dot-r{background:#c41e1e}.tab-nm{max-width:170px;overflow:hidden;text-overflow:ellipsis}.tab-ct{background:#eef1f4;color:var(--tx2);border-radius:12px;padding:1px 7px;font-size:10.5px;font-weight:700}.tab-panel{display:none}.pan-active{display:block;animation:fadeUp .16s ease}@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}')
    [void]$sb.Append('.sub-strip{background:linear-gradient(120deg,#0d1b2a,#12325e);padding:12px 32px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}.ss-kpi{display:flex;flex-direction:column;align-items:center;min-width:44px}.ss-v{font-size:22px;font-weight:700;color:#fff;font-family:var(--m);line-height:1}.ss-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.4);margin-top:2px}.ok-kpi .ss-v{color:#5dd55d}.wn-kpi .ss-v{color:#ffc060}.fl-kpi .ss-v{color:#ff7070}.ss-divider{width:1px;height:28px;background:rgba(255,255,255,.12)}.ss-bar-wrap{flex:1;min-width:120px;display:flex;flex-direction:column;gap:4px}.ss-bar-lbl{font-size:11px;color:rgba(255,255,255,.45);font-family:var(--m)}.ss-bar-lbl b{color:#d0e8ff}.ss-bar{height:4px;background:rgba(255,255,255,.12);border-radius:99px;overflow:hidden}.ss-fill{height:100%;background:linear-gradient(90deg,#107c10,#5dd55d);border-radius:99px}')
    [void]$sb.Append('.rg-list{padding:14px 32px;display:flex;flex-direction:column;gap:8px}.rgc{background:var(--card);border:1px solid var(--bdr);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}.rg-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;cursor:pointer;user-select:none;background:#fafbfc;border-left:3px solid var(--az);transition:background .14s}.rg-hdr:hover{background:#f0f6ff}.rg-l{display:flex;align-items:center;gap:9px;flex:1;min-width:0}.rg-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}.rg-ico{width:16px;height:16px;color:var(--az);flex-shrink:0}.rg-name{font-size:13.5px;font-weight:700;color:var(--tx)}.rg-meta{font-size:10.5px;color:var(--tx3);font-family:var(--m);margin-top:1px}.rg-r{display:flex;align-items:center;gap:7px;flex-shrink:0}.pill{font-size:10.5px;padding:2px 8px;border-radius:20px;font-weight:700}.ok-pill{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-b)}.wn-pill{background:var(--wn-bg);color:var(--wn);border:1px solid var(--wn-b)}.fl-pill{background:var(--fl-bg);color:var(--fl);border:1px solid var(--fl-b)}.rg-hp{width:64px;height:4px;background:#e8ecf0;border-radius:99px;overflow:hidden}.rg-hp-fill{height:100%;background:linear-gradient(90deg,#107c10,#5dd55d);border-radius:99px}.chev{width:16px;height:16px;color:var(--tx4);transition:transform .28s;flex-shrink:0}.rg-body{display:none;border-top:1px solid var(--bdr)}.rgc.rg-open .rg-body{display:block}.rgc.rg-open .chev{transform:rotate(180deg)}')
    [void]$sb.Append('.tbl-block{border-top:1px solid var(--bdr)}.tbl-block:first-child{border-top:none}.tbl-hdr{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;flex-wrap:wrap;gap:7px}.tbl-hdr-vm{background:linear-gradient(90deg,#fff4e6,#fffaf5);border-left:3px solid var(--or)}.tbl-hdr-afs{background:linear-gradient(90deg,#f0fafa,#f8fffe);border-left:3px solid var(--te)}.tbl-hl{display:flex;align-items:center;gap:7px}.tbl-hr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tbl-ico{width:15px;height:15px}.tbl-hdr-vm .tbl-ico{color:var(--or)}.tbl-hdr-afs .tbl-ico{color:var(--te)}.tbl-title{font-size:13px;font-weight:700}.tbl-hdr-vm .tbl-title{color:var(--or)}.tbl-hdr-afs .tbl-title{color:var(--te)}.tbl-ct{font-size:11px;color:var(--tx3);background:rgba(0,0,0,.045);border-radius:20px;padding:1px 7px;font-weight:600}.vault-lbl{font-size:10.5px;color:var(--tx4);font-family:var(--m)}.fgrp{display:flex;gap:3px}.fb{padding:4px 11px;border:1px solid var(--bdr2);border-radius:20px;background:var(--card);font-family:var(--f);font-size:11.5px;font-weight:500;color:var(--tx3);cursor:pointer;transition:.12s}.fb:hover{border-color:var(--az);color:var(--az)}.fb.on{background:var(--az);color:#fff;border-color:var(--az)}.srch{padding:5px 10px;border:1px solid var(--bdr2);border-radius:6px;font-family:var(--f);font-size:12.5px;background:var(--card);color:var(--tx);outline:none;width:190px}.srch:focus{border-color:var(--az);box-shadow:0 0 0 2px rgba(0,120,212,.15)}')
    [void]$sb.Append('.tbl-scroll{overflow-x:auto}.dt{width:100%;border-collapse:collapse;font-size:13px}.dt thead tr{background:#f3f6fa;border-bottom:2px solid var(--bdr2)}.dt th{padding:9px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--tx3);white-space:nowrap;border-bottom:1px solid var(--bdr2)}.dt td{padding:10px 12px;border-bottom:1px solid #edf0f4;vertical-align:middle}.dt tbody tr:hover td{background:#f5f8ff}.dt tbody tr:last-child td{border-bottom:none}.sh{cursor:pointer;user-select:none;transition:color .12s,background .12s}.sh:hover{color:var(--az);background:#ebf4ff}.row-f{background:#fef5f5}.row-f:hover td{background:#fce8e8!important}.row-w{background:#fffcf0}.row-w:hover td{background:#fef9e2!important}.c-name{font-weight:700;color:var(--tx);font-family:var(--m);font-size:12.5px;min-width:150px;max-width:280px;word-break:break-word}.c-dt{font-family:var(--m);font-size:12px;color:var(--tx2);white-space:nowrap}.c-age{font-family:var(--m);font-size:12.5px;font-weight:700;color:var(--bl);white-space:nowrap}.c-lbs{font-family:var(--m);font-size:12px;color:var(--tx2);white-space:nowrap}.c-rp{font-family:var(--m);font-size:11.5px;color:var(--tx3);white-space:nowrap}.c-pol{font-family:var(--m);font-size:11.5px;color:var(--tx3);min-width:120px;max-width:200px;word-break:break-word}.c-sa{font-family:var(--m);font-size:12px;color:var(--tx2)}.c-ps{font-family:var(--m);font-size:12px;color:var(--tx2);white-space:nowrap}')
    [void]$sb.Append('.badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}.badge svg{flex-shrink:0;width:12px;height:12px}.st-ok{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-b)}.st-warn{background:var(--wn-bg);color:var(--wn);border:1px solid var(--wn-b)}.st-fail{background:var(--fl-bg);color:var(--fl);border:1px solid var(--fl-b)}.st-na{background:#f4f5f7;color:var(--tx4);border:1px solid var(--bdr)}.pre-ok{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-b)}.pre-warn{background:var(--wn-bg);color:var(--wn);border:1px solid var(--wn-b)}.pre-fail{background:var(--fl-bg);color:var(--fl);border:1px solid var(--fl-b)}.pre-na{background:#f4f5f7;color:var(--tx4);border:1px solid var(--bdr)}.rt-snap{background:#f5f0fc;color:#5c2d91;border:1px solid #c5a5e8}.rt-vault{background:#e8f4fd;color:#0058a3;border:1px solid #7ab8e0}.rt-archive{background:#fdf6ec;color:#7a5200;border:1px solid #d4a94e}.rt-na{background:#f4f5f7;color:var(--tx4);border:1px solid var(--bdr)}.rt-snapvault{background:#eef5ed;color:#1a6b1a;border:1px solid #8cc98c}.cn-app{background:#f3faf3;color:#107c10;border:1px solid #9fd89f}.cn-crash{background:#fff4e5;color:#b36200;border:1px solid #ffc97e}.cn-file{background:#f0f6ff;color:#0050a0;border:1px solid #90c8f0}.cn-na{background:#f4f5f7;color:var(--tx4);border:1px solid var(--bdr)}.tp{display:inline-block;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700}.tp-vm{background:var(--or-bg);color:var(--or);border:1px solid var(--or-b)}.tp-afs{background:var(--te-bg);color:var(--te);border:1px solid var(--te-b)}')
    [void]$sb.Append('.cons-sec{padding:8px 32px 14px}.cons-cards{display:flex;gap:10px;flex-wrap:wrap}.cons-card{background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:14px 18px;min-width:180px;flex:1 1 180px;max-width:280px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;align-items:center;gap:14px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden}.cons-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.12)}.cons-card::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px}.app-card::after{background:#107c10}.crash-card::after{background:#c41e1e}.file-card::after{background:#0072c6}.cons-icon{width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.app-icon{background:#f3faf3;color:#107c10}.crash-icon{background:#fdf3f3;color:#c41e1e}.file-icon{background:#eff6ff;color:#0072c6}.cons-icon svg{width:20px;height:20px}.cons-val{font-size:26px;font-weight:700;font-family:var(--m);line-height:1}.app-card .cons-val{color:#107c10}.crash-card .cons-val{color:#c41e1e}.file-card .cons-val{color:#0072c6}.cons-lbl{font-size:11.5px;font-weight:700;color:var(--tx2);margin-top:3px}.cons-sub{font-size:10px;color:var(--tx4);margin-top:2px}.row-crash-cons td{background-color:#fff5f5!important}.row-crash-cons td:first-child{border-left:3px solid #c41e1e}.row-crash-cons:hover td{background-color:#fce8e8!important}.cdd{padding:5px 10px;border:1px solid var(--bdr2);border-radius:6px;font-family:var(--f);font-size:12px;background:var(--card);color:var(--tx);outline:none;cursor:pointer;height:32px}.cdd:focus{border-color:var(--az);box-shadow:0 0 0 2px rgba(0,120,212,.15)}@keyframes crashPulse{0%,100%{box-shadow:0 1px 4px rgba(0,0,0,.06),0 0 0 0 rgba(196,30,30,0)}50%{box-shadow:0 1px 4px rgba(0,0,0,.06),0 0 0 5px rgba(196,30,30,.3)}}.crash-alert{animation:crashPulse 2s ease-in-out infinite}')
    [void]$sb.Append('.cons-bar{background:#fff;border-bottom:2px solid var(--bdr);padding:9px 32px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.04)}.cons-bar-lbl{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--tx4);margin-right:4px;white-space:nowrap}.cdr{position:relative;display:inline-block}.cdr-btn{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:6px;border:1.5px solid var(--bdr2);background:var(--card);font-family:var(--f);font-size:12.5px;font-weight:600;cursor:pointer;transition:.14s;white-space:nowrap;user-select:none}.cdr-btn:hover,.cdr.open .cdr-btn{border-color:var(--az);color:var(--az);background:#f0f7ff}.cdr-ct{font-family:var(--m);font-size:14px;font-weight:700;min-width:20px;text-align:right}.cdr-app .cdr-ct,.cdr-app.open .cdr-btn{color:#107c10}.cdr-crash .cdr-ct{color:#c41e1e}.cdr-file .cdr-ct{color:#0072c6}.cdr-crash .cdr-btn{border-color:#f5a5a5;background:#fdf3f3;color:#9b1c1c}.cdr-crash .cdr-btn:hover,.cdr-crash.open .cdr-btn{border-color:#c41e1e;background:#fde8e8;color:#c41e1e}.cdr-chev{width:12px;height:12px;transition:transform .2s;flex-shrink:0}.cdr.open .cdr-chev{transform:rotate(180deg)}.cdr-panel{display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:500px;max-width:640px;background:#fff;border:1.5px solid var(--bdr2);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.14);z-index:600;overflow:hidden}.cdr-crash .cdr-panel{border-color:#f5a5a5}.cdr.open .cdr-panel{display:block}.cdr-ph{padding:8px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:#f8fafc;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px}.cdr-ph .cdr-ph-title{flex:1}.cdr-crash .cdr-ph{background:#fdf3f3;border-bottom-color:#f5a5a5;color:#9b1c1c}.cdr-body{max-height:300px;overflow-y:auto}.vl-row{display:grid;grid-template-columns:20px 1fr 160px 130px;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid #f0f2f5;font-size:12.5px;transition:background .1s}.vl-row:last-child{border-bottom:none}.vl-row:hover{background:#f5f8ff}.vl-crash{background:#fff5f5!important}.vl-crash:hover{background:#fce8e8!important}.vl-dot{font-size:11px;font-weight:700;text-align:center}.vl-ok{color:#107c10}.vl-wn{color:#b45309}.vl-fl{color:#c41e1e}.vl-na{color:#a0aec0}.vl-name{font-family:var(--m);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vl-crash .vl-name{color:#c41e1e}.vl-sub{font-size:11px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vl-vault{font-size:10.5px;color:var(--tx4);font-family:var(--m);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vl-th{display:grid;grid-template-columns:20px 1fr 160px 130px;gap:8px;padding:5px 14px;background:#f3f6fa;border-bottom:1px solid var(--bdr2);font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}.vl-empty{padding:14px;text-align:center;color:var(--tx4);font-size:12px;font-style:italic}@keyframes crashPulseBtn{0%,100%{box-shadow:0 0 0 0 rgba(196,30,30,0)}50%{box-shadow:0 0 0 4px rgba(196,30,30,.25)}}.crash-btn-pulse{animation:crashPulseBtn 2s ease-in-out infinite}')
    [void]$sb.Append('.footer{padding:10px 32px;border-top:1px solid var(--bdr);background:var(--card);display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--tx4);font-family:var(--m);flex-wrap:wrap;gap:8px}')
    [void]$sb.Append('@media(max-width:860px){.topbar,.meta-bar,.sum-sec,.alert-sec,.tab-bar,.rg-list,.sub-strip,.footer{padding-left:14px;padding-right:14px}.topbar{flex-direction:column;min-height:unset;padding-top:14px;padding-bottom:14px}.tb-kpis{border-left:none;border-top:1px solid rgba(255,255,255,.1);margin-left:0;flex-wrap:wrap}.kp{min-width:60px;padding:8px 12px}}')
    [void]$sb.Append('</style></head><body>')

    [void]$sb.Append("<div class='topbar'><div class='tb-brand'>")
    [void]$sb.Append("<div class='tb-eyebrow'>Azure Backup Intelligence Monitor v5.2</div>")
    [void]$sb.Append("<div class='tb-title'>Recovery Services <span>Backup</span> Dashboard</div>")
    [void]$sb.Append("<div class='tb-sub'>Generated: $reportTime &nbsp;&middot;&nbsp; $tenantCount tenant(s) &nbsp;&middot;&nbsp; Token-Cached &nbsp;&middot;&nbsp; Read-Only</div>")
    [void]$sb.Append("</div><div class='tb-kpis'>")
    [void]$sb.Append("<div class='kp'><div class='kv'>$totalCount</div><div class='kl'>Total</div></div>")
    [void]$sb.Append("<div class='kp k-ok'><div class='kv'>$healthyCount</div><div class='kl'>Healthy</div></div>")
    [void]$sb.Append("<div class='kp k-wn'><div class='kv'>$warningCount</div><div class='kl'>Warning</div></div>")
    [void]$sb.Append("<div class='kp k-fl'><div class='kv'>$failedCount</div><div class='kl'>Failed</div></div>")
    [void]$sb.Append("<div class='kp'><div class='kv'>$vmCount</div><div class='kl'>VMs</div></div>")
    [void]$sb.Append("<div class='kp'><div class='kv'>$afsCount</div><div class='kl'>Shares</div></div>")
    [void]$sb.Append("</div></div>")
    [void]$sb.Append("<div class='meta-bar'>")
    [void]$sb.Append("<div class='mb-item'>&#128100; <b>$(ConvertTo-SafeHtml $loggedInUser)</b></div><div class='mb-sep'></div>")
    [void]$sb.Append("<div class='mb-item'>&#127970; <b>$tenantCount</b> Tenant(s)</div><div class='mb-sep'></div>")
    [void]$sb.Append("<div class='mb-item'>&#128194; <b>$subCount</b> Subscriptions</div><div class='mb-sep'></div>")
    [void]$sb.Append("<div class='mb-item'>&#127968; <b>$rgCount</b> Resource Groups</div><div class='mb-sep'></div>")
    [void]$sb.Append("<div class='mb-item'>&#127958; <b>$vaultCount</b> Vaults</div><div class='mb-sep'></div>")
    [void]$sb.Append("<div class='mb-item'>&#128274; Token-Cached &nbsp;&middot;&nbsp; Read-Only &nbsp;&middot;&nbsp; Auto-Scan All Subscriptions</div></div>")
    $crashBtnExtraCls = if ($crashConsistCount -gt 0) { ' crash-btn-pulse' } else { '' }
    [void]$sb.Append("<div class='cons-bar'><span class='cons-bar-lbl'>&#128196; VM Consistency</span>")
    [void]$sb.Append("<div class='cdr cdr-app' id='cdrApp'><div class='cdr-btn' onclick='toggleCdr(`"cdrApp`")'>" +
        "<svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polyline points='20 6 9 17 4 12'/></svg>" +
        "Application Consistent <span class='cdr-ct'>$appConsistCount</span>" +
        "<svg class='cdr-chev' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg></div>" +
        "<div class='cdr-panel'><div class='cdr-ph'><span class='cdr-ph-title'>Application Consistent VMs &mdash; $appConsistCount total</span></div>" +
        "<div class='vl-th'><span></span><span>VM Name</span><span>Subscription</span><span>Vault</span></div>" +
        "<div class='cdr-body'>$($consDropAppHtml.ToString())</div></div></div>")
    [void]$sb.Append("<div class='cdr cdr-crash$crashBtnExtraCls' id='cdrCrash'><div class='cdr-btn' onclick='toggleCdr(`"cdrCrash`")'>" +
        "<svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>" +
        "Crash Consistent <span class='cdr-ct'>$crashConsistCount</span>" +
        "<svg class='cdr-chev' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg></div>" +
        "<div class='cdr-panel'><div class='cdr-ph'><span class='cdr-ph-title'>&#9888; Crash Consistent VMs &mdash; $crashConsistCount total &mdash; Review Recommended</span></div>" +
        "<div class='vl-th'><span></span><span>VM Name</span><span>Subscription</span><span>Vault</span></div>" +
        "<div class='cdr-body'>$($consDropCrashHtml.ToString())</div></div></div>")
    [void]$sb.Append("<div class='cdr cdr-file' id='cdrFile'><div class='cdr-btn' onclick='toggleCdr(`"cdrFile`")'>" +
        "<svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><polyline points='14 2 14 8 20 8'/></svg>" +
        "File-System Consistent <span class='cdr-ct'>$fileConsistCount</span>" +
        "<svg class='cdr-chev' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg></div>" +
        "<div class='cdr-panel'><div class='cdr-ph'><span class='cdr-ph-title'>File-System Consistent VMs &mdash; $fileConsistCount total</span></div>" +
        "<div class='vl-th'><span></span><span>VM Name</span><span>Subscription</span><span>Vault</span></div>" +
        "<div class='cdr-body'>$($consDropFileHtml.ToString())</div></div></div>")
    [void]$sb.Append("</div>")
    [void]$sb.Append("<div class='sum-sec'><div class='sec-label'>Subscription Health &mdash; click to jump</div><div class='sub-cards'>$($subCardHtml.ToString())</div></div>")
    $crashCardCls = if ($crashConsistCount -gt 0) { 'cons-card crash-card crash-alert' } else { 'cons-card crash-card' }
    [void]$sb.Append("<div class='cons-sec'><div class='sec-label'>VM Backup Consistency &mdash; click a card to filter all tables</div><div class='cons-cards'>")
    [void]$sb.Append("<div class='cons-card app-card' onclick='filterAllByConsistency(`"Application Consistent`")'><div class='cons-icon app-icon'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/><polyline points='22 4 12 14.01 9 11.01'/></svg></div><div><div class='cons-val'>$appConsistCount</div><div class='cons-lbl'>Application Consistent</div><div class='cons-sub'>App-aware snapshots &mdash; most reliable</div></div></div>")
    [void]$sb.Append("<div class='$crashCardCls' onclick='filterAllByConsistency(`"Crash Consistent`")'><div class='cons-icon crash-icon'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg></div><div><div class='cons-val'>$crashConsistCount</div><div class='cons-lbl'>Crash Consistent</div><div class='cons-sub'>Point-in-time &mdash; review recommended</div></div></div>")
    [void]$sb.Append("<div class='cons-card file-card' onclick='filterAllByConsistency(`"File-System Consistent`")'><div class='cons-icon file-icon'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/></svg></div><div><div class='cons-val'>$fileConsistCount</div><div class='cons-lbl'>File-System Consistent</div><div class='cons-sub'>FS quiescent snapshot</div></div></div>")
    [void]$sb.Append("</div></div>")
    $alertBoxClass = if ($alertCount -gt 0) { 'alert-box' } else { 'alert-box alert-ok-box' }
    [void]$sb.Append("<div class='alert-sec'><div class='$alertBoxClass'><div class='alert-hdr'>")
    if ($alertCount -gt 0) { [void]$sb.Append('<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#c41e1e"/><path d="M12 7v6M12 16v.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>') }
    else                   { [void]$sb.Append('<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#107c10"/><path d="M7 13l3 3 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') }
    [void]$sb.Append("$alertHdrTxt</div><div style='overflow-x:auto'><table class='alert-tbl'><thead><tr>")
    [void]$sb.Append("<th>Type</th><th>Resource</th><th>Status</th><th>Subscription</th><th>Resource Group</th><th>Vault</th><th>Last Backup</th><th>Age</th><th>Pre-Backup Health</th></tr></thead><tbody>$($alertHtml.ToString())</tbody></table></div></div></div>")
    [void]$sb.Append("<div class='tab-bar'>$($tabBarHtml.ToString())</div>")
    [void]$sb.Append($tabPanelHtml.ToString())
    [void]$sb.Append("<div class='footer'><span>Azure Backup Monitor v5.2 &nbsp;&middot;&nbsp; Token-Cache + Context-Validated &nbsp;&middot;&nbsp; PowerShell 5.1</span><span>Read-Only &nbsp;&middot;&nbsp; Auto-Scan &nbsp;&middot;&nbsp; $reportTime</span></div>")
    [void]$sb.Append('<script>')
    [void]$sb.Append('function activateTab(id){document.querySelectorAll(".tab-panel").forEach(function(p){p.classList.remove("pan-active")});document.querySelectorAll(".tab-btn").forEach(function(b){b.classList.remove("tab-active")});var pan=document.getElementById("pan_"+id);var btn=document.getElementById("tab_"+id);if(pan)pan.classList.add("pan-active");if(btn)btn.classList.add("tab-active");if(pan)pan.scrollIntoView({behavior:"smooth",block:"start"});}')
    [void]$sb.Append('function toggleCdr(id){var el=document.getElementById(id);if(!el)return;var wasOpen=el.classList.contains("open");document.querySelectorAll(".cdr.open").forEach(function(d){d.classList.remove("open");});if(!wasOpen)el.classList.add("open");}document.addEventListener("click",function(e){if(!e.target.closest(".cdr"))document.querySelectorAll(".cdr.open").forEach(function(d){d.classList.remove("open");});});')
    [void]$sb.Append('function applyRowVisibility(tbl){var f=tbl.getAttribute("data-filter")||"all";var q=(tbl.getAttribute("data-query")||"").toLowerCase();var c=tbl.getAttribute("data-cons")||"all";tbl.querySelectorAll("tbody tr").forEach(function(r){var sf=(f==="all"||r.getAttribute("data-status")===f);var sc=(c==="all"||r.getAttribute("data-cons")===c);var sq=(!q||r.textContent.toLowerCase().indexOf(q)>=0);r.style.display=(sf&&sc&&sq)?"":"none";});}')
    [void]$sb.Append('function filterTable(tblId,fgId,status,btn){var tbl=document.getElementById(tblId);if(!tbl)return;tbl.setAttribute("data-filter",status);applyRowVisibility(tbl);var fg=document.getElementById(fgId);if(fg)fg.querySelectorAll(".fb").forEach(function(b){b.classList.remove("on")});if(btn)btn.classList.add("on");}')
    [void]$sb.Append('function searchTable(tblId,query){var tbl=document.getElementById(tblId);if(!tbl)return;tbl.setAttribute("data-query",query);applyRowVisibility(tbl);}')
    [void]$sb.Append('function filterCons(tblId,val){var tbl=document.getElementById(tblId);if(!tbl)return;tbl.setAttribute("data-cons",val);applyRowVisibility(tbl);}')
    [void]$sb.Append('function filterAllByConsistency(val){document.querySelectorAll(".dt").forEach(function(tbl){tbl.setAttribute("data-cons",val);applyRowVisibility(tbl);var sel=document.getElementById("cg_"+tbl.id);if(sel)sel.value=val;});document.querySelectorAll(".rgc").forEach(function(r){r.classList.add("rg-open");});}')
    [void]$sb.Append('function sortTable(tblId,col){var tbl=document.getElementById(tblId);if(!tbl)return;var tbody=tbl.querySelector("tbody");var rows=Array.from(tbody.querySelectorAll("tr"));var asc=tbl.getAttribute("data-sort-col")==col&&tbl.getAttribute("data-sort-dir")==="asc";var th=(tbl.querySelector("thead tr")||{cells:[]}).cells[col];var isNum=th&&th.getAttribute("data-sort-numeric");rows.sort(function(a,b){if(isNum){var an=parseFloat(a.getAttribute("data-age")||"-1");var bn=parseFloat(b.getAttribute("data-age")||"-1");return asc?(bn-an):(an-bn);}var av=(a.cells[col]||{}).textContent||"";var bv=(b.cells[col]||{}).textContent||"";return asc?bv.localeCompare(av):av.localeCompare(bv);});rows.forEach(function(r){tbody.appendChild(r);});tbl.setAttribute("data-sort-col",col);tbl.setAttribute("data-sort-dir",asc?"desc":"asc");}')
    [void]$sb.Append('</script></body></html>')

    [System.IO.File]::WriteAllText($OutputPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
    Write-Log "Report saved: $OutputPath" -Level SUCCESS
}

# =============================================================================
# REGION: MAIN
# =============================================================================

function Start-BackupMonitor {
    Write-Log "=====================================================" -Level INFO
    Write-Log "AZURE BACKUP MONITOR v5.2"                            -Level INFO
    Write-Log "Auth Flow : Silent MSAL cache -> Browser -> Device"   -Level INFO
    Write-Log "Safety    : READ-ONLY — Zero resource modifications"  -Level INFO
    Write-Log "Scope     : Auto-scan ALL tenants/subscriptions"      -Level INFO
    Write-Log "Report    : $($Script:Config.ReportOutputPath)"       -Level INFO
    Write-Log "=====================================================" -Level INFO
    try {
        Test-Prerequisites
        $backupData = Get-AllBackupData
        New-HtmlReport -Data $backupData -OutputPath $Script:Config.ReportOutputPath
        Write-Log "=====================================================" -Level SUCCESS
        Write-Log "COMPLETE"                                              -Level SUCCESS
        Write-Log "Report : $($Script:Config.ReportOutputPath)"          -Level SUCCESS
        Write-Log "Log    : $($Script:Config.LogOutputPath)"             -Level SUCCESS
        Write-Log "=====================================================" -Level SUCCESS
        try { Start-Process $Script:Config.ReportOutputPath } catch { }
    } catch {
        Write-Log "FATAL: $($_.Exception.Message)" -Level ERROR
        Write-Log $_.ScriptStackTrace              -Level ERROR
        exit 1
    }
}

Start-BackupMonitor