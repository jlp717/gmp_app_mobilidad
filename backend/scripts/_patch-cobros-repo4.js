const fs = require('fs');
const p = 'c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/src/modules/cobros/infrastructure/db2-cobros-repository.js';
let s = fs.readFileSync(p, 'utf8');
const norm = (x) => x.replace(/\r\n/g, '\n');
s = norm(s);
s = s.replace(
`    const add = (target, docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };`,
`    const add = (target, docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      target.set(key, (target.get(key) || 0) + (parseFloat(amount) || 0));
    };`,
);
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
fs.writeFileSync(p, s);
console.log('appDocMaps', s.includes('appDocMaps'));
console.log('bad adjustments in target add', /const add = \(target[\s\S]{0,200}adjustments\.set/.test(s));
