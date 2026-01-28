const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../routes/planner.js');
let content = fs.readFileSync(filePath, 'utf8');

const target = `// Original Route Fallback: Stable Sort by CODE
        return a.code.localeCompare(b.code);`;

const replacement = `// Original Route Fallback: Standard Sort by NAME
        return (a.name || '').localeCompare(b.name || '');`;

if (content.includes('return a.code.localeCompare(b.code);')) {
    // If exact match fails, try relaxed
}

// Try strict first
if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Sort logic updated (Strict match).');
} else {
    // Try simple line replacement
    console.log('⚠️ Strict match failed. Using simple line replacement.');
    const regex = /return a\.code\.localeCompare\(b\.code\);/g;
    if (regex.test(content)) {
        content = content.replace(regex, "return (a.name || '').localeCompare(b.name || '');");
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ Sort logic updated (Regex match).');
    } else {
        console.log('❌ Could not find target line.');
        process.exit(1);
    }
}
