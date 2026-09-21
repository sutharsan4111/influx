require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Supabase's pooler presents a certificate chain rooted at its own private CA
// (not a public one), so Node's default trust store can't verify it. Pin that
// CA explicitly rather than disabling verification. Extracted from a live
// handshake against the pooler on 2026-09-21; valid until 2031-04-26 — if
// Supabase rotates it before then, re-extract with:
//   openssl s_client -starttls postgres -connect <host>:<port> -showcerts
const SUPABASE_CA = fs.readFileSync(path.join(__dirname, "certs", "supabase-ca.pem"));

// Production-tuned PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: SUPABASE_CA },
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
