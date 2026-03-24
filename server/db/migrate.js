require('dotenv').config();
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { db, pool } = require('./index');
const path = require('path');

async function runMigrations() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  console.log('Migrations complete.');
  await pool.end();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
