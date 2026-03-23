#!/usr/bin/env node
/**
 * DEEP DIAGNOSTIC: Parse Apache directory listings to discover actual structure
 * Run: node scripts/test_images_deep.js
 */
const http = require('http');

const BASE_URL = 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';

function fetchPage(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 15000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk.toString());
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
    });
}

function parseDirectoryListing(html) {
    // Apache directory listing has <a href="name">name</a> links
    const links = [];
    const regex = /<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const href = match[1];
        // Skip parent directory and sorting links
        if (href === '/' || href === '../' || href.startsWith('?') || href.startsWith('/')) continue;
        links.push(decodeURIComponent(href));
    }
    return links;
}

async function main() {
    console.log('=== DEEP IMAGE STRUCTURE DIAGNOSTIC ===\n');

    // 1. List root folder - get product folder names (may timeout for huge dirs)
    console.log('--- Step 1: List root folder (first 50 product folders) ---');
    const rootResult = await fetchPage(BASE_URL + '/');
    let productFolders = [];
    if (rootResult.status === 200) {
        productFolders = parseDirectoryListing(rootResult.body).filter(f => f.endsWith('/'));
        console.log(`Found ${productFolders.length} folders`);
        console.log(`First 30: ${productFolders.slice(0, 30).join(', ')}`);
    } else {
        console.log(`Root listing: ${rootResult.error || rootResult.status}`);
        console.log('(Will test known codes individually)\n');
    }

    // 2. For specific product codes, list their folder contents
    const testCodes = ['1384', '1965', '1415', '1353', '1866', '2450', '2410', '2305', '2418', '2413'];
    
    console.log('\n--- Step 2: List contents of each product folder ---');
    for (const code of testCodes) {
        const folderUrl = `${BASE_URL}/${code}/`;
        const result = await fetchPage(folderUrl);
        if (result.status === 200) {
            const files = parseDirectoryListing(result.body);
            console.log(`\n✅ ${code}/: ${files.join(', ')}`);
        } else if (result.status === 404) {
            // Maybe the folder name has leading zeros or different format?
            console.log(`\n❌ ${code}/ → 404 (folder does not exist)`);
        } else {
            console.log(`\n⚠️ ${code}/ → ${result.error || result.status}`);
        }
    }

    // 3. If root listing worked, find codes that DON'T match expected pattern
    if (productFolders.length > 0) {
        console.log('\n--- Step 3: Sample folder structure analysis ---');
        // Check first 10 folders for their contents
        const sampleFolders = productFolders.slice(0, 15);
        for (const folder of sampleFolders) {
            const folderName = folder.replace(/\/$/, '');
            const folderUrl = `${BASE_URL}/${encodeURIComponent(folderName)}/`;
            const result = await fetchPage(folderUrl);
            if (result.status === 200) {
                const files = parseDirectoryListing(result.body);
                console.log(`${folderName}/: ${files.join(', ')}`);
            }
        }
    }

    // 4. Check if maybe images are stored with different code format
    // (e.g. leading zeros: 001384 instead of 1384)
    console.log('\n--- Step 4: Alternative code formats ---');
    const code = '1384'; // We know this one works
    const variants = [
        code,                           // 1384
        code.padStart(5, '0'),          // 01384
        code.padStart(6, '0'),          // 001384
        code.padStart(7, '0'),          // 0001384
        code.padStart(8, '0'),          // 00001384
    ];
    for (const v of variants) {
        const url = `${BASE_URL}/${v}/`;
        const result = await fetchPage(url);
        if (result.status === 200) {
            const files = parseDirectoryListing(result.body);
            console.log(`✅ ${v}/: ${files.join(', ')}`);
        } else {
            console.log(`❌ ${v}/ → ${result.status || result.error}`);
        }
    }

    // 5. For a working product, explore subdirectories for fichas
    console.log('\n--- Step 5: Explore 1384 subdirectories for fichas ---');
    const code1384Result = await fetchPage(`${BASE_URL}/1384/`);
    if (code1384Result.status === 200) {
        const items = parseDirectoryListing(code1384Result.body);
        const subdirs = items.filter(i => i.endsWith('/'));
        console.log(`1384/ contents: ${items.join(', ')}`);
        console.log(`Subdirectories: ${subdirs.join(', ') || '(none)'}`);
        
        for (const subdir of subdirs) {
            const subdirUrl = `${BASE_URL}/1384/${encodeURIComponent(subdir.replace(/\/$/, ''))}/`;
            const subResult = await fetchPage(subdirUrl);
            if (subResult.status === 200) {
                const subFiles = parseDirectoryListing(subResult.body);
                console.log(`  1384/${subdir}: ${subFiles.join(', ')}`);
            }
        }
    }

    console.log('\n=== DONE ===');
}

main().catch(e => console.error(e));
