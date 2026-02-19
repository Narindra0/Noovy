const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Noovy API', timestamp: new Date().toISOString() });
});

// Initialize database tables (only users — books come from Archive.org)
const initDB = async () => {
  try {
    const pool = require('./config/db');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        username VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Database tables initialized (users only)');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
    console.log('⚠️  Make sure PostgreSQL is running and database "noovy" exists.');
  }
};

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Noovy API running on http://localhost:${PORT}`);
  console.log('📚 Books sourced from Archive.org + OpenLibrary');
  await initDB();
});

module.exports = app;
