// Applies every .sql file in migrations/ in filename order, tracked in a
// schema_migrations table so re-running only applies what's new. This is the
// single source of truth for schema — server.js no longer runs migrations at
// boot (see git history for the old inline runMigrations()).
//
// Usage: node runMigration.js
const fs = require('fs');
const path = require('path');
const pool = require('./db.js');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedMigrations() {
  const result = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map(r => r.filename));
}

async function run() {
  await ensureTrackingTable();
  const applied = await appliedMigrations();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ranCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying ${file}...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  OK`);
      ranCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(ranCount ? `Applied ${ranCount} migration(s).` : 'Already up to date.');
}

run()
  .then(() => pool.end())
  .catch(err => {
    console.error('Migration run failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
