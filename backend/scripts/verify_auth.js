const { query, initDb } = require('../config/db');

async function verifyAuthLogic() {
    try {
        await initDb();
        console.log("🔍 Verifying Auth Logic / Commission Exceptions...");

        const testUsers = ['02', '03', '13', '81', '74']; // 81 and 74 should have commissions visible

        for (const user of testUsers) {
            // Mimic the query in auth.js
            const result = await query(`
                SELECT P.CODIGOVENDEDOR, 
                       TRIM(D.NOMBREVENDEDOR) as NOMBRE,
                       E.HIDE_COMMISSIONS
                FROM DSEDAC.VDPL1 P
                JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
                LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
                WHERE TRIM(P.CODIGOVENDEDOR) = '${user}'
                FETCH FIRST 1 ROWS ONLY
            `, false);

            if (result.length > 0) {
                const u = result[0];
                const hide = u.HIDE_COMMISSIONS === 'Y';
                const show = !hide;
                const status = show ? "✅ SHOW" : "🚫 HIDE"; // Green check/Red stop

                console.log(`User ${user} (${u.NOMBRE}): ${status} (DB Flag: ${u.HIDE_COMMISSIONS || 'N/A'})`);
            } else {
                console.log(`User ${user}: Not found in VDPL1`);
            }
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

verifyAuthLogic();
