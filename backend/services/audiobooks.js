const axios = require('axios');
const catalog = require('../data/audiobooksCatalog.json');

const LIBRIVOX_API_URL = 'https://librivox.org/api/feed/audiobooks/';
const metadataCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function findCatalogEntry(book) {
    const exact = catalog.find((entry) => entry.bookId === book.id || entry.bookId === book.legacyId);
    if (exact) return exact;

    const title = normalizeText(book.title);
    const author = normalizeText(book.author);
    return catalog.find(
        (entry) =>
            normalizeText(entry.title) === title &&
            normalizeText(entry.author) === author
    ) || null;
}

async function fetchLibrivoxMetadata(librivoxId) {
    const cached = metadataCache.get(librivoxId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }

    const response = await axios.get(LIBRIVOX_API_URL, {
        params: {
            id: librivoxId,
            format: 'json',
            extended: 1,
        },
        timeout: 15000,
    });

    const book = response.data?.books?.[0] || null;
    metadataCache.set(librivoxId, {
        timestamp: Date.now(),
        data: book,
    });
    return book;
}

function encodeUrl(url) {
    return Buffer.from(url, 'utf8').toString('base64url');
}

function decodeUrl(encoded) {
    return Buffer.from(encoded, 'base64url').toString('utf8');
}

function isAllowedSource(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        return /(^|\.)librivox\.org$/i.test(parsed.hostname) || /(^|\.)archive\.org$/i.test(parsed.hostname);
    } catch {
        return false;
    }
}

function getBaseUrl(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = forwardedProto ? String(forwardedProto).split(',')[0] : req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function mapChapter(section, index, baseUrl) {
    const sourceUrl = section.listen_url;
    return {
        id: section.id || `${index}`,
        index,
        title: section.title || `Chapitre ${index + 1}`,
        duration: section.playtime || null,
        stream_url: `${baseUrl}/api/books/audio/stream?u=${encodeUrl(sourceUrl)}`,
        source_url: sourceUrl,
    };
}

async function getAudioForBook(book, req) {
    const entry = findCatalogEntry(book);
    if (!entry) {
        return { hasAudio: false, audiobook: null };
    }

    const lvBook = await fetchLibrivoxMetadata(entry.librivoxId);
    if (!lvBook) {
        return { hasAudio: false, audiobook: null };
    }

    const baseUrl = getBaseUrl(req);
    const sections = Array.isArray(lvBook.sections) ? lvBook.sections : [];

    return {
        hasAudio: sections.length > 0,
        audiobook: {
            librivoxId: lvBook.id,
            title: lvBook.title || entry.title,
            author: Array.isArray(lvBook.authors) && lvBook.authors[0]
                ? `${lvBook.authors[0].first_name || ''} ${lvBook.authors[0].last_name || ''}`.trim()
                : entry.author,
            totalSeconds: lvBook.totaltimesecs || null,
            librivoxUrl: lvBook.url_librivox || null,
            rssUrl: lvBook.url_rss || null,
            chapters: sections
                .filter((s) => Boolean(s.listen_url))
                .map((section, index) => mapChapter(section, index, baseUrl)),
        },
    };
}

async function proxyAudioStream(req, res) {
    const encoded = String(req.query.u || '');
    if (!encoded) {
        return res.status(400).json({ error: 'Missing stream source' });
    }

    const sourceUrl = decodeUrl(encoded);
    if (!isAllowedSource(sourceUrl)) {
        return res.status(400).json({ error: 'Invalid stream source host' });
    }

    const headers = {};
    if (req.headers.range) {
        headers.Range = req.headers.range;
    }

    const upstream = await axios.get(sourceUrl, {
        responseType: 'stream',
        headers,
        timeout: 25000,
        validateStatus: (status) => status >= 200 && status < 500,
    });

    if (upstream.status >= 400) {
        return res.status(upstream.status).json({ error: 'Upstream audio unavailable' });
    }

    const passHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
        'etag',
        'last-modified',
    ];

    passHeaders.forEach((name) => {
        const value = upstream.headers[name];
        if (value) res.setHeader(name, value);
    });

    res.status(upstream.status);
    upstream.data.pipe(res);
}

module.exports = {
    getAudioForBook,
    proxyAudioStream,
};
