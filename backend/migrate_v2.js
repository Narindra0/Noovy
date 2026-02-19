const pool = require('./config/db');

async function migrate() {
    try {
        console.log('🚀 Starting migration v2...');

        // Add featured column if it doesn't exist
        await pool.query(`
            ALTER TABLE books 
            ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE
        `);
        console.log('✅ Column "featured" added/checked');

        // Add created_at column if it doesn't exist
        await pool.query(`
            ALTER TABLE books 
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);
        console.log('✅ Column "created_at" added/checked');

        console.log('🎉 Migration successful!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
