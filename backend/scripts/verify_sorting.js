const http = require('http');

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: '/api' + path,
            method: 'GET',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Failed to parse JSON'));
                    }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request Timeout'));
        });
        req.end();
    });
}

async function verifySort() {
    try {
        const vendor = '15';
        const day = 'lunes';

        console.log(`🔍 Verifying Sort for Vendor ${vendor} on ${day}...`);

        // 1. Get Custom Order (Default)
        console.log('--- Fetching Custom Order (Default) ---');
        try {
            const resCustom = await makeRequest(`/rutero/day/${day}?vendedorCodes=${vendor}&year=2025`);
            const clientsCustom = resCustom.clients.map(c => ({ code: c.code, order: c.order, sales: c.status.ytdSales }));
            console.log('Custom Top 5:', clientsCustom.slice(0, 5));
            console.log('Custom Count:', clientsCustom.length);

            // 2. Get Original Order (Ignore Overrides)
            console.log('\n--- Fetching Original Order (ignoreOverrides=true) ---');
            const resOriginal = await makeRequest(`/rutero/day/${day}?vendedorCodes=${vendor}&year=2025&ignoreOverrides=true`);
            const clientsOriginal = resOriginal.clients.map(c => ({ code: c.code, order: c.order, sales: c.status.ytdSales }));
            console.log('Original Top 5:', clientsOriginal.slice(0, 5));
            console.log('Original Count:', clientsOriginal.length);

            // Validate
            const codesCustom = clientsCustom.map(c => c.code);
            const codesOriginal = clientsOriginal.map(c => c.code);
            const isDifferent = JSON.stringify(codesCustom) !== JSON.stringify(codesOriginal);

            if (isDifferent) {
                console.log('\n✅ Orders are DIFFERENT. Sorting logic is active.');

                // Analyze Custom: Expected to be by ORDER asc
                // (Except 9999s at end sorted by sales)
                // Let's check the first few which should have valid orders
                const customHasOrders = clientsCustom.some(c => c.order < 9999);
                console.log('Custom has overrides?', customHasOrders);

                // Analyze Original: Expected to be by SALES desc
                // Check if sorted by sales
                const isOriginalBySales = clientsOriginal.every((c, i) => i === 0 || c.sales <= clientsOriginal[i - 1].sales);
                console.log('Is Original sorted by Sales (Desc)?', isOriginalBySales);

            } else {
                console.log('\n❌ Orders are IDENTICAL.');
            }

        } catch (inner) {
            console.error('Request Logic Error:', inner.message);
        }

    } catch (error) {
        console.error('Script Error:', error);
    }
}
verifySort();
