const fs = require('fs');
const p = 'c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/src/modules/cobros/infrastructure/db2-cobros-repository.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const oldMethod = `  async getAppSideCobrosByDoc(clientCode) {
    const byDoc = new Map();
    const repartidorByDoc = new Map();
    const add = (target, docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      target.set(key, (target.get(key) || 0) + (parseFloat(amount) || 0));
    };

    try {
      const repartidorRows = await queryWithParams(
        \`SELECT TRIM(SERIEDOCUMENTO) AS SERIE,
                NUMERODOCUMENTO AS NUMERO,
                COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
           FROM \${APP_SCHEMA}.REPARTIDOR_COBROS
          WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
          GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO\`,
        [trim(clientCode)],
        [],
      );
      for (const row of repartidorRows || []) {
        const docKey = formatRepartidorDocKey(row.SERIE, row.NUMERO);
        add(repartidorByDoc, docKey, row.TOTAL);
        add(byDoc, docKey, row.TOTAL);
      }
    } catch (error) {
      logger.warn(\`[COBROS_REPO] App-side REPARTIDOR_COBROS doc subtract skipped: \${error.message}\`);
    }

    try {
      const comercialRows = await queryWithParams(
        \`SELECT TRIM(REFERENCIA) AS REF, COALESCE(SUM(IMPORTE), 0) AS TOTAL
           FROM \${APP_SCHEMA}.COBROS
          WHERE TRIM(CODIGO_CLIENTE) = ?
          GROUP BY TRIM(REFERENCIA)\`,
        [trim(clientCode)],
        [],
      );
      for (const row of comercialRows || []) {
        const reference = trim(row.REF);
        const match = reference.match(/([^:]+-\\d+)$/);
        const docKey = match ? match[1] : reference;
        add(byDoc, docKey, row.TOTAL);
      }
    } catch (error) {
      logger.warn(\`[COBROS_REPO] App-side COBROS doc subtract skipped: \${error.message}\`);
    }

    return { byDoc, repartidorByDoc };
  }`;

const newMethod = `  async getAppSideRepartidorByDoc(clientCode) {
    const repartidorByDoc = new Map();
    try {
      const repartidorRows = await queryWithParams(
        \`SELECT TRIM(SERIEDOCUMENTO) AS SERIE,
                NUMERODOCUMENTO AS NUMERO,
                COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
           FROM \${APP_SCHEMA}.REPARTIDOR_COBROS
          WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
          GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO\`,
        [trim(clientCode)],
        [],
      );
      for (const row of repartidorRows || []) {
        const docKey = formatRepartidorDocKey(row.SERIE, row.NUMERO);
        repartidorByDoc.set(docKey, (repartidorByDoc.get(docKey) || 0) + (parseFloat(row.TOTAL) || 0));
      }
    } catch (error) {
      logger.warn(\`[COBROS_REPO] App-side REPARTIDOR_COBROS doc subtract skipped: \${error.message}\`);
    }
    return repartidorByDoc;
  }

  async getAppSideCobrosByDoc(clientCode) {
    const adjustments = new Map();
    const add = (docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };

    const repartidorByDoc = await this.getAppSideRepartidorByDoc(clientCode);
    for (const [docKey, amount] of repartidorByDoc.entries()) {
      add(docKey, amount);
    }

    try {
      const comercialRows = await queryWithParams(
        \`SELECT TRIM(REFERENCIA) AS REF, COALESCE(SUM(IMPORTE), 0) AS TOTAL
           FROM \${APP_SCHEMA}.COBROS
          WHERE TRIM(CODIGO_CLIENTE) = ?
          GROUP BY TRIM(REFERENCIA)\`,
        [trim(clientCode)],
        [],
      );
      for (const row of comercialRows || []) {
        const reference = trim(row.REF);
        const match = reference.match(/([^:]+-\\d+)$/);
        add(match ? match[1] : reference, row.TOTAL);
      }
    } catch (error) {
      logger.warn(\`[COBROS_REPO] App-side COBROS doc subtract skipped: \${error.message}\`);
    }

    return adjustments;
  }`;

if (!s.includes(oldMethod)) {
  console.error('method block not found');
  process.exit(1);
}
s = s.replace(oldMethod, newMethod);

s = s.replace(
`      const appDocMaps = cobrosTableExists
        ? await this.getAppSideCobrosByDoc(clientCode)
        : { byDoc: new Map(), repartidorByDoc: new Map() };
      const cobros = (rows || [])
        .map((row) => {
          const docKey = \`\${trim(row.SERIE_DOCUMENTO)}-\${row.NUMERO_DOCUMENTO}\`;
          return mapCvcRowToCobro(
            row,
            appDocMaps.byDoc.get(docKey) || 0,
            appDocMaps.repartidorByDoc.get(docKey) || 0,
          );
        })`,
`      const appCobrosByDoc = cobrosTableExists
        ? await this.getAppSideCobrosByDoc(clientCode)
        : new Map();
      const repartidorByDoc = cobrosTableExists
        ? await this.getAppSideRepartidorByDoc(clientCode)
        : new Map();
      const cobros = (rows || [])
        .map((row) => {
          const docKey = \`\${trim(row.SERIE_DOCUMENTO)}-\${row.NUMERO_DOCUMENTO}\`;
          return mapCvcRowToCobro(
            row,
            appCobrosByDoc.get(docKey) || 0,
            repartidorByDoc.get(docKey) || 0,
          );
        })`,
);

fs.writeFileSync(p, s);
console.log('refactored ok');
