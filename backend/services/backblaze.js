const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Backblaze B2 S3-compatible configuration
const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT || 'https://s3.eu-central-003.backblazeb2.com',
    region: process.env.B2_REGION || 'eu-central-003',
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY,
    },
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME;

// Cache configuration
let booksCache = null;
let booksCacheTime = 0;
let inflightFetch = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Parse filename format: "[Author] - [Title] --- (signature).pdf"
 * Example: "A.J.Cronin - Le jardinier espagnol --- (Ny Aiko Boky).pdf"
 * The signature part "--- (xxx)" is ignored
 */
function parseFilename(filename) {
    // Remove .pdf extension
    const nameWithoutExt = filename.replace(/\.pdf$/i, '');

    // Try to match "Author - Title --- signature" format
    // Capture author (before " - ") and title (between " - " and " --- ")
    const match = nameWithoutExt.match(/^(.+?)\s+-\s+(.+?)\s+---\s*\(.+\)$/);
    if (match) {
        return {
            author: match[1].trim(),
            title: match[2].trim(),
        };
    }

    // Fallback: Try simple "Author - Title" format (without signature)
    const simpleMatch = nameWithoutExt.match(/^(.+?)\s+-\s+(.+)$/);
    if (simpleMatch) {
        return {
            author: simpleMatch[1].trim(),
            title: simpleMatch[2].trim(),
        };
    }

    return { author: 'Inconnu', title: nameWithoutExt.trim() };
}

function createBookIdFromKey(key) {
    const nameWithoutExt = key.replace(/\.pdf$/i, '');
    return Buffer.from(nameWithoutExt, 'utf8').toString('base64url');
}

function createLegacyIdFromKey(key) {
    return key.replace(/\.pdf$/i, '').replace(/\s+/g, '_');
}

/**
 * Generate a cover URL (placeholder or from metadata)
 * For now, returns a placeholder based on book info
 */
function generateCoverUrl(filename, bookId) {
    // Keep null so clients can use a local placeholder instead of a misleading fake cover.
    return null;
}

/**
 * Fetch all books from Backblaze B2 bucket
 */
async function fetchFromBackblaze() {
    let continuationToken = undefined;
    const objects = [];

    do {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
        });

        const response = await s3Client.send(command);
        if (Array.isArray(response.Contents) && response.Contents.length) {
            objects.push(...response.Contents);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    // Filter only PDF files
    const pdfFiles = objects.filter(obj =>
        obj.Key && obj.Key.toLowerCase().endsWith('.pdf')
    );

    return pdfFiles.map((obj) => {
        const parsed = parseFilename(obj.Key);
        const id = createBookIdFromKey(obj.Key);
        const legacyId = createLegacyIdFromKey(obj.Key);

        return {
            id: id,
            legacyId,
            title: parsed.title,
            author: parsed.author,
            rawTitle: obj.Key,
            cover_url: generateCoverUrl(obj.Key, id),
            language: 'Français',
            key: obj.Key, // Store the B2 key for later use
            lastModified: obj.LastModified,
            size: obj.Size,
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
        inflightFetch = fetchFromBackblaze();
        const books = await inflightFetch;
        booksCache = books;
        booksCacheTime = now;
        return books;
    } catch (err) {
        console.error('[Backblaze] Fetch error:', err.message);
        // Return cached data if available, even if expired
        if (booksCache) return booksCache;
        throw err;
    } finally {
        inflightFetch = null;
    }
}

/**
 * Get signed URL for downloading a PDF
 * Valid for 1 hour by default
 */
async function getPdfUrl(identifier) {
    try {
        const books = await getAllBooks();
        const book = books.find(b => b.id === identifier || b.legacyId === identifier);

        if (!book) {
            console.warn(`[Backblaze] Book not found: ${identifier}`);
            return null;
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: book.key,
        });

        // Generate signed URL valid for 1 hour
        const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600
        });

        return signedUrl;
    } catch (err) {
        console.error(`[Backblaze] Error generating signed URL for ${identifier}:`, err.message);
        return null;
    }
}

/**
 * Get a direct (unsigned) URL for public files
 * Only works if the bucket/file is public
 */
async function getDirectPdfUrl(identifier) {
    try {
        const books = await getAllBooks();
        const book = books.find(b => b.id === identifier || b.legacyId === identifier);

        if (!book) {
            console.warn(`[Backblaze] Book not found: ${identifier}`);
            return null;
        }

        // Construct direct URL (bucket must be public)
        const endpoint = process.env.B2_ENDPOINT || 'https://s3.eu-central-003.backblazeb2.com';
        const url = `${endpoint}/${BUCKET_NAME}/${encodeURIComponent(book.key)}`;

        return url;
    } catch (err) {
        console.error(`[Backblaze] Error getting direct URL for ${identifier}:`, err.message);
        return null;
    }
}

/**
 * Get a single book by its identifier
 */
async function getBookByIdentifier(identifier) {
    const books = await getAllBooks();
    return books.find((b) => b.id === identifier || b.legacyId === identifier) || null;
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

/**
 * Test Backblaze connection
 */
async function testConnection() {
    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 1,
        });
        await s3Client.send(command);
        return true;
    } catch (err) {
        console.error('[Backblaze] Connection failed:', err.message);
        return false;
    }
}

module.exports = {
    getAllBooks,
    getBookByIdentifier,
    getPdfUrl,
    getDirectPdfUrl,
    searchBooks,
    clearCache,
    parseFilename,
    testConnection,
};
