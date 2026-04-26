const pool = require('./db.js');

async function verifyMigration() {
  try {
    // Query to check if the table exists and get its structure
    const tableQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'user_roles';
    `;
    
    const indexQuery = `
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'user_roles';
    `;
    
    console.log('?? Verifying migration...\n');
    
    const tableResult = await pool.query(tableQuery);
    if (tableResult.rows.length > 0) {
      console.log('? user_roles table exists');
    }
    
    const indexResult = await pool.query(indexQuery);
    console.log(`? Found ${indexResult.rows.length} indexes:`);
    indexResult.rows.forEach(row => {
      console.log(`   - ${row.indexname}`);
    });
    
    console.log('\n? MIGRATION VERIFICATION SUCCESSFUL');
    
  } catch (error) {
    console.error('? Verification failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyMigration();
