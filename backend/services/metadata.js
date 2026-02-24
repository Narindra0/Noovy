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

function normalizeQuery(q) {
    if (!q) return '';
    return q.replace(/Chrisitie/gi, 'Christie')
        .replace(/Agathe/gi, 'Agatha')
        .replace(/sur tables/gi, 'sur table')
        .replace(/[^\w\sàâäéèêëïîôöùûüç]/gi, ' ') // Remove special chars but keep French accents
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchOpenLibrary(book) {
    let q = book.q || `${book.title || ''} ${book.author || ''}`.trim();
    q = normalizeQuery(q);
    if (!q) return null;

    const res = await axios.get(SEARCH_URL, {
        params: {
            q: q,
            limit: 5,
            fields: 'key,first_publish_year,cover_i,cover_edition_key,number_of_pages_median,language',
        },
        timeout: 10000,
    });

    const docs = res.data?.docs || [];
    if (!docs.length) return null;

    // Look for the first result that has a cover
    let bestDoc = docs.find(d => d.cover_i || d.cover_edition_key) || docs[0];

    let description = null;
    if (bestDoc.key) {
        try {
            const workRes = await axios.get(`${WORKS_URL}${bestDoc.key}.json`, { timeout: 5000 });
            const raw = workRes.data?.description;
            if (typeof raw === 'string') description = raw;
            if (raw && typeof raw === 'object' && raw.value) description = raw.value;
        } catch (e) {
            // Non-critical.
        }
    }

    let coverUrl = null;
    if (bestDoc.cover_i) {
        coverUrl = `https://covers.openlibrary.org/b/id/${bestDoc.cover_i}-L.jpg`;
    } else if (bestDoc.cover_edition_key) {
        coverUrl = `https://covers.openlibrary.org/b/olid/${bestDoc.cover_edition_key}-L.jpg`;
    }

    return {
        cover_url: coverUrl,
        year: bestDoc.first_publish_year || null,
        pages: bestDoc.number_of_pages_median || null,
        description,
        language: Array.isArray(bestDoc.language) ? bestDoc.language[0] : bestDoc.language || null,
        source: 'openlibrary',
    };
}

async function fetchGoogleBooks(book) {
    let q = book.q || `${book.title || ''} ${book.author || ''}`.trim();
    q = normalizeQuery(q);
    if (!q) return null;

    const params = {
        q,
        maxResults: 5,
        orderBy: 'relevance',
    };
    if (process.env.GOOGLE_BOOKS_API_KEY) {
        params.key = process.env.GOOGLE_BOOKS_API_KEY;
    }

    const res = await axios.get(GOOGLE_BOOKS_URL, { params, timeout: 7000 });
    const items = res.data?.items || [];
    if (!items.length) return null;

    // Find first item with imageLinks
    const bestItem = items.find(item => item.volumeInfo?.imageLinks) || items[0];
    const info = bestItem.volumeInfo;
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



function isAuthorBio(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const bioMarkers = [
        'is an author', 'was an author', 'born in', 'published his first',
        'lives in', 'studied at', 'won the', 'best known for',
        'prolific writer', 'mystery writer', 'famous for', 'écrivain',
        'romancière', 'née en', 'a écrit', 'paru en'
    ];
    // If it starts with the author's name or is very long and full of bio markers
    const markersFound = bioMarkers.filter(m => lower.includes(m)).length;
    return markersFound >= 2;
}

function mergeMetadata(base, extra) {
    if (!extra) return base;

    // Synopsis guard: don't overwrite a good description with an author bio
    let description = base.description;
    if (extra.description && !isAuthorBio(extra.description)) {
        description = extra.description;
    } else if (!description && extra.description) {
        description = extra.description; // Take it if we have nothing else
    }

    return {
        cover_url: extra.cover_url || base.cover_url || null,
        year: extra.year || base.year || null,
        pages: extra.pages || base.pages || null,
        description: description,
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
        { name: 'openlibrary', fn: fetchOpenLibrary },
        { name: 'googlebooks', fn: fetchGoogleBooks },
    ];

    // Try all providers in parallel for initial search
    const results = await Promise.all(
        providers.map(async (p) => {
            try {
                let data = await p.fn(book);

                // Fallback: If no data found, try searching with only title
                if (!data && book.title) {
                    data = await p.fn({ title: book.title, q: book.title });
                }

                return { name: p.name, data };
            } catch (e) {
                // Keep error logs as requested
                const status = e.response ? e.response.status : 'Unknown';
                console.error(`[Metadata] ⚠️ Error from ${p.name} for ${book.title}: ${status} - ${e.message}`);
                return { name: p.name, data: null };
            }
        })
    );

    // Prioritize results with covers
    const successfulResults = results.filter(r => r.data).sort((a, b) => {
        if (a.data.cover_url && !b.data.cover_url) return -1;
        if (!a.data.cover_url && b.data.cover_url) return 1;
        return 0;
    });

    if (successfulResults.length > 0) {
        // Merge all successful results, prioritizing the one with a cover
        successfulResults.forEach(r => {
            merged = mergeMetadata(merged, r.data);
            successfulSource = successfulSource || r.name;
        });
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
