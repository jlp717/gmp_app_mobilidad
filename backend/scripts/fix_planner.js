const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../routes/planner.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Identify the start of the map function
const startMarker = "const clients = currentYearRows.map(r => {";
const endMarker = "// SORTING STRATEGY";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find markers');
    process.exit(1);
}

// 2. Extract the context (the map body)
// We will simply REPLACE the entire body of the map function
// based on previous knowledge of what it SHOULD be.

const newMapBody = `const clients = currentYearRows.map(r => {
            const code = r.CODE?.trim() || '';
            const prevSales = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const prevYearTotalSales = prevYearTotalMap.get(code) || 0; // Total sales in entire previous year
            const gps = gpsMap.get(code) || { lat: null, lon: null };
            const note = notesMap.get(code);

            const salesCurrent = r.SALES || 0;
            const salesPrev = prevSales.sales || 0; // Sales in equivalent period of prev year

            // Calculate Growth (comparing equivalent periods)
            let growth = 0;
            if (salesPrev > 0) {
                growth = ((salesCurrent - salesPrev) / salesPrev) * 100;
            } else if (salesCurrent > 0) {
                growth = 100;
            }

            const phones = [];
            if (r.PHONE?.trim()) phones.push({ type: 'Teléfono', number: r.PHONE.trim() });
            if (r.PHONE2?.trim()) phones.push({ type: 'Móvil', number: r.PHONE2.trim() });

            // Determine Order
            let clientOrder = 9999;
            if (shouldIgnoreOverrides) {
                // "Original" Mode: Use Natural Order from CDVI
                // If 0 (no natural order), remains 9999 (will be sorted by Code below)
                const natOrder = getNaturalOrder(primaryVendor, code, day);
                if (natOrder > 0) clientOrder = natOrder;
            } else {
                // "Custom" Mode: Use Config Order
                if (orderMap.has(code)) {
                    clientOrder = orderMap.get(code);
                }
            }

            return {
                code,
                name: r.NAME?.trim(),
                address: r.ADDRESS?.trim(),
                city: r.CITY?.trim(),
                phone: r.PHONE?.trim(),
                phone2: r.PHONE2?.trim(),
                phones,
                // Frontend expects 'status' object with raw numbers
                status: {
                    ytdSales: salesCurrent,
                    ytdPrevYear: salesPrev, // Sales in equivalent period
                    prevYearTotal: prevYearTotalSales, // Total sales in entire previous year (for NEW detection)
                    yoyVariation: parseFloat(growth.toFixed(1)),
                    isPositive: growth >= 0
                },
                lat: gps.lat,
                lon: gps.lon,
                observation: note ? note.text : null,
                observationBy: note ? note.modifiedBy : null,
                order: clientOrder
            };
        });

        `;

// Perform replacement
// We replace from startMarker to just before endMarker
const before = content.substring(0, startIndex);
const after = content.substring(endIndex);

const newContent = before + newMapBody + after;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✅ planner.js has been repaired.');
