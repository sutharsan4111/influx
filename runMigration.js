const fs = require('fs');
const path = require('path');
const pool = require('./db.js');

async function executeMigration() {
  try {
    // Read the SQL migration file
    const migrationPath = path.join(__dirname, 'migrations', '008_enable_rls_on_public_tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('?? Migration file read successfully');
    console.log(`File: ${migrationPath}`);
    console.log(`SQL length: ${sql.length} characters`);
    console.log('\n?? SQL Content:');
    console.log('---');
    console.log(sql);
    console.log('---\n');
    
    // Execute the SQL migration
    console.log('?? Executing migration...');
    const result = await pool.query(sql);
    
    console.log('? SUCCESS: Migration executed successfully!');
    console.log(`Command tags:`, result);
    
  } catch (error) {
    console.error('? ERROR: Failed to execute migration');
    console.error(`Error Code: ${error.code}`);
    console.error(`Error Message: ${error.message}`);
    console.error(`Full Error:`, error);
    process.exit(1);
  } finally {
    // Close the pool connection
    await pool.end();
  }
}

executeMigration();
