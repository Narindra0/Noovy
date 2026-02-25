const axios = require('axios');

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORKS_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

const cache = new Map();
const inflight = new Map();

const FRESH_TTL = 24 * 60 * 60 * 1000; // 24h
const STALE_TTL = 7 * 24 * 60 * 60 * 1000; // 7d

const GOOGLE_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
let googleDisabledUntil = 0;
let lastGoogle429LogAt = 0;

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
    return q
        .replace(/Chrisitie/gi, 'Christie')
        .replace(/Agathe/gi, 'Agatha')
        .replace(/sur tables/gi, 'sur table')
        .replace(/[^\w\sàâäéèêëïîôöùûüç]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchOpenLibrary(book) {
    let q = book.q || `${book.title || ''} ${book.author || ''}`.trim();
    q = normalizeQuery(q);
    if (!q) return null;

    const res = await axios.get(SEARCH_URL, {
        params: {
            q,
            limit: 5,
            fields: 'key,first_publish_year,cover_i,cover_edition_key,number_of_pages_median,language',
        },
        timeout: 10000,
    });

    const docs = res.data?.docs || [];
    if (!docs.length) return null;

    const bestDoc = docs.find((d) => d.cover_i || d.cover_edition_key) || docs[0];

    let description = null;
    if (bestDoc.key) {
        try {
            const workRes = await axios.get(`${WORKS_URL}${bestDoc.key}.json`, { timeout: 5000 });
            const raw = workRes.data?.description;
            if (typeof raw === 'string') description = raw;
            if (raw && typeof raw === 'object' && raw.value) description = raw.value;
        } catch {
            // non-critical
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
    if (Date.now() < googleDisabledUntil) {
        return null;
    }

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

    const bestItem = items.find((item) => item.volumeInfo?.imageLinks) || items[0];
    const info = bestItem.volumeInfo || {};
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

function needsGoogleFallback(meta) {
    if (!meta) return true;
    return !(meta.cover_url && meta.description);
}

function handleProviderError(providerName, bookTitle, error) {
    const status = error.response ? error.response.status : 'Unknown';

    if (providerName === 'googlebooks' && status === 429) {
        googleDisabledUntil = Date.now() + GOOGLE_COOLDOWN_MS;
        if (Date.now() - lastGoogle429LogAt > 60 * 1000) {
            lastGoogle429LogAt = Date.now();
            console.error(`[Metadata] Google Books rate-limited (429). Disabled for ${Math.round(GOOGLE_COOLDOWN_MS / 60000)} min.`);
        }
        return;
    }

    console.error(`[Metadata] Error from ${providerName} for ${bookTitle}: ${status} - ${error.message}`);
}

function isAuthorBio(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const bioMarkers = [
        'is an author', 'was an author', 'born in', 'published his first',
        'lives in', 'studied at', 'won the', 'best known for',
        'prolific writer', 'mystery writer', 'famous for', 'ecrivain',
        'romanciere', 'nee en', 'a ecrit', 'paru en',
    ];
    const markersFound = bioMarkers.filter((m) => lower.includes(m)).length;
    return markersFound >= 2;
}

function mergeMetadata(base, extra) {
    if (!extra) return base;

    let description = base.description;
    if (extra.description && !isAuthorBio(extra.description)) {
        description = extra.description;
    } else if (!description && extra.description) {
        description = extra.description;
    }

    return {
        cover_url: extra.cover_url || base.cover_url || null,
        year: extra.year || base.year || null,
        pages: extra.pages || base.pages || null,
        description,
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

    try {
        let openData = await fetchOpenLibrary(book);
        if (!openData && book.title) {
            openData = await fetchOpenLibrary({ title: book.title, q: book.title });
        }
        if (openData) {
            merged = mergeMetadata(merged, openData);
            successfulSource = successfulSource || 'openlibrary';
        }
    } catch (e) {
        handleProviderError('openlibrary', book.title, e);
    }

    if (needsGoogleFallback(merged)) {
        try {
            let googleData = await fetchGoogleBooks(book);
            if (!googleData && book.title) {
                googleData = await fetchGoogleBooks({ title: book.title, q: book.title });
            }
            if (googleData) {
                merged = mergeMetadata(merged, googleData);
                successfulSource = successfulSource || 'googlebooks';
            }
        } catch (e) {
            handleProviderError('googlebooks', book.title, e);
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

    const inflightKey = `meta:${cacheKey}`;
    if (inflight.has(inflightKey)) {
        const resolved = await inflight.get(inflightKey);
        return {
            ...book,
            ...resolved.data,
            metadata_source: resolved.source,
            metadata_cached: false,
            metadata_stale: false,
        };
    }

    try {
        const promise = resolveMetadata(book);
        inflight.set(inflightKey, promise);
        const resolved = await promise;
        setCache(cacheKey, resolved.data, resolved.source);

        return {
            ...book,
            ...resolved.data,
            metadata_source: resolved.source,
            metadata_cached: false,
            metadata_stale: false,
        };
    } catch {
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
    } finally {
        inflight.delete(inflightKey);
    }
}

async function enrichBooks(books, concurrency = 3) {
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
    inflight.clear();
}

module.exports = {
    enrichBook,
    enrichBooks,
    clearCache,
};
