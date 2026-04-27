const { Pool } = require("pg");

// Production-tuned PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),       // Scale concurrent DB queries
  min: parseInt(process.env.PG_POOL_MIN || '2', 10),        // Keep warm connections ready
  idleTimeoutMillis: 30_000,                                 // Close idle clients after 30s
  connectionTimeoutMillis: 5_000,                            // Fail fast if pool is exhausted
  statement_timeout: 15_000,                                 // Kill runaway queries after 15s
  query_timeout: 15_000,
  keepAlive: true
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err?.message || err);
});

module.exports = pool;
