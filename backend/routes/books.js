const express = require('express');
const metadataService = require('../services/metadata');
const { filterBooksByCollection } = require('../services/collections');

const router = express.Router();
let booksService;

try {
    booksService = require('../services/backblaze');
} catch (backblazeError) {
    try {
        booksService = require('../services/archive');
    } catch (archiveError) {
        throw new Error('No books service available: expected ../services/backblaze or ../services/archive');
    }
}

// Helper: add PDF URL to a single book
async function addPdfUrl(book) {
    const fileUrl = await booksService.getPdfUrl(book.id);
    return { ...book, file_url: fileUrl };
}

function parsePagination(query) {
    const rawLimit = parseInt(query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 15;

    const rawPage = parseInt(query.page, 10);
    const page = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;

    const rawOffset = parseInt(query.offset, 10);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : (page - 1) * limit;

    return { page, limit, offset };
}

// GET /api/books — List all books (fetched from Backblaze B2, enriched with OpenLibrary)
router.get('/', async (req, res) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const { collection } = req.query;
        const books = await booksService.getAllBooks();
        const filteredBooks = filterBooksByCollection(books, collection);
        const total = filteredBooks.length;

        const paginated = filteredBooks.slice(offset, offset + limit);
        const enriched = await metadataService.enrichBooks(paginated);
        const hasMore = offset + enriched.length < total;

        res.json({ books: enriched, total, page, limit, hasMore, collection: collection || null });
    } catch (err) {
        console.error('Get books error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/books/featured — Get featured books (first 4)
router.get('/featured', async (req, res) => {
    try {
        const books = await booksService.getAllBooks();
        const featured = books.slice(0, 4);
        const enriched = await metadataService.enrichBooks(featured);

        res.json({ books: enriched, total: enriched.length });
    } catch (err) {
        console.error('Get featured books error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/books/recent — Get recently added books
router.get('/recent', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 5;
        const books = await booksService.getAllBooks();

        const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 5;
        const recent = [...books]
            .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
            .slice(0, safeLimit);
        const enriched = await metadataService.enrichBooks(recent);

        res.json({ books: enriched, total: enriched.length });
    } catch (err) {
        console.error('Get recent books error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/books/search?q= — Search books by title or author
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        const { page, limit, offset } = parsePagination(req.query);

        if (!q) {
            return res.status(400).json({ error: 'Search query (q) is required' });
        }

        const books = await booksService.searchBooks(q);
        const total = books.length;
        const paginated = books.slice(offset, offset + limit);
        const enriched = await metadataService.enrichBooks(paginated);
        const hasMore = offset + enriched.length < total;

        res.json({ books: enriched, total, query: q, page, limit, hasMore });
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/books/categories — No longer applicable (returns empty)
router.get('/categories', (req, res) => {
    res.json({ categories: [] });
});

// GET /api/books/:id — Get a single book by Backblaze B2 identifier (full detail with PDF URL)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const book = await booksService.getBookByIdentifier(id);

        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }

        // Full enrichment: OpenLibrary metadata + PDF URL
        const enriched = await metadataService.enrichBook(book);
        const withPdf = await addPdfUrl(enriched);

        res.json({ book: withPdf });
    } catch (err) {
        console.error('Get book error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
