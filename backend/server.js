const express = require('express');
const cors = require('cors');
require('dotenv').config();

const booksRoutes = require('./routes/books');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/books', booksRoutes);

// Health check endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Noovy API', timestamp: new Date().toISOString() });
});

// Root health check for Uptime Robot / Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Noovy API running on http://localhost:${PORT}`);
  console.log('📚 Books sourced from Backblaze B2 + OpenLibrary');
});

module.exports = app;
