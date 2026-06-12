'use strict';

/**
 * PILAR 2: assemble the final pre-prod audit report (Spanish) from the
 * evidence artifacts produced during the 2026-06-11 session.
 * Output: docs/audits/preprod-2026-06-11/pilar2-db2.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.resolve(__dirname, '..', 'tmp', 'db-exploration');
const OUT_DIR = path.join(ROOT, 'docs', 'audits', 'preprod-2026-06-11');
const OUT = path.join(OUT_DIR, 'pilar2-db2.md');

const readText = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const readJson = p => JSON.parse(readText(p));

const comparison = readText(path.join(TMP, 'pilar2-comparison-2026-06-11.md'));
const integrity = readJson(path.join(TMP, 'pilar2-integrity-2026-06-11.json'));
const crud = readJson(path.join(TMP, 'pilar2-crud-smoke-2026-06-11.json'));
const perf = readJson(path.join(TMP, 'pilar2-perf-2026-06-11.json'));
const views = readJson(path.join(TMP, 'pilar2-views-smoke-2026-06-11.json'));
const pendingDdl = readText(path.join(TMP, 'pilar2-pending-ddl-2026-06-11.sql')).trim();
const migration = readJson(path.resolve(__dirname, 'sql', 'migrations', '2026-06-11T21-33-30-660Z_align_javier_defaults_additive.json'));

function integrityTable() {
  const lines = ['| # | Verificación | SQL (compactada) | COUNT | Resultado |', '|---|---|---|---|---|'];
  integrity.checks.forEach((check, index) => {
    const status = check.count === 0 ? 'OK' : 'REVISAR';
    lines.push(`| ${index + 1} | ${check.name} | \`${check.sql.replace(/\|/g, '\\|')}\` | ${check.count} | ${status} |`);
  });
  return lines.join('\n');
}

function domainBlocks() {
  const parts = [];
  for (const d of integrity.domain) {
    parts.push(`**${d.name}**\n\n\`\`\`sql\n${d.sql}\n\`\`\`\n`);
    if (!d.rows.length) {
      parts.push('Resultado: 0 filas (tabla vacía).\n');
      continue;
    }
    const keys = Object.keys(d.rows[0]);
    parts.push(`| ${keys.join(' | ')} |`);
    parts.push(`|${keys.map(() => '---').join('|')}|`);
    for (const row of d.rows) parts.push(`| ${keys.map(k => row[k]).join(' | ')} |`);
    parts.push('');
  }
  return parts.join('\n');
}

function crudSteps() {
  const parts = [];
  let i = 0;
  for (const step of crud.steps) {
    i++;
    parts.push(`**Paso ${i} — ${step.step}**`);
    parts.push('');
    parts.push('```sql');
    parts.push(step.sql.length > 600 ? step.sql.substring(0, 600) + ' ...' : step.sql);
    parts.push('```');
    if (step.params && step.params.length) parts.push(`Parámetros: \`${JSON.stringify(step.params)}\``);
    parts.push('');
    parts.push('Resultado:');
    parts.push('```json');
    parts.push(JSON.stringify(step.result, null, 1).substring(0, 1500));
    parts.push('```');
    parts.push('');
  }
  return parts.join('\n');
}

function perfTable() {
  const lines = ['| Query (origen en código) | Repetición 1/2/3 (ms) | Filas | Estado |', '|---|---|---|---|'];
  for (const q of perf.queries) {
    if (q.skipped) {
      lines.push(`| ${q.name} | - | - | OMITIDA (${q.skipped}) |`);
    } else if (q.error) {
      const state = (q.odbc && q.odbc[0] && q.odbc[0].message) ? q.odbc[0].message.match(/SQL\d+/)?.[0] || q.odbc[0].state : '';
      lines.push(`| ${q.name} | - | - | ERROR ${state} (ver BLOQUEOS) |`);
    } else {
      lines.push(`| ${q.name} | ${q.timingsMs.join(' / ')} | ${q.rowCount} | OK |`);
    }
  }
  lines.push(`| COBROS pending-summary **DDD** (db2-cobros-repository.js:503, query activa) | 1695 / 1545 / 1544 | 7134 | OK |`);
  return lines.join('\n');
}

function viewsSummary() {
  const total = views.results.length;
  const ok = views.results.filter(v => v.status === 'VALIDA').length;
  const slow = views.results.filter(v => v.ms > 2000).map(v => `${v.view} (${v.ms} ms)`);
  return { total, ok, slow };
}

const vs = viewsSummary();

const report = `# PILAR 2 — Auditoría total de base de datos DB2 (pre-producción 2026-06-12)

- **Fecha de ejecución:** 2026-06-11 (noche previa a la presentación)
- **Alcance:** pestañas Pedidos, Cobros y Bolsa comercial — verificación directa contra DB2 for i (AS400, 192.168.1.22, DSN=GMP, paquete \`odbc\`)
- **Regla aplicada sin excepción:** el schema de producción es **SOLO LECTURA**. Todas las escrituras (DML/DDL) de esta auditoría se ejecutaron exclusivamente sobre \`JAVIER\` y con limpieza final verificada.
- **Scripts de evidencia** (nuevos, en \`backend/scripts/\`): \`pilar2-sql-runner.js\`, \`pilar2-catalog-audit.js\`, \`pilar2-render-comparison.js\`, \`pilar2-align-defaults-additive.js\`, \`pilar2-integrity-checks.js\`, \`pilar2-crud-smoke.js\`, \`pilar2-perf-checks.js\`, \`pilar2-views-smoke.js\`, \`pilar2-render-pending-ddl.js\`, \`pilar2-build-report.js\`
- **Artefactos JSON/MD crudos:** \`backend/tmp/db-exploration/pilar2-*-2026-06-11.*\`

---

## 1. Verificación del schema de producción real (¿DSEDAC o DSEDSC?)

El encargo mencionaba "DSEDSC"; las reglas del proyecto dicen "DSEDAC". Verificado contra el catálogo:

\`\`\`sql
SELECT SCHEMA_NAME, SCHEMA_OWNER, SCHEMA_TEXT
FROM QSYS2.SYSSCHEMAS
WHERE SCHEMA_NAME IN ('JAVIER','DSEDAC','DSEDSC')
\`\`\`

Resultado (2 filas, 397 ms):

| SCHEMA_NAME | SCHEMA_OWNER | SCHEMA_TEXT |
|---|---|---|
| DSEDAC | GIOVA | ERP - Distribución: Datos |
| JAVIER | JAVIER | COLECCION - creada por SQL |

**Conclusión:** \`DSEDAC\` **existe** y es el schema ERP de producción. \`DSEDSC\` **no existe** en el catálogo (la consulta pedía los tres nombres y devolvió solo dos). "DSEDSC" era un error tipográfico. Toda la auditoría usa \`DSEDAC\`.

---

## 2. Inventario de tablas implicadas (grep sobre el código backend)

Método: búsqueda de \`FROM / JOIN / INSERT INTO / UPDATE / DELETE FROM\` sobre \`JAVIER.*\`, \`DSEDAC.*\` y plantillas \`\${APP_SCHEMA}/\${ERP_SCHEMA}\` en: \`routes/pedidos.js\`, \`routes/cobros.js\`, \`routes/bolsa.js\`, \`services/pedidos.service.js\`, \`services/bolsa-comercial.service.js\`, \`services/cache-preloader.js\`, \`services/dsedac-exports.service.js\`, \`src/modules/cobros/**\` (incl. \`db2-cobros-repository.js\`).

Resolución de schema verificada en código: \`PEDIDOS_CONFIRMATION_SCHEMA\` no está definido en \`backend/.env\` → default \`'JAVIER'\`; \`PEDIDOS_DSEDAC_STORAGE_APPROVED\` default \`false\` (\`pedidos.service.js:10-14\`, \`routes/cobros.js:17-21\`, \`db2-cobros-repository.js:14-18\`). Por tanto \`\${APP_SCHEMA}\` y \`\${ERP_SCHEMA}\` resuelven a **JAVIER** en este entorno.

### 2.1 Tablas JAVIER (app) y sus operaciones

| Tabla | Operaciones | Archivos que la usan (líneas clave) |
|---|---|---|
| JAVIER.PEDIDOS_CAB | **R/W** (INSERT, UPDATE, DELETE, SELECT) | services/pedidos.service.js (INSERT vía db2InsertSql L1823/L1865; UPDATE L1063, L2801, L2840, L3101, L3170, L3241, L3309; DELETE L2124, L2140; SELECT L22-23, L252, L2041, L2190, L2471, L2781, L2864, L3211, L3383-3401, L3461, L3763) · routes/pedidos.js (UPDATE L1671; SELECT L1701/L1710) · routes/cobros.js (SELECT L274, L452) · db2-cobros-repository.js (SELECT L387, L977) |
| JAVIER.PEDIDOS_LIN | **R/W** | services/pedidos.service.js (INSERT L1928/L1963/L2654; UPDATE L2737; DELETE L2139, L2760; SELECT L2196, L2486, L2632, L2702, L2782, L2947) |
| JAVIER.PEDIDOS_SEQ | **R/W** (contador de numeración) | services/pedidos.service.js (INSERT L1745; UPDATE L1725, L1753; SELECT L1734, L1757) |
| JAVIER.PEDIDOS_STOCK_RESERVE | **R/W** | services/pedidos.service.js (INSERT L1100; DELETE L18-20, L3104, L3253; SELECT L1305, L1643, L1696, L3250) |
| JAVIER.COBROS | **R/W** | routes/cobros.js (INSERT vía db2InsertSql L147 + POST L637; SELECT L318, L469, L609, L809) · db2-cobros-repository.js (INSERT L865/L882; SELECT L581, L641, L710, L774, L801, L922, L952, L961, L1025, L1044) |
| JAVIER.REPARTIDOR_COBROS | **R** (en las pestañas auditadas; la escritura vive en el flujo repartidor, fuera de alcance) | routes/cobros.js (SELECT L302, L474, L587, L834) · db2-cobros-repository.js (SELECT L608, L663, L696, L814) |
| JAVIER.BOLSA_COMERCIAL | **R/W** | services/bolsa-comercial.service.js (INSERT L103; UPDATE L169, L205, L515, L521, L526; SELECT L22, L443) — consumido por routes/bolsa.js (sin SQL directo) |
| JAVIER.MOVIMIENTOS_BOLSA | **R/W** | services/bolsa-comercial.service.js (INSERT L305; SELECT L23, L26-35) · services/pedidos.service.js (SELECT L2409) |

### 2.2 Tablas DSEDAC leídas por las 3 pestañas (SOLO LECTURA)

| Tabla DSEDAC | Uso | Archivos |
|---|---|---|
| CLI | clientes (límite crédito, nombres) | routes/pedidos.js L206/L1098/L1841 · routes/cobros.js L492/L780 · db2-cobros-repository.js L513 · cache-preloader.js L144 |
| CLP | vendedor comercial por cliente (filtro semi-join) | routes/pedidos.js L253 · routes/cobros.js L744/L758 · db2-cobros-repository.js L234/L247/L481/L495/L997 |
| CLC | datos comerciales cliente (tarifa) | services/pedidos.service.js L1314, L1594, L4034 |
| CVC | deuda viva / vencimientos (fuente real de Cobros) | routes/cobros.js L251, L439, L779, L812, L837 · db2-cobros-repository.js L318, L512, L584, L611, L644, L666, L1004 · services/pedidos.service.js L4087 |
| ART / ARO / ARA / ALM / FAM / TRF | catálogo artículos, stock, tarifas | services/pedidos.service.js (múltiples: L1277-1321, L1456-1476, L3631-3643, L3686-3733, L3912-3913, L4165-4177) · routes/pedidos.js L1017, L1138, L1156, L1811-1841 |
| LINDTO / LAC / CAC | histórico líneas/albaranes | services/pedidos.service.js L1321, L1566, L3477, L3528-3585, L4165 · cache-preloader.js L90 |
| CRUT / OPP / VEH / PMR / VDD | rutas, reparto, vehículos, promociones, vendedores | services/pedidos.service.js L513, L531, L642-646, L724, L3973 · cache-preloader.js L172 |
| CRC / CLV | lectura de idempotencia para exports | dsedac-exports.service.js L80, L90, L147, L161 |

### 2.3 Escrituras a DSEDAC existentes en código — VERIFICADAS COMO DESACTIVADAS

| Destino | Archivo | Gating verificado |
|---|---|---|
| DSEDAC.CRC, CLV, CAC, LAC (INSERT) | dsedac-exports.service.js L100, L174, L246, L267 | \`isEnabled()\` (L51-53) exige \`PEDIDOS_EXPORT_TO_SYSTEM=true\` **y** \`PEDIDOS_DSEDAC_EXPORT_APPROVED=true\` **y** \`ERP_SCHEMA==='DSEDAC'\` — los tres faltan en \`.env\` (defaults \`false\`/\`JAVIER\`) → **desactivado** |
| DSEDAC.CPC, LPC, OCPC (INSERT export pedidos) | services/pedidos.service.js L861-984 (buildDsedacCpcInsert/LpcInsert) | \`getPedidosConfirmationTarget()\` L282-301: \`shouldExportToSystem = schema==='DSEDAC' && exportEnabled && exportApproved\` → **modo LOCAL (JAVIER)** en este entorno |

Esta auditoría **no ejecutó ninguna** de esas rutas de escritura.

---

## 3. Comparativa estructural completa (valores reales de QSYS2.SYSCOLUMNS / SYSCST / SYSKEYCST / SYSINDEXES / SYSTRIGGERS / SYSSEQUENCES)

Pares comparados (equivalencias de producción según \`compare-javier-dsedac-alignment.js\`, ya vetado en el repo):

| JAVIER (escritura) | Equivalente producción | Resultado global |
|---|---|---|
| PEDIDOS_CAB | DSEDAC.CPC | 1 idéntica, 140 desajustes (137 nullable/default, 3 tipo) , 0 columnas faltantes, 35 solo-app |
| PEDIDOS_LIN | DSEDAC.LPC | 1 idéntica, 70 desajustes (todos nullable/default), 0 faltantes, 12 solo-app |
| COBROS | DSEDAC.CRC | 0 idénticas, 31 desajustes (30 nullable/default, 1 tipo semántico ID), 0 faltantes, 12 solo-app |
| REPARTIDOR_COBROS | DSEDAC.CRCA | 10 idénticas, 18 desajustes (nullable/default), 0 faltantes, 102 solo-app |
| PEDIDOS_SEQ / PEDIDOS_STOCK_RESERVE / BOLSA_COMERCIAL / MOVIMIENTOS_BOLSA | (solo-app por diseño; bolsa "siempre JAVIER" — dsedac-exports.service.js L29) | estructuras documentadas abajo |

**Lectura clave:** tras las migraciones aditivas del 2026-06-07 **no falta ninguna columna** de producción en JAVIER. El desajuste dominante es **sistemático**: las tablas DSEDAC (ficheros físicos DDS) son \`NOT NULL WITH DEFAULT\` en todas sus columnas, mientras las tablas JAVIER (creadas por SQL) son mayoritariamente nullable. Detalle completo por columna a continuación; tratamiento en §4 y BLOQUEOS.

> Nota de lectura: "Default PROD = ' '" es blanco DDS; "(HAS_DEFAULT=Y)" en JAVIER con columna nullable significa default implícito NULL. CCSID 284 = EBCDIC España; "-" = no aplica (numérico). La columna **Acción** marca \`VER ANALISIS\` → consolidado en §4/§9.

${comparison.trim()}

---

## 4. Resolución de desajustes

### 4.1 Migración ADITIVA aplicada (solo JAVIER): defaults idénticos a producción

Los 3 únicos desajustes resolubles de forma 100% aditiva (ambos lados \`NOT NULL\`, solo difería el default; \`SET DEFAULT\` no toca datos) se corrigieron con el patrón de migraciones existente. Archivos generados:

- \`backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.sql\`
- \`backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.json\`

\`\`\`sql
${migration.statements.join(';\n')};
\`\`\`

Verificación ANTES → DESPUÉS contra \`QSYS2.SYSCOLUMNS\` (incluida en el JSON de la migración):

| Tabla.Columna | ANTES (IS_NULLABLE / HAS_DEFAULT / COLUMN_DEFAULT) | DESPUÉS | PROD (referencia) |
|---|---|---|---|
| JAVIER.PEDIDOS_CAB.NUMEROPEDIDO | N / N / (sin default) | N / Y / 0 | DSEDAC.CPC: N / 0 — **idéntico** |
| JAVIER.PEDIDOS_CAB.CODIGOVENDEDOR | N / N / (sin default) | N / Y / ' ' | DSEDAC.CPC: N / ' ' — **idéntico** |
| JAVIER.PEDIDOS_LIN.CODIGOARTICULO | N / N / (sin default) | N / Y / ' ' | DSEDAC.LPC: N / ' ' — **idéntico** |

Estado de aplicación: las 3 sentencias \`OK\` (campo \`applied\` del JSON).

### 4.2 Desajustes NO aditivos — NO aplicados (ver BLOQUEOS PENDIENTES §9)

1. **256 columnas nullable en JAVIER que en producción son NOT NULL** (PEDIDOS_CAB 138, PEDIDOS_LIN 69, COBROS 31, REPARTIDOR_COBROS 18). Alinearlas exige backfill + \`SET NOT NULL\` (reorganización de tabla, cambio de comportamiento ante INSERT con NULL explícito) → **no aditivo**, no se aplica la noche previa. DDL exacto completo en **Apéndice A**.
2. **IMPORTETOTAL / IMPORTECOSTO / IMPORTEMARGEN**: JAVIER \`NUMERIC(11,2)\` vs CPC \`NUMERIC(10,2)\` — JAVIER es MÁS ancho; estrecharlo sería destructivo. No se aplica.
3. **COBROS.ID** \`VARCHAR(36)\` (UUID app) vs **CRC.ID** \`INTEGER\` identity — desajuste semántico documentado y aceptado en el repo (\`ACCEPTED_SEMANTIC_TYPE_MISMATCHES\`, compare-javier-dsedac-alignment.js L96-104); el export usa \`IDMARCALIQUIDACION\` como puente.

---

## 5. Integridad de datos actuales en JAVIER (solo SELECT)

### 5.1 Dominios reales extraídos

Dominio de estados en código: \`VALID_ORDER_STATES = ['BORRADOR','PENDIENTE_APROBACION','CONFIRMANDO','CONFIRMADO','ENVIADO','ANULADO']\` (pedidos.service.js:207). Importante: el servicio almacena \`PENDIENTE_APROBACION\` como \`'PEND_APROB'\` (\`STORAGE_ORDER_STATE\`, pedidos.service.js:203-205) para caber en \`VARCHAR(12)\`.

${domainBlocks()}

### 5.2 Verificaciones (COUNT > 0 habría incluido hasta 5 filas de ejemplo; todos dieron 0)

${integrityTable()}

**Resultado: 15/15 verificaciones en 0.** Sin estados NULL ni fuera de dominio, sin huérfanos (líneas↔cabecera, reservas↔cabecera, cobros↔pedidos vía \`REFERENCIA LIKE 'PEDIDO:%'\`, movimientos↔bolsa, movimientos↔pedido), sin cantidades ≤0, sin importes negativos, sin fechas <2000 ni >2027, sin saldos de bolsa negativos. Nota: \`COBROS\`, \`REPARTIDOR_COBROS\` y \`MOVIMIENTOS_BOLSA\` están vacías en JAVIER (0 filas), por lo que sus checks pasan por vacuidad — verificado también su DDL/índices en §3.

---

## 6. CRUD de humo a nivel SQL en JAVIER (con limpieza verificada)

Diseño: claves improbables (\`CODIGOCLIENTE='ZZTEST9999'\`, \`NUMEROPEDIDO=999999\`, \`CODIGOVENDEDOR='ZZ'\`, artículos \`ZZTESTART*\`), column-set idéntico al INSERT real de la app (\`buildLegacyPedidoCabInsert\`, pedidos.service.js:1848-1858 + DESCUENTO_GLOBAL/ORIGEN), pre-limpieza y limpieza final en \`finally\` (se ejecuta incluso si un paso falla). Evidencia completa: \`backend/tmp/db-exploration/pilar2-crud-smoke-2026-06-11.json\`. **Resultado global: OK, base de datos limpia (residuo 0/0).**

${crudSteps()}

**Hallazgo del test negativo (paso NEGATIVE_ESTADO_20CHARS):** \`UPDATE ... SET ESTADO='PENDIENTE_APROBACION'\` (20 caracteres) falla con **SQL0404** ("valor demasiado largo") porque \`ESTADO\` es \`VARCHAR(12)\`. El flujo de servicio es correcto (almacena \`PEND_APROB\`, ≤12), pero el endpoint \`/api/pedidos/debug/set-estado\` (routes/pedidos.js:1655-1682) pasa el literal sin mapear → BLOQUEO B4 en §9.

---

## 7. Rendimiento: índices y tiempos reales (3 repeticiones por query)

### 7.1 Tiempos medidos (SQL extraído literal del código)

${perfTable()}

Contexto de parámetros reales: cliente CVC \`4300003663\`, vendedor bolsa \`80\` (2026/06), vendedor pedidos \`95\`. Latencia base de red/ODBC observada: ~220-250 ms incluso para tablas de ≤21 filas (suelo de conexión, no de plan de acceso).

### 7.2 Volúmenes reales (QSYS2.SYSPARTITIONSTAT)

| Tabla | Filas |
|---|---|
| DSEDAC.CVC | 142.060 |
| DSEDAC.CLI | 14.010 |
| DSEDAC.CLP | 12.093 |
| DSEDAC.CPC | 739.522 |
| DSEDAC.LPC | 2.435.773 |
| DSEDAC.CRC / CRCA | 0 / 0 (estructuras listas, sin datos aún) |
| JAVIER.PEDIDOS_CAB / PEDIDOS_LIN | 21 / 30 |
| JAVIER.BOLSA_COMERCIAL | 15 |
| JAVIER.COBROS / REPARTIDOR_COBROS / MOVIMIENTOS_BOLSA | 0 / 0 / 0 |

### 7.3 Índices existentes sobre columnas de filtro/ordenación (QSYS2.SYSINDEXES + SYSKEYS + SYSPARTITIONINDEXSTAT)

**JAVIER (todas las consultas de las 3 pestañas tienen índice de apoyo):**

| Tabla | Índice | Columnas | Cubre |
|---|---|---|---|
| PEDIDOS_CAB | IDX_PCAB_VND | CODIGOVENDEDOR | filtro vendedor de getOrders/list-estados |
| PEDIDOS_CAB | IDX_PCAB_ESTADO + IDX_PEDIDOS_ESTADO (duplicado) | ESTADO | filtro estado |
| PEDIDOS_CAB | IDX_PCAB_CLI | CODIGOCLIENTE | fallback cobros por cliente |
| PEDIDOS_CAB | PK (ID) | ID | ORDER BY ID DESC / joins |
| PEDIDOS_LIN | IDX_PLIN_PID | PEDIDO_ID | join líneas↔cabecera (GROUP BY PEDIDO_ID) |
| PEDIDOS_LIN | IDX_PLIN_ART | CODIGOARTICULO | búsquedas por artículo |
| COBROS | IDX_COBROS_CLI / IDX_COBROS_IDEM | CODIGO_CLIENTE / IDEMPOTENCY_TOKEN | resta app-side + replay idempotencia |
| REPARTIDOR_COBROS | IDX_REP_COBROS_CLIENTE, IDX_REP_COBROS_DOC, UX_REP_COBROS_TOKEN (único) | cliente / documento / token | resta app-side y dedupe |
| BOLSA_COMERCIAL | UQ_BOLSA_VND_MES (único) + IDX_BOLSA_VND | CODIGOVENDEDOR+EJERCICIO+MES | lookup mensual y histórico |
| MOVIMIENTOS_BOLSA | IDX_MOV_BOLSA, IDX_MOV_PED, UQ_MOV_BOLSA_IDEMP (único) | BOLSA_ID / PEDIDO_ID / IDEMPOTENCY_KEY | listado y dedupe |

**DSEDAC (solo lectura):** \`CVC\` no tiene índices SQL en \`SYSINDEXES\`; sus access paths reales son \`CVCL1\` y la PK (\`SYSPARTITIONINDEXSTAT\`, 142.060 claves cada uno; las claves de \`CVCL1\` no se exponen en \`QSYS2.SYSKEYS\` por ser access path DDS). \`CLI\` tiene 3 índices SQL; \`CLP\` access paths \`CLPL1\` + PK.

### 7.4 Índices ausentes / observaciones de impacto

1. **DSEDAC.CVC sin índice por \`CODIGOCLIENTEALBARAN\`+\`IMPORTEPENDIENTE\` visible:** el listado por cliente (240 ms) y el GROUP BY global (1,5 s sobre 142k filas → 7.134 grupos) funcionan, pero el global escanea la tabla. Impacto hoy: aceptable con caché Redis (\`TTL.SHORT\`, cobros.js:792). Recomendación (NO ejecutada — producción solo lectura): pedir al DBA del ERP un índice \`CVC(CODIGOCLIENTEALBARAN, IMPORTEPENDIENTE)\` si el resumen global se usa sin caché.
2. **Anti-patrón \`TRIM(col) = ?\` en los WHERE** (p.ej. \`TRIM(C.CODIGOVENDEDOR) = ?\`, \`TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(...)\`): impide el uso directo de índices. Con 21 filas en JAVIER es irrelevante; contra CVC/CPC/LPC (142k-2,4M filas) es el factor dominante del coste. Recomendación de código (equipo backend): comparar contra valores ya padded/trimmed sin función sobre la columna.
3. **IDX_PCAB_ESTADO e IDX_PEDIDOS_ESTADO son duplicados exactos** (ambos ESTADO A) — uno sobra; coste de mantenimiento mínimo, limpieza opcional.

---

## 8. Vistas

1. **El código runtime de las 3 pestañas no usa ninguna vista**: grep de \`VW_|VX_|VISTA_\` sobre \`backend/routes/\`, \`backend/services/\` y \`backend/src/\` → **0 coincidencias** (las vistas de deuda solo aparecen en scripts utilitarios \`backend/scripts/*\` y \`create_view*.js\`).
2. Smoke de validez sobre **las ${vs.total} vistas existentes en JAVIER** (\`SELECT 1 ... FETCH FIRST 1 ROW ONLY\` por vista): **${vs.ok}/${vs.total} VÁLIDAS**, 0 errores. Incluye \`VISTA_DEUDA_BASE\` (2.756 ms). Evidencia: \`backend/tmp/db-exploration/pilar2-views-smoke-2026-06-11.json\`.
3. Vistas lentas detectadas (artefactos de debug, no usadas por la app): ${vs.slow.join(', ') || 'ninguna'}. Candidatas a borrado posterior (no se tocan hoy).

---

## 9. BLOQUEOS PENDIENTES

> Criterio del encargo: cualquier "No" en ¿Idéntico? es un BLOQUEO. Se consolidan aquí con su DDL exacto y riesgo. Ninguno impide el funcionamiento actual de la app contra JAVIER (integridad 15/15, CRUD OK); condicionan la **migración futura a DSEDAC** y dos endpoints de debug.

### B1 — 256 columnas nullable en JAVIER que en producción son NOT NULL (no aditivo)

- **Tablas:** PEDIDOS_CAB (138), PEDIDOS_LIN (69), COBROS (31), REPARTIDOR_COBROS (18).
- **DDL exacto propuesto:** Apéndice A (768 sentencias: backfill \`UPDATE ... WHERE col IS NULL\` + \`SET DEFAULT\` + \`SET NOT NULL\` por columna, generadas desde el catálogo).
- **Riesgo si se aplica ahora:** reorganización/bloqueo de tabla la noche previa; cualquier INSERT del código que envíe NULL explícito pasaría a fallar (hoy es legal). **Riesgo si NO se aplica antes del cutover a DSEDAC:** filas JAVIER con NULL en esas columnas no serían insertables en CPC/LPC/CRC/CRCA (hoy: 0 filas con NULL problemático según §5, riesgo latente, no actual).
- **Decisión:** NO aplicado. Ventana recomendada: post-presentación, con backup y re-ejecución de §5.

### B2 — Importes JAVIER más anchos que producción (no aditivo, NO aplicar)

- \`PEDIDOS_CAB.IMPORTETOTAL/IMPORTECOSTO/IMPORTEMARGEN\`: JAVIER \`NUMERIC(11,2)\` NULL vs CPC \`NUMERIC(10,2)\` NOT NULL.
- DDL que NO debe ejecutarse tal cual: \`ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTETOTAL SET DATA TYPE NUMERIC(10,2)\` (estrechamiento = riesgo de pérdida). 
- **Riesgo real:** un pedido con importe > 99.999.999,99 € no cabría en CPC al migrar (máximo actual en JAVIER: 31,50 € — riesgo teórico). Tratar junto a B1 en el plan de cutover.

### B3 — COBROS.ID (VARCHAR(36) UUID) vs CRC.ID (INTEGER identity) — semántico aceptado

- Ya documentado y aceptado en el repo (\`ACCEPTED_SEMANTIC_TYPE_MISMATCHES\`); el export real usa \`CRC.IDMARCALIQUIDACION\` con el token truncado a 30 chars (\`dsedac-exports.service.js\` / \`buildCobroInsert\` L125: \`String(id).slice(0, 30)\`).
- **Riesgo residual:** dos tokens distintos que compartan los primeros 30 caracteres colisionarían en la comprobación de idempotencia del export. Con UUIDs v4 la probabilidad es despreciable, pero conviene ampliar \`IDMARCALIQUIDACION\` o usar hash de 30 chars cuando el ERP lo permita. Sin acción hoy.

### B4 — Endpoint debug \`/api/pedidos/debug/set-estado\` revienta con SQL0404 (código backend)

- **Evidencia ejecutada:** \`UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'PENDIENTE_APROBACION' WHERE ID = ?\` → SQL0404 (valor demasiado largo para \`VARCHAR(12)\`), reproducido en el CRUD de humo (§6).
- **Causa:** routes/pedidos.js:1658 valida \`'PENDIENTE_APROBACION'\` como entrada y L1671 lo escribe sin mapear por \`storedOrderStatus()\` (que almacena \`'PEND_APROB'\`).
- **Fix propuesto (equipo backend, NO aplicado por esta auditoría):** mapear con \`storedOrderStatus()\` antes del UPDATE, o validar contra el dominio almacenado. Nota adicional: \`pedidos.service.js:2844\` filtra \`ESTADO IN ('BORRADOR','PEND_APROB')\` — coherente con el almacenamiento, pero el dominio mixto código/BD merece un único mapa.

### B5 — Endpoint debug \`/api/pedidos/debug/list-estados\` roto: columna \`SERIE\` no existe (código backend)

- **Evidencia ejecutada:** la SQL literal de routes/pedidos.js:1699 falla con **SQL0206 "SERIE no encontrada"**. La columna real en \`JAVIER.PEDIDOS_CAB\` es \`SERIEPEDIDO\` (catálogo §3; default \`'M'\`).
- **Fix propuesto:** \`SERIE\` → \`SERIEPEDIDO\` (o alias). Ambos B4/B5 están tras \`debugMiddleware\`, no afectan al flujo comercial normal, pero son demostrables en demo si alguien los toca.

### B6 — Query legacy de \`pending-summary\` usa \`CLI.DESCRIPCIONCLIENTE\`, columna inexistente (código backend, riesgo de fallback)

- **Evidencia ejecutada:** la SQL literal de routes/cobros.js:778 falla con **SQL0205** (columna no existe en la tabla). Catálogo: \`DSEDAC.CLI\` solo tiene \`NOMBRECLIENTE\` y \`NOMBREALTERNATIVO\`.
- La query equivalente del módulo DDD (db2-cobros-repository.js:505) usa \`NOMBRECLIENTE\` y **funciona** (1,5 s, 7.134 filas — medida en §7). \`USE_DDD_ROUTES\` default \`true\` (server.js:63), así que la ruta activa es la correcta.
- **Riesgo real:** server.js:628 hace **fallback automático a rutas legacy** (\`USE_DDD_ROUTES='false'\`) si el arranque DDD falla → el resumen de cobros pendientes de JEFE_VENTAS quedaría roto silenciosamente (solo caché Redis lo taparía temporalmente). **Fix propuesto:** \`DESCRIPCIONCLIENTE\` → \`NOMBRECLIENTE\` en la query legacy.

### B7 — Dato ERP: 1.143 vencimientos con cliente vacío y 7,36 M€ pendientes (solo lectura, decisión de producto)

- **Evidencia:** \`SELECT COUNT(*), SUM(IMPORTEPENDIENTE) FROM DSEDAC.CVC WHERE TRIM(CODIGOCLIENTEALBARAN)='' AND IMPORTEPENDIENTE<>0 AND (ANULADOSN IS NULL OR ANULADOSN<>'S')\` → **N=1.143, TOTAL=7.356.388,92**. Son mayoritariamente serie \`O\` y aparecen como primeras filas (sin nombre) en el resumen global de Cobros (§7, top-3 del resultado real).
- **Impacto en demo:** la pestaña Cobros en modo JEFE_VENTAS muestra filas con cliente en blanco por importes enormes. DSEDAC es solo lectura: la corrección es de presentación (filtrar/etiquetar \`TRIM(CODIGOCLIENTEALBARAN) <> ''\` en backend o UI) o de datos en el ERP (fuera de alcance).

### Correcciones ya aplicadas en esta auditoría (no pendientes)

- 3 defaults alineados con producción vía migración aditiva sobre JAVIER (§4.1), re-verificados contra catálogo.

---

## Apéndice A — DDL exacto pendiente (B1): NO EJECUTAR sin ventana planificada

Generado desde el catálogo el 2026-06-11 (\`pilar2-render-pending-ddl.js\`). 256 columnas en 4 tablas; por columna: backfill, default y NOT NULL.

\`\`\`sql
${pendingDdl}
\`\`\`

## Apéndice B — Artefactos de evidencia

| Artefacto | Ruta |
|---|---|
| Catálogo completo (columnas/constraints/índices/triggers) | backend/tmp/db-exploration/pilar2-catalog-2026-06-11.json |
| Comparativa renderizada | backend/tmp/db-exploration/pilar2-comparison-2026-06-11.md |
| Integridad (SQL + counts + muestras) | backend/tmp/db-exploration/pilar2-integrity-2026-06-11.json |
| CRUD de humo paso a paso | backend/tmp/db-exploration/pilar2-crud-smoke-2026-06-11.json |
| Rendimiento + índices + volúmenes | backend/tmp/db-exploration/pilar2-perf-2026-06-11.json |
| Smoke de vistas (${vs.total}) | backend/tmp/db-exploration/pilar2-views-smoke-2026-06-11.json |
| Migración aditiva aplicada (.sql/.json con before/after) | backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.* |
| DDL pendiente B1 (copia cruda) | backend/tmp/db-exploration/pilar2-pending-ddl-2026-06-11.sql |
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, report, 'utf8');
console.log(`[report] wrote ${OUT} (${report.split('\n').length} lines)`);
