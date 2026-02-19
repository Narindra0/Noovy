const axios = require('axios');

// Cache: key = "author|title", value = { data, timestamp }
const metadataCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORKS_URL = 'https://openlibrary.org';

/**
 * Fetch metadata for a book from OpenLibrary
 * Returns: { cover_url, year, pages, description }
 */
async function getBookMetadata(author, title) {
    const cacheKey = `${author}|${title}`.toLowerCase();

    // Check cache
    const cached = metadataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        // Search by author + title
        const searchRes = await axios.get(SEARCH_URL, {
            params: {
                title: title,
                author: author,
                limit: 1,
                fields: 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject',
            },
            timeout: 8000,
        });

        const docs = searchRes.data.docs || [];
        if (docs.length === 0) {
            // No results — return defaults
            const defaults = { cover_url: null, year: null, pages: null, description: null };
            metadataCache.set(cacheKey, { data: defaults, timestamp: Date.now() });
            return defaults;
        }

        const book = docs[0];
        const coverId = book.cover_i;
        const coverUrl = coverId
            ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
            : null;

        // Fetch description from Works API
        let description = null;
        if (book.key) {
            try {
                const worksRes = await axios.get(`${WORKS_URL}${book.key}.json`, {
                    timeout: 5000,
                });
                const descData = worksRes.data.description;
                if (typeof descData === 'string') {
                    description = descData;
                } else if (descData && descData.value) {
                    description = descData.value;
                }
            } catch (e) {
                // Works API failure is non-critical
                console.log(`OpenLibrary Works API error for ${book.key}:`, e.message);
            }
        }

        const result = {
            cover_url: coverUrl,
            year: book.first_publish_year || null,
            pages: book.number_of_pages_median || null,
            description: description,
        };

        metadataCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {
        console.error('OpenLibrary search error:', err.message);
        return { cover_url: null, year: null, pages: null, description: null };
    }
}

/**
 * Enrich a book object with OpenLibrary metadata
 */
async function enrichBook(book) {
    const metadata = await getBookMetadata(book.author, book.title);
    return {
        ...book,
        cover_url: metadata.cover_url || book.cover_url || null,
        year: metadata.year || book.year || null,
        pages: metadata.pages || book.pages || null,
        description: metadata.description || book.description || null,
    };
}

/**
 * Enrich multiple books in parallel (with concurrency limit)
 */
async function enrichBooks(books, concurrency = 3) {
    const results = [];
    for (let i = 0; i < books.length; i += concurrency) {
        const batch = books.slice(i, i + concurrency);
        const enriched = await Promise.all(batch.map(enrichBook));
        results.push(...enriched);
    }
    return results;
}

/**
 * Clear the metadata cache
 */
function clearCache() {
    metadataCache.clear();
}

module.exports = {
    getBookMetadata,
    enrichBook,
    enrichBooks,
    clearCache,
};
