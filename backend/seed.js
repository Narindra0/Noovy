const pool = require('./config/db');

const books = [
    {
        "title": "Le Comte de Monte-Cristo",
        "author": "Alexandre Dumas",
        "year": 1844,
        "description": "L’histoire d’Edmond Dantès, injustement emprisonné, qui prépare une vengeance méthodique après s’être évadé et être devenu immensément riche. Un grand roman d’aventure sur la justice et la revanche.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070405374-L.jpg",
        "file_url": "https://www.gutenberg.org/files/1184/1184-0.txt",
        "category": "Roman",
        "pages": 1243,
        "language": "Français",
        "isbn": "9782070405374"
    },
    {
        "title": "Notre-Dame de Paris",
        "author": "Victor Hugo",
        "year": 1831,
        "description": "Roman historique se déroulant dans le Paris du XVe siècle, centré sur la figure tragique de Quasimodo et la belle Esmeralda.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070345830-L.jpg",
        "file_url": "https://www.gutenberg.org/files/2610/2610-0.txt",
        "category": "Roman",
        "pages": 940,
        "language": "Français",
        "isbn": "9782070345830"
    },
    {
        "title": "Germinal",
        "author": "Émile Zola",
        "year": 1885,
        "description": "Roman naturaliste décrivant la vie difficile des mineurs du nord de la France et la montée des luttes sociales au XIXe siècle.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070411429-L.jpg",
        "file_url": "https://www.gutenberg.org/files/5711/5711-0.txt",
        "category": "Roman",
        "pages": 592,
        "language": "Français",
        "isbn": "9782070411429"
    },
    {
        "title": "Le Rouge et le Noir",
        "author": "Stendhal",
        "year": 1830,
        "description": "L’ascension sociale et la chute tragique de Julien Sorel dans la France de la Restauration, entre ambition, amour et hypocrisie sociale.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782072861413-L.jpg",
        "file_url": "https://www.gutenberg.org/files/44747/44747-0.txt",
        "category": "Roman",
        "pages": 576,
        "language": "Français",
        "isbn": "9782072861413"
    },
    {
        "title": "La Chartreuse de Parme",
        "author": "Stendhal",
        "year": 1839,
        "description": "Roman d’apprentissage retraçant la vie de Fabrice del Dongo dans l’Italie napoléonienne, mêlant politique, amour et aventures.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070411382-L.jpg",
        "file_url": "https://www.gutenberg.org/files/1793/1793-0.txt",
        "category": "Roman",
        "pages": 544,
        "language": "Français",
        "isbn": "9782070411382"
    },
    {
        "title": "Les Trois Mousquetaires",
        "author": "Alexandre Dumas",
        "year": 1844,
        "description": "Les aventures de d’Artagnan et des mousquetaires Athos, Porthos et Aramis dans la France du XVIIe siècle.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070417681-L.jpg",
        "file_url": "https://www.gutenberg.org/files/1257/1257-0.txt",
        "category": "Roman",
        "pages": 768,
        "language": "Français",
        "isbn": "9782070417681"
    },
    {
        "title": "L’Étranger",
        "author": "Albert Camus",
        "year": 1942,
        "description": "Roman existentialiste racontant l’histoire de Meursault, un homme indifférent aux normes sociales, confronté à l’absurdité de l’existence.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070360024-L.jpg",
        "file_url": "https://www.gutenberg.org/files/59865/59865-0.txt",
        "category": "Roman",
        "pages": 184,
        "language": "Français",
        "isbn": "9782070360024"
    },
    {
        "title": "La Peste",
        "author": "Albert Camus",
        "year": 1947,
        "description": "Chronique d’une épidémie frappant la ville d’Oran, réflexion sur la solidarité, la résistance et la condition humaine.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070360420-L.jpg",
        "file_url": "https://www.gutenberg.org/files/59866/59866-0.txt",
        "category": "Roman",
        "pages": 320,
        "language": "Français",
        "isbn": "9782070360420"
    },
    {
        "title": "Bel-Ami",
        "author": "Guy de Maupassant",
        "year": 1885,
        "description": "Roman naturaliste suivant l’ascension sociale d’un jeune ambitieux dans le monde du journalisme parisien.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070409358-L.jpg",
        "file_url": "https://beq.ebooksgratuits.com/vents/Maupassant_Bel_Ami.pdf",
        "category": "Roman",
        "pages": 404,
        "language": "Français",
        "isbn": "9782070409358"
    },
    {
        "title": "Candide",
        "author": "Voltaire",
        "year": 1759,
        "description": "Conte philosophique satirique suivant Candide dans un voyage à travers le monde, critiquant l’optimisme et les injustices sociales.",
        "cover_url": "https://covers.openlibrary.org/b/isbn/9782070466634-L.jpg",
        "file_url": "https://www.gutenberg.org/files/19942/19942-0.txt",
        "category": "Roman",
        "pages": 160,
        "language": "Français",
        "isbn": "9782070466634"
    }
];

const seedDatabase = async () => {
    try {
        console.log('🌱 Clearing existing books and seeding...');
        await pool.query('TRUNCATE books CASCADE');

        for (let i = 0; i < books.length; i++) {
            const book = books[i];
            const isFeatured = i < 4; // First 4 books are featured
            await pool.query(
                `INSERT INTO books (title, author, year, description, cover_url, file_url, category, pages, language, isbn, featured)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [book.title, book.author, book.year, book.description, book.cover_url, book.file_url, book.category, book.pages, book.language, book.isbn, isFeatured]
            );
            console.log(`  📖 Added: ${book.title} — ${book.author}`);
        }

        console.log(`\n✅ Seeded ${books.length} books successfully!`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Seed error:', err.message);
        process.exit(1);
    }
};

seedDatabase();
