const fs = require('fs');
const p = 'c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/src/modules/cobros/infrastructure/db2-cobros-repository.js';
let s = fs.readFileSync(p, 'utf8');

s = s.replace('function mapCvcRowToCobro(row, appPaid = 0) {', 'function mapCvcRowToCobro(row, appPaid = 0, repartidorPaid = 0) {');

if (!s.includes('cobradoPorRepartidor: isCobradoPorRepartidor')) {
  s = s.replace(
    '    appPaymentApplied: appPaidCents > 0 ? fromCents(appPaidCents) : undefined,\n  };\n}',
    `    appPaymentApplied: appPaidCents > 0 ? fromCents(appPaidCents) : undefined,
    cobradoPorRepartidor: isCobradoPorRepartidor({ repartidorPaid, formaPago: trim(row.FORMA_PAGO) || null }),
    esCTR: isFormaPagoRepartidorResponsibility(trim(row.FORMA_PAGO) || null),
    responsabilidad: isCobradoPorRepartidor({ repartidorPaid, formaPago: trim(row.FORMA_PAGO) || null }) ? 'REPARTIDOR' : 'COMERCIAL',
  };
}`,
  );
}

const getAppOld = `  async getAppSideCobrosByDoc(clientCode) {
    const adjustments = new Map();
    const add = (docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
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
        add(formatRepartidorDocKey(row.SERIE, row.NUMERO), row.TOTAL);
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
        add(match ? match[1] : reference, row.TOTAL);
      }
    } catch (error) {
      logger.warn(\`[COBROS_REPO] App-side COBROS doc subtract skipped: \${error.message}\`);
    }

    return adjustments;
  }`;

const getAppNew = `  async getAppSideCobrosByDoc(clientCode) {
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

if (s.includes(getAppOld)) s = s.replace(getAppOld, getAppNew);
else console.warn('getAppSideCobrosByDoc block not found');

s = s.replace(
  `      const appCobrosByDoc = cobrosTableExists
        ? await this.getAppSideCobrosByDoc(clientCode)
        : new Map();
      const cobros = (rows || [])
        .map((row) => mapCvcRowToCobro(
          row,
          appCobrosByDoc.get(\`\${trim(row.SERIE_DOCUMENTO)}-\${row.NUMERO_DOCUMENTO}\`) || 0,
        ))`,
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
);

s = s.replace(
  '    const result = await queryWithParams(sql, [clientCode], []);\n    return result || [];',
  '    const result = await queryWithParams(sql, [clientCode], []);\n    return (result || []).map(mapHistoricoRow);',
);

fs.writeFileSync(p, s);
console.log('patched ok');
