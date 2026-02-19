const http = require('http');

const endpoints = [
    '/api/books',
    '/api/books/featured',
    '/api/books/recent',
    '/api/books/categories'
];

async function testEndpoint(path) {
    return new Promise((resolve) => {
        console.log(`Testing ${path}...`);
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`✅ ${path} success: Status ${res.statusCode}`);
                } else {
                    console.log(`❌ ${path} failed: Status ${res.statusCode}`);
                    console.log('Error data:', data);
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            console.log(`❌ ${path} error:`, err.message);
            resolve();
        });

        req.end();
    });
}

async function runTests() {
    for (const endpoint of endpoints) {
        await testEndpoint(endpoint);
    }
}

runTests();
