const fs = require('fs');
const path = require('path');

async function main() {
    console.log("=== 6. CHECK COMISIONES POR ROL ===");
    const routePath = path.join(__dirname, '../routes/commissions.js');
    if (fs.existsSync(routePath)) {
        const content = fs.readFileSync(routePath, 'utf8');
        const lines = content.split('\n');
        console.log("Relevant lines in routes/commissions.js regarding role and excluded vendors:");
        lines.forEach((line, index) => {
            if (/EXCLUDED|role|vendedor/i.test(line)) {
                console.log(`[Line ${index + 1}] ${line.trim()}`);
            }
        });
    } else {
        console.log("No commissions.js found.");
    }
}
main();
