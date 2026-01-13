// Test script to verify the /matrix endpoint returns correct data
const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/objectives/matrix?clientCode=4300009622&years=2025',
    method: 'GET',
    headers: {
        'Authorization': 'Bearer test' // Will be rejected but we can see the structure
    }
};

console.log('Testing /matrix endpoint for PUA (4300009622)...\n');

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Summary received:');
            console.log(JSON.stringify(json.summary, null, 2));
            
            if (json.summary) {
                console.log('\n=== VERIFICATION ===');
                console.log(`isNewClient: ${json.summary.isNewClient}`);
                console.log(`current.productCount: ${json.summary.current?.productCount}`);
                console.log(`previous.productCount: ${json.summary.previous?.productCount}`);
                console.log(`growth.productCount: ${json.summary.growth?.productCount}`);
            }
        } catch (e) {
            console.log('Response:', data.substring(0, 500));
        }
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.end();
