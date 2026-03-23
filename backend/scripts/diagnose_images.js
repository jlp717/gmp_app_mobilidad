#!/usr/bin/env node
/**
 * DIAGNOSTIC SCRIPT — Product Images Path Resolution
 * ===================================================
 * Run on the production server to determine how to access product images.
 * 
 * Usage: node scripts/diagnose_images.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

console.log('=== SYSTEM INFO ===');
console.log(`Platform: ${os.platform()}`);
console.log(`Hostname: ${os.hostname()}`);
console.log(`Network interfaces:`);
const nets = os.networkInterfaces();
for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) {
            console.log(`  ${name}: ${a.address}`);
        }
    }
}

console.log('\n=== UNC PATH TEST ===');
const uncPath = '\\\\192.168.1.191\\acisa\\xampp\\htdocs\\movilidad\\ImagenesGestorDocumentalNuevo';
try {
    const exists = fs.existsSync(uncPath);
    console.log(`UNC path "${uncPath}" exists: ${exists}`);
} catch (e) {
    console.log(`UNC path error: ${e.message}`);
}

console.log('\n=== LOCAL XAMPP PATH TESTS ===');
const localPaths = [
    '/opt/lampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    '/var/www/html/movilidad/ImagenesGestorDocumentalNuevo',
    '/var/www/movilidad/ImagenesGestorDocumentalNuevo',
    '/srv/http/movilidad/ImagenesGestorDocumentalNuevo',
    '/home/acisa/xampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    '/mnt/acisa/xampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    '/media/acisa/xampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    // Windows-style paths (if running on Windows)
    'C:\\xampp\\htdocs\\movilidad\\ImagenesGestorDocumentalNuevo',
    'D:\\xampp\\htdocs\\movilidad\\ImagenesGestorDocumentalNuevo',
];

for (const p of localPaths) {
    try {
        const exists = fs.existsSync(p);
        if (exists) {
            const items = fs.readdirSync(p).slice(0, 5);
            console.log(`✅ FOUND: ${p} (sample: ${items.join(', ')})`);
        } else {
            console.log(`❌ Not found: ${p}`);
        }
    } catch (e) {
        console.log(`❌ Error for ${p}: ${e.message}`);
    }
}

// Also check for mounted SMB/CIFS shares
console.log('\n=== MOUNT POINTS ===');
try {
    if (os.platform() === 'linux') {
        const { execSync } = require('child_process');
        const mounts = execSync('mount | grep -i cifs || echo "No CIFS mounts"', { encoding: 'utf-8' });
        console.log(mounts.trim());
        // Also check /mnt and /media
        for (const dir of ['/mnt', '/media']) {
            try {
                if (fs.existsSync(dir)) {
                    const items = fs.readdirSync(dir);
                    console.log(`${dir}/: ${items.join(', ') || '(empty)'}`);
                }
            } catch (e) { /* skip */ }
        }
    }
} catch (e) {
    console.log(`Mount check error: ${e.message}`);
}

// Scan common root dirs for 'ImagenesGestorDocumental'
console.log('\n=== SEARCHING FOR ImagenesGestorDocumental ===');
try {
    if (os.platform() === 'linux') {
        const { execSync } = require('child_process');
        const found = execSync('find / -maxdepth 6 -type d -name "ImagenesGestorDocumentalNuevo" 2>/dev/null || echo "Not found via find"', 
            { encoding: 'utf-8', timeout: 10000 });
        console.log(found.trim());
    }
} catch (e) {
    console.log(`Search error: ${e.message}`);
}

console.log('\n=== HTTP ACCESS TEST ===');
const httpUrls = [
    'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo/',
    'http://192.168.1.191:80/movilidad/ImagenesGestorDocumentalNuevo/',
    'http://192.168.1.191:8080/movilidad/ImagenesGestorDocumentalNuevo/',
    'http://localhost/movilidad/ImagenesGestorDocumentalNuevo/',
];

let pending = httpUrls.length;
function checkDone() {
    pending--;
    if (pending <= 0) {
        console.log('\n=== DONE ===');
        console.log('Send the output of this script so we can determine the correct path.');
    }
}

httpUrls.forEach(url => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
        console.log(`${url} → HTTP ${res.statusCode}`);
        res.resume();
        checkDone();
    });
    req.on('error', (e) => {
        console.log(`${url} → ERROR: ${e.message}`);
        checkDone();
    });
    req.on('timeout', () => {
        console.log(`${url} → TIMEOUT`);
        req.destroy();
        checkDone();
    });
});
