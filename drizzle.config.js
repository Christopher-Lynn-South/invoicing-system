require('dotenv').config();

/** @type { import("drizzle-kit").Config } */
module.exports = {
  schema: './server/db/schema.js',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DB_URL,
  },
};
