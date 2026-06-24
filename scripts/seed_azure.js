const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed(ownerEmail) {
  if (!ownerEmail) {
    console.error('Usage: node seed_azure.js <ownerEmail>');
    process.exit(1);
  }

  const owner = ownerEmail.toLowerCase().trim();

  const samples = [
    {
      resource_id: `${owner}-vm-01`,
      resource_name: 'Dev-VM-01',
      resource_type: 'Virtual Machine',
      status: 'Healthy',
      region: 'eastus',
      cpu_percent: 12.5,
      memory_percent: 34.2,
      storage_gb: 128
    },
    {
      resource_id: `${owner}-sqldb-01`,
      resource_name: 'AppDB-01',
      resource_type: 'SQL Database',
      status: 'Healthy',
      region: 'eastus2',
      cpu_percent: 5.1,
      memory_percent: 21.3,
      storage_gb: 256
    },
    {
      resource_id: `${owner}-appsvc-01`,
      resource_name: 'WebApp-01',
      resource_type: 'App Service',
      status: 'Warning',
      region: 'westus',
      cpu_percent: 78.4,
      memory_percent: 65.2,
      storage_gb: 10
    }
  ];

  const client = await pool.connect();
  try {
    for (const s of samples) {
      await client.query(`
        INSERT INTO monitoring_azure_resources (
          resource_id, resource_name, resource_type, status, region,
          cpu_percent, memory_percent, storage_gb, last_updated, owner_email, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,NOW(),NOW())
        ON CONFLICT (resource_id) DO UPDATE SET
          resource_name = EXCLUDED.resource_name,
          resource_type = EXCLUDED.resource_type,
          status = EXCLUDED.status,
          region = EXCLUDED.region,
          cpu_percent = EXCLUDED.cpu_percent,
          memory_percent = EXCLUDED.memory_percent,
          storage_gb = EXCLUDED.storage_gb,
          last_updated = NOW(),
          owner_email = EXCLUDED.owner_email,
          updated_at = NOW()
      `, [
        s.resource_id,
        s.resource_name,
        s.resource_type,
        s.status,
        s.region,
        s.cpu_percent,
        s.memory_percent,
        s.storage_gb,
        owner
      ]);
    }

    console.log('Seeded', samples.length, 'Azure resources for', owner);
  } catch (err) {
    console.error('Seed failed:', err.message || err);
  } finally {
    client.release();
    await pool.end();
  }
}

const email = process.argv[2] || process.env.SEED_OWNER_EMAIL;
seed(email).catch(err => { console.error(err); process.exit(1); });
