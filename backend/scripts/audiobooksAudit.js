#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAllBooks } = require('../services/backblaze');

const LIBRIVOX_API_URL = 'https://librivox.org/api/feed/audiobooks';
const CONCURRENCY = Number.parseInt(process.env.AUDIOBOOK_AUDIT_CONCURRENCY || '6', 10);
const MAX_BOOKS = Number.parseInt(process.env.AUDIOBOOK_AUDIT_MAX_BOOKS || '0', 10);

process.stdout.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
});
process.stderr.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
});

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function similarityRatio(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.92;

    const setA = new Set(a.split(' '));
    const setB = new Set(b.split(' '));
    let common = 0;
    for (const token of setA) {
        if (setB.has(token)) common += 1;
    }
    return common / Math.max(setA.size, setB.size, 1);
}

function extractLibriVoxAuthorNames(book) {
    if (!Array.isArray(book.authors)) return [];
    return book.authors
        .map((a) => `${a.first_name || ''} ${a.last_name || ''}`.trim())
        .filter(Boolean);
}

function isLikelyMatch(localBook, lvBook) {
    const localTitle = normalizeText(localBook.title);
    const candidateTitle = normalizeText(lvBook.title);
    const titleScore = similarityRatio(localTitle, candidateTitle);

    const localAuthor = normalizeText(localBook.author);
    const candidateAuthors = extractLibriVoxAuthorNames(lvBook).map(normalizeText);
    const authorHit = candidateAuthors.some((name) => similarityRatio(localAuthor, name) >= 0.65);

    return titleScore >= 0.72 && (authorHit || !localAuthor);
}

async function queryLibriVox(title) {
    const raw = String(title || '').trim();
    const normalized = normalizeText(raw);
    const words = normalized.split(' ').filter(Boolean);
    const firstSignificant = words.find((w) => w.length >= 3) || words[0] || '';
    const firstTwo = words.slice(0, 2).join(' ');
    const searchTerms = [normalized, firstTwo, firstSignificant].filter(Boolean);
    const deduped = [...new Set(searchTerms)];

    for (const term of deduped) {
        const url = `${LIBRIVOX_API_URL}/title/${encodeURIComponent(`^${term}`)}`;
        const response = await axios.get(url, {
            params: {
                format: 'json',
                limit: 25,
                offset: 0,
                extended: 1,
            },
            timeout: 15000,
            validateStatus: (status) => status >= 200 && status < 500,
        });

        if (response.status === 404) {
            continue;
        }
        if (Array.isArray(response.data?.books) && response.data.books.length > 0) {
            return response.data.books;
        }
    }
    return [];
}

async function checkBookAudiobook(book) {
    try {
        const searchResults = await queryLibriVox(book.title);
        const matches = searchResults.filter((candidate) => isLikelyMatch(book, candidate));
        return {
            ...book,
            hasAudioBook: matches.length > 0,
            matches: matches.map((m) => ({
                id: m.id,
                title: m.title,
                url: m.url_librivox || m.url_zip_file || null,
                durationSeconds: m.totaltimesecs || null,
                authors: extractLibriVoxAuthorNames(m),
            })),
            error: null,
        };
    } catch (err) {
        return {
            ...book,
            hasAudioBook: false,
            matches: [],
            error: err.message,
        };
    }
}

async function processInBatches(items, worker, batchSize) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(worker));
        results.push(...batchResults);
        console.log(`[audit] Progression: ${results.length}/${items.length}`);
    }
    return results;
}

function ensureReportDir() {
    const reportDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }
    return reportDir;
}

function buildIntegrationPlan(summary) {
    return [
        '1. Ajouter un champ optionnel `audiobook` dans le modèle de livre (id LibriVox, url, durée, narrateurs).',
        '2. Exécuter ce script en tâche planifiée pour enrichir la base et éviter les appels LibriVox au runtime.',
        '3. Exposer `hasAudioBook` et les métadonnées audio dans `/api/books` et `/api/books/:id`.',
        '4. Côté app mobile, afficher un badge "Livre audio disponible" sur les cartes et la page détail.',
        '5. Ajouter une analytics simple: taux de conversion lecture texte vers écoute audio.',
        `6. Lot prioritaire: traiter d’abord les ${Math.min(summary.withAudiobook, 50)} premiers livres trouvés avec audio.`,
    ];
}

async function main() {
    const startedAt = new Date();
    console.log('[audit] Récupération des livres depuis le stockage...');
    const books = await getAllBooks();
    const booksToCheck = MAX_BOOKS > 0 ? books.slice(0, MAX_BOOKS) : books;
    console.log(`[audit] ${books.length} livres trouvés (${booksToCheck.length} à analyser).`);

    const checkedBooks = await processInBatches(
        booksToCheck.map((b) => ({ id: b.id, title: b.title, author: b.author, key: b.key })),
        checkBookAudiobook,
        Math.max(1, CONCURRENCY)
    );

    const withAudiobook = checkedBooks.filter((b) => b.hasAudioBook).length;
    const failedChecks = checkedBooks.filter((b) => b.error).length;
    const withoutAudiobook = checkedBooks.length - withAudiobook;

    const summary = {
        generatedAt: new Date().toISOString(),
        durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        totalBooks: checkedBooks.length,
        withAudiobook,
        withoutAudiobook,
        failedChecks,
        coveragePercent: checkedBooks.length ? Number(((withAudiobook / checkedBooks.length) * 100).toFixed(2)) : 0,
    };

    const report = {
        summary,
        booksWithAudiobook: checkedBooks
            .filter((b) => b.hasAudioBook)
            .map((b) => ({
                id: b.id,
                title: b.title,
                author: b.author,
                matches: b.matches,
            })),
        booksWithoutAudiobook: checkedBooks
            .filter((b) => !b.hasAudioBook && !b.error)
            .map((b) => ({
                id: b.id,
                title: b.title,
                author: b.author,
            })),
        errors: checkedBooks
            .filter((b) => b.error)
            .map((b) => ({ id: b.id, title: b.title, author: b.author, error: b.error })),
        integrationPlan: buildIntegrationPlan(summary),
    };

    const reportDir = ensureReportDir();
    const fileStamp = summary.generatedAt.replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `audiobook-audit-${fileStamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n[audit] Résumé');
    console.log(`- Total livres: ${summary.totalBooks}`);
    console.log(`- Livres avec audio: ${summary.withAudiobook}`);
    console.log(`- Livres sans audio: ${summary.withoutAudiobook}`);
    console.log(`- Couverture: ${summary.coveragePercent}%`);
    console.log(`- Vérifications en erreur: ${summary.failedChecks}`);
    console.log(`- Rapport: ${reportPath}`);
    console.log('\n[audit] Plan proposé:');
    report.integrationPlan.forEach((step) => console.log(step));
}

main().catch((err) => {
    console.error('[audit] Erreur fatale:', err.message);
    process.exit(1);
});
