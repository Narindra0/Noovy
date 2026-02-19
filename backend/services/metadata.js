const axios = require('axios');

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORKS_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

const cache = new Map();
const FRESH_TTL = 24 * 60 * 60 * 1000; // 24h
const STALE_TTL = 7 * 24 * 60 * 60 * 1000; // 7d

function getCacheKey(book) {
    return `${book.author || ''}|${book.title || ''}`.toLowerCase().trim();
}

function getDefaultMetadata(book) {
    return {
        cover_url: book.cover_url || null,
        year: book.year || null,
        pages: book.pages || null,
        description: book.description || null,
        rating: book.rating || null,
        ratingsCount: book.ratingsCount || null,
        publisher: book.publisher || null,
        category: book.category || null,
        language: book.language || null,
        source: 'default',
    };
}

function getCached(cacheKey, allowStale = false) {
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    const age = Date.now() - entry.timestamp;
    if (age <= FRESH_TTL) return entry;
    if (allowStale && age <= STALE_TTL) return entry;
    return null;
}

function setCache(cacheKey, data, source) {
    cache.set(cacheKey, {
        data,
        source,
        timestamp: Date.now(),
    });
}

function safeYear(dateLike) {
    if (!dateLike) return null;
    const match = String(dateLike).match(/\d{4}/);
    return match ? match[0] : null;
}

async function fetchOpenLibrary(book) {
    const res = await axios.get(SEARCH_URL, {
        params: {
            title: book.title,
            author: book.author,
            limit: 1,
            fields: 'key,first_publish_year,cover_i,number_of_pages_median,language',
        },
        timeout: 3500,
    });

    const docs = res.data?.docs || [];
    if (!docs.length) return null;

    const first = docs[0];
    let description = null;
    if (first.key) {
        try {
            const workRes = await axios.get(`${WORKS_URL}${first.key}.json`, { timeout: 3000 });
            const raw = workRes.data?.description;
            if (typeof raw === 'string') description = raw;
            if (raw && typeof raw === 'object' && raw.value) description = raw.value;
        } catch (e) {
            // Non-critical.
        }
    }

    return {
        cover_url: first.cover_i ? `https://covers.openlibrary.org/b/id/${first.cover_i}-L.jpg` : null,
        year: first.first_publish_year || null,
        pages: first.number_of_pages_median || null,
        description,
        language: Array.isArray(first.language) ? first.language[0] : first.language || null,
        source: 'openlibrary',
    };
}

async function fetchGoogleBooks(book) {
    const q = `${book.title || ''} ${book.author || ''}`.trim();
    if (!q) return null;

    const params = {
        q,
        maxResults: 1,
        orderBy: 'relevance',
    };
    if (process.env.GOOGLE_BOOKS_API_KEY) {
        params.key = process.env.GOOGLE_BOOKS_API_KEY;
    }

    const res = await axios.get(GOOGLE_BOOKS_URL, { params, timeout: 3500 });
    const item = res.data?.items?.[0];
    if (!item || !item.volumeInfo) return null;

    const info = item.volumeInfo;
    const imageLinks = info.imageLinks || {};
    const cover =
        imageLinks.extraLarge ||
        imageLinks.large ||
        imageLinks.medium ||
        imageLinks.thumbnail ||
        null;

    return {
        cover_url: cover ? cover.replace('http:', 'https:') : null,
        description: info.description || null,
        pages: info.pageCount || null,
        year: safeYear(info.publishedDate),
        category: Array.isArray(info.categories) ? info.categories[0] : null,
        language: info.language || null,
        publisher: info.publisher || null,
        rating: info.averageRating || null,
        ratingsCount: info.ratingsCount || null,
        source: 'googlebooks',
    };
}

function mergeMetadata(base, extra) {
    if (!extra) return base;
    return {
        cover_url: extra.cover_url || base.cover_url || null,
        year: extra.year || base.year || null,
        pages: extra.pages || base.pages || null,
        description: extra.description || base.description || null,
        rating: extra.rating || base.rating || null,
        ratingsCount: extra.ratingsCount || base.ratingsCount || null,
        publisher: extra.publisher || base.publisher || null,
        category: extra.category || base.category || null,
        language: extra.language || base.language || null,
        source: extra.source || base.source,
    };
}

async function resolveMetadata(book) {
    const base = getDefaultMetadata(book);
    let merged = base;
    let successfulSource = null;

    const providers = [
        ['openlibrary', fetchOpenLibrary],
        ['googlebooks', fetchGoogleBooks],
    ];

    for (const [name, provider] of providers) {
        try {
            const data = await provider(book);
            if (data) {
                merged = mergeMetadata(merged, data);
                successfulSource = successfulSource || name;
            }
        } catch (e) {
            // Try next provider.
        }
    }

    return {
        data: merged,
        source: successfulSource || 'default',
    };
}

async function enrichBook(book, options = {}) {
    const { allowStale = true } = options;
    const cacheKey = getCacheKey(book);
    const cached = getCached(cacheKey, allowStale);

    if (cached) {
        return {
            ...book,
            ...cached.data,
            metadata_source: cached.source,
            metadata_cached: true,
            metadata_stale: Date.now() - cached.timestamp > FRESH_TTL,
        };
    }

    try {
        const resolved = await resolveMetadata(book);
        setCache(cacheKey, resolved.data, resolved.source);

        return {
            ...book,
            ...resolved.data,
            metadata_source: resolved.source,
            metadata_cached: false,
            metadata_stale: false,
        };
    } catch (err) {
        const stale = getCached(cacheKey, true);
        if (stale) {
            return {
                ...book,
                ...stale.data,
                metadata_source: stale.source,
                metadata_cached: true,
                metadata_stale: true,
            };
        }

        return {
            ...book,
            ...getDefaultMetadata(book),
            metadata_source: 'default',
            metadata_cached: false,
            metadata_stale: false,
        };
    }
}

async function enrichBooks(books, concurrency = 6) {
    const results = [];
    for (let i = 0; i < books.length; i += concurrency) {
        const batch = books.slice(i, i + concurrency);
        const enrichedBatch = await Promise.all(batch.map((book) => enrichBook(book)));
        results.push(...enrichedBatch);
    }
    return results;
}

function clearCache() {
    cache.clear();
}

module.exports = {
    enrichBook,
    enrichBooks,
    clearCache,
};
