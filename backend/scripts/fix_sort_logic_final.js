const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../routes/planner.js');
let content = fs.readFileSync(filePath, 'utf8');

const regex = /return \(a\.name \|\| ''\)\.localeCompare\(b\.name \|\| ''\);/g;

if (regex.test(content)) {
    content = content.replace(regex, "return 0;");
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Replaced Name Sort with Stable DB Order (0).');
} else {
    // Try Code Sort regex just in case previous replace failed?
    const regex2 = /return a\.code\.localeCompare\(b\.code\);/g;
    if (regex2.test(content)) {
        content = content.replace(regex2, "return 0;");
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ Replaced Code Sort with Stable DB Order (0).');
    } else {
        console.log('❌ Could not find sort logic to replace.');
        // Debug
        console.log('Start of file content around match:');
        const match = content.match(/if \(shouldIgnoreOverrides\) \{([\s\S]*?)\}/);
        if (match) console.log(match[0]);
    }
}
