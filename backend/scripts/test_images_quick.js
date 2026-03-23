#!/usr/bin/env node
/**
 * Quick test: Can we reach the image server?
 * Run: node scripts/test_images_quick.js
 */
const http = require('http');
const https = require('https');

const BASE_URL = process.env.PRODUCT_IMAGES_URL || 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';
const TEST_CODES = ['1384', '1965', '1415', '1353', '1866'];

console.log(`\n=== Testing image access ===`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Platform: ${process.platform}`);
console.log(`Node version: ${process.version}\n`);

// First, test base URL accessibility
function testUrl(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk.toString().substring(0, 500));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyPreview: body.substring(0, 200) }));
        });
        req.on('error', (e) => resolve({ error: e.message, code: e.code }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
    });
}

async function main() {
    // Test 1: Base directory listing
    console.log(`--- Testing base URL ---`);
    const baseResult = await testUrl(BASE_URL + '/');
    console.log(`${BASE_URL}/ =>`, JSON.stringify(baseResult, null, 2));

    // Test 2: Individual product images
    console.log(`\n--- Testing individual images ---`);
    for (const code of TEST_CODES) {
        for (const ext of ['png', 'jpg', 'jpeg']) {
            const url = `${BASE_URL}/${code}/${code}.${ext}`;
            const result = await testUrl(url);
            const icon = result.status === 200 ? '✅' : '❌';
            console.log(`${icon} ${url} => status=${result.status || result.error}`);
            if (result.status === 200) break; // found it
        }
    }

    // Test 3: Check if maybe the structure is different (images directly in folder, not in subfolder)
    console.log(`\n--- Testing alternative structures ---`);
    const altUrls = [
        `${BASE_URL}/1384.png`,      // maybe directly in root?
        `${BASE_URL}/1384/1384.png`,  // subfolder structure
        `${BASE_URL}/1384/foto.png`,  // maybe named 'foto.png'?
        `${BASE_URL}/1384/foto.jpg`,
        `${BASE_URL}/1384/image.png`,
        `${BASE_URL}/1384/image.jpg`,
    ];
    for (const url of altUrls) {
        const result = await testUrl(url);
        const icon = result.status === 200 ? '✅' : '❌';
        console.log(`${icon} ${url} => status=${result.status || result.error}`);
    }

    // Test 4: Ficha tecnica
    console.log(`\n--- Testing fichas técnicas ---`);
    const fichaUrls = [
        `${BASE_URL}/1384/FICHA%20TECNICA/1384.pdf`,
        `${BASE_URL}/1384/FICHA_TECNICA/1384.pdf`,
        `${BASE_URL}/1384/FICHA TECNICA/1384.pdf`,
    ];
    for (const url of fichaUrls) {
        const result = await testUrl(url);
        const icon = result.status === 200 ? '✅' : '❌';
        console.log(`${icon} ${url} => status=${result.status || result.error}`);
    }

    // Test 5: List folder contents (if Apache has directory listing enabled)
    console.log(`\n--- Checking directory listing for product 1384 ---`);
    const dirResult = await testUrl(`${BASE_URL}/1384/`);
    console.log(`${BASE_URL}/1384/ => status=${dirResult.status || dirResult.error}`);
    if (dirResult.bodyPreview) {
        console.log(`Body preview: ${dirResult.bodyPreview}`);
    }
}

main().catch(e => console.error(e));
