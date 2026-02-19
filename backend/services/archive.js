const axios = require('axios');

// Cache configuration
let booksCache = null;
let booksCacheTime = 0;
let inflightFetch = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA_URL = 'https://archive.org/metadata';
const ARCHIVE_DOWNLOAD_URL = 'https://archive.org/download';

/**
 * Parse the Archive.org title format: "[Author] - [Title] --- ..."
 * Example: "A.J.Cronin - Le jardinier espagnol --- (Ny Aiko Boky)"
 */
function parseTitle(rawTitle) {
    const match = rawTitle.match(/^(.+?)\s*-\s*(.+?)\s*---/);
    if (!match) {
        return { author: 'Inconnu', title: rawTitle.trim() };
    }
    return {
        author: match[1].trim(),
        title: match[2].trim(),
    };
}

/**
 * Fetch all books from Archive.org with creator:"noovy library"
 */
async function fetchFromArchive() {
    const response = await axios.get(ARCHIVE_SEARCH_URL, {
        params: {
            q: 'creator:"noovy library"',
            'fl[]': ['identifier', 'title', 'creator'],
            output: 'json',
            rows: 200,
            sort: ['addeddate desc'],
        },
        headers: {
            Authorization: `LOW ${process.env.ARCHIVE_ACCESS_KEY}:${process.env.ARCHIVE_SECRET_KEY}`,
        },
    });

    const docs = response.data.response?.docs || [];

    return docs.map((doc) => {
        const parsed = parseTitle(doc.title);
        return {
            id: doc.identifier,
            title: parsed.title,
            author: parsed.author,
            rawTitle: doc.title,
            cover_url: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
            language: 'Français',
        };
    });
}

/**
 * Get all books (cached)
 */
async function getAllBooks() {
    const now = Date.now();
    if (booksCache && now - booksCacheTime < CACHE_TTL) {
        return booksCache;
    }

    if (inflightFetch) {
        return inflightFetch;
    }

    try {
        inflightFetch = fetchFromArchive();
        const books = await inflightFetch;
        booksCache = books;
        booksCacheTime = now;
        return books;
    } catch (err) {
        console.error('Archive.org fetch error:', err.message);
        // Return cached data if available, even if expired
        if (booksCache) return booksCache;
        throw err;
    } finally {
        inflightFetch = null;
    }
}

/**
 * Get PDF URL for a specific item by fetching its file list
 */
async function getPdfUrl(identifier) {
    try {
        console.log(`[Archive] Resolving PDF for: ${identifier}`);

        let files = [];

        try {
            const filesRes = await axios.get(`${ARCHIVE_METADATA_URL}/${identifier}/files`, { timeout: 6000 });
            files = filesRes.data?.result || [];
        } catch (e) {
            // Fallback endpoint shape
            const metaRes = await axios.get(`${ARCHIVE_METADATA_URL}/${identifier}`, { timeout: 6000 });
            files = metaRes.data?.files || [];
        }

        // 1. Try to find "Text PDF" (preferred)
        let pdfFile = files.find(
            (f) => f.format === 'Text PDF' && f.source === 'original'
        );

        // 2. Fallback to any file with "PDF" in format
        if (!pdfFile) {
            pdfFile = files.find((f) => f.format === 'PDF');
        }

        // 3. Fallback to any file ending in .pdf
        if (!pdfFile) {
            pdfFile = files.find((f) => f.name && f.name.toLowerCase().endsWith('.pdf'));
        }

        if (pdfFile) {
            const url = `${ARCHIVE_DOWNLOAD_URL}/${identifier}/${encodeURIComponent(pdfFile.name)}`;
            console.log(`[Archive] Resolved PDF: ${url}`);
            return url;
        }

        console.warn(`[Archive] No PDF found for item: ${identifier}. Available formats: ${[...new Set(files.map(f => f.format))].join(', ')}`);
        return null;
    } catch (err) {
        console.error(`[Archive] Error fetching PDF URL for ${identifier}:`, err.message);
        return null;
    }
}

/**
 * Get a single book by its Archive.org identifier
 */
async function getBookByIdentifier(identifier) {
    const books = await getAllBooks();
    return books.find((b) => b.id === identifier) || null;
}

/**
 * Search books by query (filters on title and author)
 */
async function searchBooks(query) {
    const books = await getAllBooks();
    const q = query.toLowerCase();
    return books.filter(
        (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q)
    );
}

/**
 * Clear the cache (useful for forcing a refresh)
 */
function clearCache() {
    booksCache = null;
    booksCacheTime = 0;
}

module.exports = {
    getAllBooks,
    getBookByIdentifier,
    getPdfUrl,
    searchBooks,
    clearCache,
    parseTitle,
};

