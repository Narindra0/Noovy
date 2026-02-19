const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// POST /api/downloads — Record a new download (authenticated)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { bookId } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: 'bookId is required' });
        }

        // Check if book exists
        const bookCheck = await pool.query('SELECT id FROM books WHERE id = $1', [bookId]);
        if (bookCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        // Upsert download record (INSERT ... ON CONFLICT DO NOTHING)
        const result = await pool.query(
            `INSERT INTO downloads (user_id, book_id) VALUES ($1, $2)
       ON CONFLICT (user_id, book_id) DO UPDATE SET downloaded_at = NOW()
       RETURNING *`,
            [userId, bookId]
        );

        res.status(201).json({ download: result.rows[0] });
    } catch (err) {
        console.error('Download error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/downloads — Get user's downloads (authenticated)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;

        const result = await pool.query(
            `SELECT d.id, d.downloaded_at, b.id as book_id, b.title, b.author, b.year, 
              b.description, b.cover_url, b.file_url, b.category, b.pages, b.language
       FROM downloads d
       JOIN books b ON d.book_id = b.id
       WHERE d.user_id = $1
       ORDER BY d.downloaded_at DESC`,
            [userId]
        );

        res.json({ downloads: result.rows, total: result.rows.length });
    } catch (err) {
        console.error('Get downloads error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/downloads/:bookId — Remove a download (authenticated)
router.delete('/:bookId', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { bookId } = req.params;

        await pool.query('DELETE FROM downloads WHERE user_id = $1 AND book_id = $2', [userId, bookId]);

        res.json({ message: 'Download removed' });
    } catch (err) {
        console.error('Delete download error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
