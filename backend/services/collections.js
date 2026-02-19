const COLLECTION_RULES = {
    '19th': {
        label: 'XIXe Siecle',
        keywords: [
            'xixe',
            '19e',
            '1800',
            'realisme',
            'naturalisme',
            'victorien',
            'victorian',
        ],
        authors: [
            'balzac',
            'zola',
            'flaubert',
            'hugo',
            'dickens',
            'dumas',
            'stendhal',
            'maupassant',
        ],
    },
    romanticism: {
        label: 'Romantisme',
        keywords: [
            'romantisme',
            'romantic',
            'romantique',
            'emotion',
            'passion',
            'lyrique',
        ],
        authors: [
            'lamartine',
            'musset',
            'chateaubriand',
            'goethe',
            'byron',
        ],
    },
    'dark-academia': {
        label: 'Savoir & Mystere',
        keywords: [
            'academia',
            'ecole',
            'universite',
            'college',
            'philosophie',
            'mystere',
            'secret',
            'knowledge',
        ],
        authors: [
            'dostoevsky',
            'eco',
            'conan doyle',
        ],
    },
    gothic: {
        label: 'Horreur Gothique',
        keywords: [
            'gothique',
            'gothic',
            'horreur',
            'horror',
            'fantome',
            'vampire',
            'noir',
            'macabre',
        ],
        authors: [
            'poe',
            'shelley',
            'stoker',
            'lovecraft',
            'le fanu',
            'hoffmann',
        ],
    },
};

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function matchesCollection(book, collectionId) {
    const rule = COLLECTION_RULES[collectionId];
    if (!rule) return true;

    const haystack = normalize(
        [book.title, book.author, book.rawTitle, book.description, book.category, book.language].join(' ')
    );

    const keywordMatch = rule.keywords.some((kw) => haystack.includes(normalize(kw)));
    const authorMatch = rule.authors.some((name) => haystack.includes(normalize(name)));

    return keywordMatch || authorMatch;
}

function filterBooksByCollection(books, collectionId) {
    if (!collectionId || !COLLECTION_RULES[collectionId]) return books;
    return books.filter((book) => matchesCollection(book, collectionId));
}

module.exports = {
    COLLECTION_RULES,
    filterBooksByCollection,
};
