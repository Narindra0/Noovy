const pool = require('./config/db');

async function checkDatabase() {
    try {
        console.log('🔍 Checking books table structure...');
        const tableInfo = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'books'
        `);
        console.log('Columns found:', tableInfo.rows.map(r => r.column_name).join(', '));

        console.log('\n🔍 Testing "featured" query...');
        const featuredRes = await pool.query('SELECT count(*) FROM books WHERE featured = true');
        console.log('Featured books count:', featuredRes.rows[0].count);

        console.log('\n🔍 Testing "recent" query...');
        const recentRes = await pool.query('SELECT title, created_at FROM books ORDER BY created_at DESC LIMIT 5');
        console.log('Recent books:', recentRes.rows.map(r => `${r.title} (${r.created_at})`));

        process.exit(0);
    } catch (err) {
        console.error('❌ Database check failed:', err.message);
        process.exit(1);
    }
}

checkDatabase();
