const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : null;

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString ? {
    rejectUnauthorized: false
  } : false,
  // Fallback to individual env vars if connectionString is not provided
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'noovy',
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err.message);
});

module.exports = pool;
