require('dotenv').config();
const bcrypt = require('bcrypt');
const { db, pool } = require('./index');
const { admin_users } = require('./schema');

async function seed() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Admin@OrderFlow1!', 12);

  await db.insert(admin_users).values({
    email: 'admin@001.com.mx',
    password_hash: passwordHash,
    name: 'Admin',
    role: 'admin',
  }).onConflictDoNothing();

  console.log('Seed complete. Admin user: admin@001.com.mx / Admin@OrderFlow1!');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
