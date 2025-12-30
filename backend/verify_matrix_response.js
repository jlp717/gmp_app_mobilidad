
const axios = require('axios');

// Fetch data from local running server
async function verifyMatrix() {
    try {
        const clientCode = '4300032766'; // Using a client known to have data from logs
        const years = '2023,2024';
        const url = `http://localhost:3333/api/objectives/matrix?clientCode=${clientCode}&years=${years}&includeYoY=true`;

        console.log(`Fetching: ${url}`);
        const res = await axios.get(url);
        const data = res.data;

        console.log("=== ROOT KEYS ===");
        console.log(Object.keys(data));

        console.log("\n=== GRAND TOTAL ===");
        console.log(data.grandTotal);

        console.log("\n=== MONTHLY TOTALS (SAMPLE) ===");
        // check structure of first year
        const firstYear = Object.keys(data.monthlyTotals)[0];
        if (firstYear) {
            console.log(`Year ${firstYear}:`, data.monthlyTotals[firstYear]);
        } else {
            console.log("No monthly totals found");
        }

        console.log("\n=== FAMILIES (First 2) ===");
        if (data.families && data.families.length > 0) {
            data.families.slice(0, 2).forEach(f => {
                console.log(`\nFamily: ${f.familyName} (${f.familyCode})`);
                console.log(`  Sales: ${f.totalSales}, Margin%: ${f.totalMarginPercent}`);

                if (f.subfamilies && f.subfamilies.length > 0) {
                    console.log(`  Subfamilies: ${f.subfamilies.length}`);
                    f.subfamilies.slice(0, 1).forEach(s => {
                        console.log(`    Subfamily: ${s.subfamilyName} (${s.subfamilyCode})`);
                        console.log(`    Sales: ${s.totalSales}, Margin%: ${s.totalMarginPercent}`); // Check key name!
                        console.log(`    Products: ${s.products ? s.products.length : 0}`);
                        if (s.products && s.products.length > 0) {
                            const p = s.products[0];
                            console.log(`      Product: ${p.productName}`);
                            console.log(`      Margin%: ${p.totalMarginPercent}`); // Check key name
                            console.log(`      Monthly Data (Sample):`, JSON.stringify(p.monthlyData?.['2024']?.['1'] || "None"));
                        }
                    });
                } else {
                    console.log("  No subfamilies");
                }
            });
        } else {
            console.log("No families found");
        }

    } catch (error) {
        console.error("Error verifying matrix:", error.message);
        if (error.response) {
            console.error("Response status:", error.response.status);
            console.error("Response data:", error.response.data);
        }
    }
}

verifyMatrix();
