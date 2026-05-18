# Pasos de deploy en PuTTY — guía secuencial

Sesión 2026-05-15. Esta es la guía paso a paso para aplicar TODO lo trabajado al servidor de producción. Lee y ejecuta cada bloque de comandos en orden.

> **Antes de empezar**: haz `git status` en tu máquina local para confirmar que estás en la rama correcta y los cambios están sin commitear todavía. La sesión ha generado código nuevo + migraciones + documentos.

---

## Paso 0 — Verificar que tienes todo localmente

En tu **máquina de desarrollo** (Windows, este repo):

```powershell
cd C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad
git status
```

Deberías ver cambios en (entre otros):
- `backend/middleware/security.js` (rate limits subidos)
- `backend/routes/clients.js` (query 46s → window function)
- `backend/routes/pedidos.js` (endpoint `/purchase-history-global`)
- `backend/routes/repartidor.js` (export entrega a DSEDAC)
- `backend/services/pedidos.service.js` (cobrado real, promociones PMR, confirmOrder atomic, recomendaciones)
- `backend/services/repartidor-finance-service.js` (export liquidación a DSEDAC.CLV)
- `backend/services/bolsa-comercial.service.js` (doc)
- `backend/services/dsedac-exports.service.js` ⭐ NUEVO (3 exports a DSEDAC)
- `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` (CVC + export DSEDAC.CRC)
- `backend/migrations/init-tables.js` (doc bolsa)
- `backend/scripts/sql/026_align_javier_immediate_fixes.sql` ⭐ NUEVO
- `backend/scripts/sql/027_align_pedidos_to_cpc.sql` ⭐ NUEVO
- `backend/scripts/run_026_migration.js` ⭐ NUEVO
- `backend/scripts/erp_cobros_inventory.js` ⭐ NUEVO
- `backend/scripts/erp_diff_condensed.js` ⭐ NUEVO
- `backend/scripts/generate_align_migration.js` ⭐ NUEVO (helper)
- `backend/.env.example` (actualizado)
- `lib/features/pedidos/data/pedidos_service.dart` (modelo Recommendation con suggestedUnits)
- `lib/features/pedidos/presentation/pages/pedidos_page.dart` (4 tabs)
- `lib/features/pedidos/presentation/widgets/order_card.dart` (margen rol-based)
- `lib/features/pedidos/presentation/widgets/product_card.dart` (fondo translúcido)
- `lib/features/products_history/...` ⭐ NUEVO (tab "Evolución" + página standalone)
- `docs/ARCHITECTURE_DATA_FLOW.md` ⭐ NUEVO
- `docs/SESION_2026-05-15_RESUMEN.md` ⭐ NUEVO
- `docs/MAPEO_COLUMNAS_JAVIER_DSEDAC.md` ⭐ NUEVO
- `docs/DEPLOY_PASOS_PUTTY.md` ⭐ NUEVO (este archivo)

---

## Paso 1 — Commit y push desde tu máquina local

```powershell
git add backend/ lib/ docs/
git status   # revisa que NO añades el .env real, solo el .env.example
git commit -m "fix(critical): rate limits + cobros real + promociones PMR + bolsa + UI + exports DSEDAC + docs"
git push origin <tu-rama>
```

Si quieres mergear a `main` primero:
```powershell
git checkout main
git merge test
git push origin main
git checkout test
```

---

## Paso 2 — Conectar al servidor por PuTTY

```bash
# Conecta a gmp@gmp-online (o 192.168.1.230)
cd /opt/gmp-api
git status
git branch --show-current
```

---

## Paso 3 — Traerse los cambios

```bash
git fetch
git pull

# Verifica archivos nuevos:
ls -la backend/scripts/sql/026_align_javier_immediate_fixes.sql
ls -la backend/scripts/sql/027_align_pedidos_to_cpc.sql
ls -la backend/scripts/run_026_migration.js
ls -la backend/services/dsedac-exports.service.js
ls -la docs/SESION_2026-05-15_RESUMEN.md
```

---

## Paso 4 — Decidir el modo de ejecución (importante)

```bash
cat backend/.env | grep -E "PEDIDOS_CONFIRMATION_SCHEMA|PEDIDOS_EXPORT_TO_SYSTEM"
```

Tienes **2 opciones** según hasta dónde quieras llegar HOY:

### Opción A — Modo conservador (recomendada primer deploy)

**Dejas el `.env` como está**. La app sigue escribiendo solo en JAVIER. Los exports a DSEDAC están desactivados. Esto te permite:
- Validar todos los fixes de UI (cobros, bolsa, promociones, tab Evolución, etc.) sin tocar el ERP.
- Reducir riesgo: si algún export tuviera un bug todavía no detectado, no afecta producción.

Para esta opción: **no hagas nada en el `.env`** y pasa al Paso 5.

### Opción B — Modo "ya quiero que entre al ERP" (más agresiva)

**Editas `backend/.env`** y añades/cambias estas 2 líneas:

```bash
PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC
PEDIDOS_EXPORT_TO_SYSTEM=true
```

Con este modo activado, además de escribir en JAVIER, la app llamará a los exports `dsedac-exports.service.js`:
- Cobros → `DSEDAC.CRC`
- Liquidaciones → N filas en `DSEDAC.CLV` (una por concepto: EF, CH, TJ, PD, GT, IB)
- Entregas → `DSEDAC.CAC`
- Pedidos confirmados → ya tenía export previo (`exportCommercialOrderToSystem`)

Los exports están escritos como **best-effort**: si fallan loguean warn pero NO rompen el flujo principal de JAVIER. Aún así, recomiendo probar antes en staging.

**Si eliges B**, edita el `.env`:
```bash
nano backend/.env
# Añade/cambia las 2 líneas. Guarda con Ctrl+O, Enter, Ctrl+X.
```

---

## Paso 5 — Ejecutar la migración 026 (OBLIGATORIA en cualquier modo)

```bash
cd /opt/gmp-api
node backend/scripts/run_026_migration.js
```

**Output esperado**:
```
[026] 25 sentencias detectadas
  [1/25] OK   CREATE TABLE JAVIER.BOLSA_COMERCIAL...
  [2/25] OK   CREATE INDEX JAVIER.IDX_BOLSA_VND...
  ...
Resumen: ~20-25 OK, 0-5 SKIPPED, 0 FAILED
```

Si ves algún `FAILED` con error que NO sea `SQLSTATE 42710/42711`, copia el error y avísame. Los `SKIPPED` son normales (objeto ya existía).

---

## Paso 6 — Verificar que las tablas se crearon

```bash
node -e "
require('dotenv').config({ path: 'backend/.env' });
const odbc = require('odbc');
(async () => {
  const conn = await odbc.connect(\`DSN=\${process.env.ODBC_DSN};UID=\${process.env.ODBC_UID};PWD=\${process.env.ODBC_PWD}\`);
  const rows = await conn.query(\`
    SELECT TABLE_NAME, 'TABLE' AS T FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA='JAVIER'
      AND TABLE_NAME IN ('BOLSA_COMERCIAL','MOVIMIENTOS_BOLSA','CUENTAS_LIQUIDACION')
    UNION ALL
    SELECT TABLE_NAME, 'VIEW' FROM QSYS2.SYSVIEWS
    WHERE TABLE_SCHEMA='JAVIER'
      AND TABLE_NAME IN ('V_ENTREGAS_HOY','V_COMISIONES_REPARTIDOR')
  \`);
  console.log(rows);
  await conn.close();
})().catch(e => console.error(e.message));
"
```

Esperado: 5 filas (3 tablas + 2 vistas).

---

## Paso 7 — Reiniciar el backend

```bash
pm2 restart gmp-api
pm2 logs gmp-api --lines 50
```

Busca en logs:
- `[server] Listening on port 3197` (o tu puerto)
- **No** debe haber `[ERROR]` rojos. Si los hay, copia y avísame.

Si elegiste **Opción B**, deberías ver al pulsar la primera operación de cobro o liquidación líneas como:
- `[DSEDAC-EXPORT] exportCobroToSystem: OK CRC#N (cobro=...)` o
- `[DSEDAC-EXPORT] exportLiquidacionToSystem: OK X filas CLV (...)`

Si elegiste **Opción A**, verás:
- `[DSEDAC-EXPORT] exportXxxToSystem: skip (PEDIDOS_EXPORT_TO_SYSTEM=false...)` — esto es lo esperado.

---

## Paso 8 — Probar desde la app móvil

Abre la app con un usuario JEFE_VENTAS y otro COMERCIAL, comprueba:

| # | Comprobación | Esperado |
|---|--------------|----------|
| 1 | Pestaña "Pedidos" → "Mis Pedidos" | Carga datos, indicadores con valores reales (no 0) |
| 2 | Pestaña "Pedidos" → **"Evolución"** ⭐ NUEVO | Muestra KPIs vendido/sin descuento/descuento + comparativa año anterior + top 10 productos + tabla de líneas con todos los campos (cliente, producto, cantidad, precio, descuento %, importe, vendedor, albarán) |
| 3 | Pestaña "Pedidos" → "Devoluciones" | Placeholder "EN DESARROLLO" sin errores |
| 4 | Pestaña "Pedidos" → "Nuevo Pedido" → filtro Nestlé | Filtra rápidamente sin 429 |
| 5 | Click en producto → ampliar imagen | Fondo translúcido oscuro (no negro absoluto) |
| 6 | Pestaña "Pedidos" → "Mis Pedidos" → tarjetas | Margen NO se muestra para COMERCIAL; SÍ para JEFE_VENTAS |
| 7 | Recomendaciones de productos | Ya no aparece "0 cajas" (usa nuevo campo `suggestedUnits`) |
| 8 | Pestaña "Cobros" → lista clientes | Check verde solo si no tienen deuda real (lee `DSEDAC.CVC`) |
| 9 | Click en cliente con deuda | "Cobrado" muestra importe real (no 0) |
| 10 | Pestaña "Bolsa Comercial" | Carga sin error 500 |
| 11 | Pestaña "Clientes" para JEFE con ALL | Carga en <5s (antes 46s) |
| 12 | Promociones | Si `DSEDAC.PMR` tiene filas vigentes, se ven |

Si algo falla, mira logs:
```bash
pm2 logs gmp-api --lines 200 --nostream | grep -iE "error|warn"
```

---

## Paso 9 — (Opcional) Ejecutar migración 027

**Solo si ya quieres paridad completa de columnas `PEDIDOS_CAB` ↔ `DSEDAC.CPC`** (necesaria si activas Opción B y quieres que los pedidos confirmados se exporten 1:1):

```bash
cd /opt/gmp-api
node -e "
const fs = require('fs');
const odbc = require('odbc');
require('dotenv').config({ path: 'backend/.env' });
const sql = fs.readFileSync('backend/scripts/sql/027_align_pedidos_to_cpc.sql', 'utf8')
  .replace(/--[^\n]*\n/g, '\n').split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
(async () => {
  const conn = await odbc.connect(\`DSN=\${process.env.ODBC_DSN};UID=\${process.env.ODBC_UID};PWD=\${process.env.ODBC_PWD}\`);
  let ok=0, skipped=0, failed=0;
  for (const s of sql) {
    try { await conn.query(s); ok++; }
    catch (e) {
      if (/42711|42710|already exists/i.test(e.message)) skipped++;
      else { failed++; console.error('FAIL:', s.slice(0,80), '->', e.message); }
    }
  }
  await conn.close();
  console.log(\`027: \${ok} OK, \${skipped} ya existian, \${failed} fallaron\`);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Esto añade ~140 columnas a `JAVIER.PEDIDOS_CAB` para que tenga paridad 1:1 con `DSEDAC.CPC`. Es totalmente reversible y no rompe nada (las nuevas columnas tienen DEFAULT y no afectan queries existentes).

---

## Paso 10 — Compilar y desplegar la app móvil

En tu máquina de desarrollo:

```powershell
cd C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad
flutter clean
flutter pub get
flutter build apk --release
```

APK final: `build/app/outputs/flutter-apk/app-release.apk`.

---

## Estado final tras estos pasos

| Componente | Estado |
|------------|--------|
| Backend con TODOS los fixes (incluido exports DSEDAC) | ✅ |
| `JAVIER.BOLSA_COMERCIAL` creada | ✅ tras paso 5 |
| `JAVIER.CUENTAS_LIQUIDACION` creada | ✅ tras paso 5 |
| Vistas `V_ENTREGAS_HOY` y `V_COMISIONES_REPARTIDOR` | ✅ tras paso 5 |
| Rate limits a 120-300 req/min | ✅ |
| Cobros leen `DSEDAC.CVC` (deuda real) | ✅ |
| "Cobrado" cliente desde `DSEDAC.CVC.IMPORTECANCELADO` | ✅ |
| Promociones auto-detectan `DSEDAC.PMR` | ✅ |
| Recomendaciones con `suggestedUnits` (no más "0 cajas") | ✅ |
| `confirmOrder` atomic compare-and-swap | ✅ |
| Algoritmo similares (`getSimilarProducts`) | ✅ |
| `/clients/list` con window function (no 46s) | ✅ |
| Tab "Evolución" (histórico global compras) | ✅ |
| Tab "Devoluciones" (placeholder) | ✅ |
| Margen oculto a comerciales | ✅ |
| Imagen producto fondo translúcido | ✅ |
| Endpoint `/api/pedidos/purchase-history-global` | ✅ |
| `exportCobroToSystem` → `DSEDAC.CRC` | ✅ implementado, activable con flag |
| `exportLiquidacionToSystem` → `DSEDAC.CLV` (N filas concepto) | ✅ implementado, activable con flag |
| `exportEntregaToSystem` → `DSEDAC.CAC` | ✅ implementado, activable con flag |
| Documentación arquitectura + mapeo columnas | ✅ |

---

## Si algo falla

1. **Migración 026 falla con error que NO es 42710/42711**: copia el mensaje completo. Lo más probable es un permiso DDL.
2. **Backend no arranca tras `pm2 restart`**: `pm2 logs gmp-api --lines 200`. Rollback: `git reset --hard HEAD~1 && pm2 restart gmp-api`.
3. **App sigue dando 429**: confirma que `pm2 restart` se ejecutó (`pm2 status`). El rate limit es en memoria, sólo cambia tras restart.
4. **Cobros siguen en verde**: limpia caché con `pm2 restart`. La SQL nueva apunta a `DSEDAC.CVC` y traerá datos reales en la primera petición.
5. **Bolsa sigue 500**: ¿ejecutaste la migración 026? Verifica con el script del paso 6.
6. **Exports a DSEDAC fallan**: están escritos como best-effort. Si fallan loguean `warn` pero el flujo principal (JAVIER) sigue funcionando. Mira los logs por `[DSEDAC-EXPORT]` para ver si están deshabilitados (esperado en modo A) o el error específico (modo B).
7. **`/clients/list` sigue lento**: el fix usa window function; si DB2 for i no la materializa eficientemente puede necesitar índice en `DSED.LACLAE(LCCDCL, LCAADC, LCMMDC, LCDDDC)`. Avísame y te paso el CREATE INDEX.

---

## Documentos asociados

- `docs/ARCHITECTURE_DATA_FLOW.md` — regla de oro JAVIER vs DSEDAC
- `docs/MAPEO_COLUMNAS_JAVIER_DSEDAC.md` — mapeo columna por columna
- `docs/SESION_2026-05-15_RESUMEN.md` — resumen completo de la sesión
- `docs/DEPLOY_PASOS_PUTTY.md` — este archivo

---

## Verificación rápida final (resumen TL;DR)

```bash
# Local
git add . && git commit -m "fix: sesion 2026-05-15 completa" && git push

# Servidor (PuTTY)
ssh gmp@gmp-online
cd /opt/gmp-api && git pull
node backend/scripts/run_026_migration.js
pm2 restart gmp-api
pm2 logs gmp-api --lines 30
```

Y abre la app. Si las 12 comprobaciones del paso 8 funcionan, **terminado**.
