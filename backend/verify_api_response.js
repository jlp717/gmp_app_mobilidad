const http = require('http');

const url = 'http://localhost:3333/api/objectives/evolution?vendedorCodes=33&years=2023,2024,2025';

http.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('--- API RESPONSE CHECK ---');
            if (json.yearTotals) {
                const y23 = json.yearTotals['2023'];
                const y24 = json.yearTotals['2024'];
                const y25 = json.yearTotals['2025'];

                console.log('2023 Total Sales:', y23 ? y23.totalSales : 'N/A');
                console.log('2024 Total Sales:', y24 ? y24.totalSales : 'N/A');
                console.log('2025 Total Sales:', y25 ? y25.totalSales : 'N/A');

                if (y23 && y24) {
                    if (y23.totalSales !== y24.totalSales) {
                        console.log('✅ PASS: 2023 and 2024 sales are different.');
                    } else {
                        console.log('❌ FAIL: 2023 and 2024 sales are IDENTICAL.');
                    }
                }
            } else {
                console.log('No yearTotals found in response');
                console.log(JSON.stringify(json, null, 2).substring(0, 500));
            }
        } catch (e) {
            console.error('Error parsing JSON:', e.message);
            console.log('Raw data:', data);
        }
    });

}).on('error', (err) => {
    console.error('Error connecting to API:', err.message);
});
