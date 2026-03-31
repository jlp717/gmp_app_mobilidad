# VENTAS_B - Documentación Completa y Plan de Actualización

## 1. Tabla de Base de Datos

**Tabla**: `JAVIER.VENTAS_B`

### Columnas Reales

| Columna | Tipo | Propósito |
|---------|------|-----------|
| `CODIGOVENDEDOR` | CHAR/VARCHAR | Código del vendedor (ej: `'2'`, `'13'`, `'97'`) |
| `EJERCICIO` | NUMERIC(4) | Año (ej: `2025`, `2026`) |
| `MES` | NUMERIC | Número de mes (1-12) |
| `IMPORTE` | DECIMAL/NUMERIC | Importe de ventas (puede ser negativo) |

---

## 2. Estado del Sistema: ¿Funciona Automáticamente?

### SÍ, el sistema está listo.

Solo necesitas hacer los INSERT/UPDATE en `JAVIER.VENTAS_B` y el sistema los recogerá automáticamente. No hay que tocar código.

### No hay datos "trucados" ni hardcodeados

No existe ningún dato de VENTAS_B hardcodeado en el código. Todo viene de la tabla. Lo que sí existe es un mecanismo de **snapshot** en comisiones (ver sección 6) que para enero/febrero 2026 usa valores ya pagados en lugar de recalcular, pero eso afecta a la visualización de la comisión, NO a las ventas B en sí.

---

## 3. Implementación Activa

### Solo se usa la versión JavaScript (`backend/utils/common.js`)

En `server.js:31`:

```javascript
const USE_TS_ROUTES = process.env.USE_TS_ROUTES === 'true';
```

Por defecto es **`false`**, así que **solo se ejecuta la versión JS** de `common.js` que consulta por `EJERCICIO`.

### La versión TypeScript NO se usa en producción

Existe `backend/src/utils/vendor-helpers.ts` con una función `getBSales()` que consulta por `ANIO`, pero **nunca se ejecuta** porque `USE_TS_ROUTES=false`.

### Conclusión: No hay inconsistencia en producción

Tu tabla solo tiene `EJERCICIO` y la única función activa usa `EJERCICIO`. **Todo funciona correctamente.**

---

## 4. Soporte de Valores Negativos

### ¿El código maneja importes negativos?

**SÍ, en general.** Pero hay un detalle importante en objectives.js.

#### ✅ common.js:328 (getBSales) — FUNCIONA con negativos

```javascript
monthlyMap[r.MES] = (monthlyMap[r.MES] || 0) + (parseFloat(r.IMPORTE) || 0);
```

`parseFloat(-479.72)` devuelve `-479.72` y se suma correctamente como negativo.

#### ✅ commissions.js:554-555 — FUNCIONA con negativos

```javascript
prevSales += (bSalesPrevYear[m] || 0);
currentSales += (bSalesCurrYear[m] || 0);
```

Suma el valor tal cual, incluyendo negativos.

#### ⚠️ objectives.js:418 — PROBLEMA CON NEGATIVOS

```javascript
if (existingRow) {
    existingRow.SALES = (parseFloat(existingRow.SALES) || 0) + amount;
} else if (amount > 0) {  // ← ESTO IGNORA NEGATIVOS
    rows.push({ YEAR: yr, MONTH: m, SALES: amount, COST: 0, CLIENTS: 0 });
}
```

**El problema**: Si un vendedor tiene **solo** ventas B negativas en un mes (sin ventas LACLAE), la fila no se crea porque `amount > 0` es falso. Pero si ya existe la fila de LACLAE, la resta se aplica correctamente.

**Impacto real**: Para tus vendedores (1, 13, 97), todos tienen ventas LACLAE normales, así que la fila ya existe y los negativos se restan correctamente. **No necesitas cambiar nada** a menos que un vendedor futuro tenga SOLO ventas B negativas en un mes sin ninguna venta LACLAE.

#### ✅ calculateCommission — FUNCIONA con negativos

La función de cálculo de comisiones acepta `actual` negativo sin problema. Simplemente calculará un porcentaje negativo y la comisión será 0 (no negativa).

---

## 5. Datos Actuales en la Tabla

### Vendedores con datos

| Vendedor | Ejercicio | Meses con datos |
|----------|-----------|-----------------|
| 2 | 2025 | 1, 2 |
| 3 | 2025 | 1, 2 |
| 5 | 2025 | 1, 2 |
| 13 | 2025 | 1-12 (año completo) |
| 13 | 2026 | 1 |
| 16 | 2025 | 1 |
| 20 | 2025 | 1 |
| 92 | 2025 | 1 |
| 94 | 2025 | 1 |
| 97 | 2025 | 1, 2, 5, 7, 11, 12 |

---

## 6. Mecanismo de Snapshot en Comisiones

En `commissions.js:577-590` existe un mecanismo de snapshot:

```javascript
const isPreTransitionMonth = (selectedYear === 2026 && m < 3 && VENDOR_COLUMN === 'R1_T8CDVD');
```

Para **enero y febrero 2026**, si ya hay un pago registrado en `COMMISSION_PAYMENTS`, usa la comisión almacenada en lugar de recalcular. Esto asegura que lo que se ve en la app coincida con lo que se pagó.

**Esto NO afecta a las ventas B.** Las ventas B se suman siempre desde VENTAS_B. El snapshot solo afecta al valor de la comisión mostrada, no a las ventas.

---

## 7. Flujo de Datos Completo

```
┌─────────────────────────────────────────────────────────────┐
│  JAVIER.VENTAS_B (DB2)                                      │
│  CODIGOVENDEDOR | EJERCICIO | MES | IMPORTE                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ getBSales(vendorCode, year)
                           │ (backend/utils/common.js:306)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Monthly Map: { 1: 5000, 2: 6000, 3: -479.72, ... }         │
│  Cache: Map en memoria, TTL 10 min, max 500 entries         │
│  Key: "{vendorCode}:{year}"  ej: "1:2026"                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ Se suma a ventas LACLAE en:
                           │  - routes/commissions.js
                           │  - routes/objectives.js
                           │  - routes/dashboard.js
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Ventas Combinadas = LACLAE + VENTAS_B                      │
│  (incluye negativos: si VENTAS_B es -479.72, se resta)      │
│                                                             │
│  Comisiones:                                                │
│    target = (LACLAE_2025 + B_2025) * 1.03                  │
│    comisión = fn(LACLAE_2026 + B_2026 vs target)           │
│    (snapshot para ene/feb 2026 si hay pago registrado)      │
│                                                             │
│  Objetivos:                                                 │
│    objetivo_anual = (LACLAE_anual + B_anual) * IPC * (1+%) │
│    objetivo_mensual = distribución estacional               │
│                                                             │
│  Dashboard:                                                 │
│    ventas_mes = LACLAE_mes + B_mes                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ API Endpoints:
                           │  GET /api/commissions
                           │  GET /api/objectives/evolution
                           │  GET /api/dashboard
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Flutter Frontend (lib/)                                    │
│  - objectives_page.dart                                     │
│  - commissions_page.dart                                    │
│  - dashboard_content.dart                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Caché

### Implementación (`common.js`)

- **Tipo**: Map en memoria (`_bSalesCache`)
- **TTL**: 10 minutos (`_bSalesCacheTTL = 10 * 60 * 1000`)
- **Max entries**: 500
- **Key**: `{vendorCode}:{year}` (ej: `"1:2026"`)
- **Eviction**: LRU (elimina el más antiguo al llegar a 500)

**Importante**: Después de hacer cambios, los cambios pueden tardar hasta **10 minutos** en reflejarse debido al caché. Si necesitas ver los cambios inmediatamente, reinicia el servidor backend.

---

## 9. Plan de Cambios en la Base de Datos

### A) Corregir datos de 2025 — Vendedor 13 (meses 9-12)

Los valores actuales están desactualizados. Hay que actualizarlos:

| Mes | Valor Actual | Valor Correcto |
|-----|-------------|----------------|
| 9 | 11166.77 | 11316.24 |
| 10 | 19346.10 | 19709.53 |
| 11 | 11679.41 | 11813.10 |
| 12 | 38684.84 | 39528.40 |

**Sentencias SQL:**

```sql
-- Mes 9 (septiembre 2025)
UPDATE JAVIER.VENTAS_B
SET IMPORTE = 11316.24
WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 9;

-- Mes 10 (octubre 2025)
UPDATE JAVIER.VENTAS_B
SET IMPORTE = 19709.53
WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 10;

-- Mes 11 (noviembre 2025)
UPDATE JAVIER.VENTAS_B
SET IMPORTE = 11813.10
WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 11;

-- Mes 12 (diciembre 2025)
UPDATE JAVIER.VENTAS_B
SET IMPORTE = 39528.40
WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 12;
```

### B) Insertar datos nuevos de 2026

#### Mes 2 (febrero 2026)

| Vendedor | Importe |
|----------|---------|
| 1 | -479.72 |
| 13 | 15652.84 |
| 97 | -416.47 |

**Sentencias SQL:**

```sql
-- Vendedor 1 - febrero 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('1', 2026, 2, -479.72);

-- Vendedor 13 - febrero 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('13', 2026, 2, 15652.84);

-- Vendedor 97 - febrero 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('97', 2026, 2, -416.47);
```

#### Mes 3 (marzo 2026)

| Vendedor | Importe |
|----------|---------|
| 1 | -614.75 |
| 13 | 20380.15 |
| 97 | -887.00 |

**Sentencias SQL:**

```sql
-- Vendedor 1 - marzo 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('1', 2026, 3, -614.75);

-- Vendedor 13 - marzo 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('13', 2026, 3, 20380.15);

-- Vendedor 97 - marzo 2026
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
VALUES ('97', 2026, 3, -887.00);
```

### C) Script completo (todo junto)

Si prefieres ejecutarlo todo de una vez:

```sql
-- ============================================
-- VENTAS_B: Actualización completa
-- ============================================

-- 1. CORREGIR 2025 - Vendedor 13 (meses 9-12)
UPDATE JAVIER.VENTAS_B SET IMPORTE = 11316.24 WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 9;
UPDATE JAVIER.VENTAS_B SET IMPORTE = 19709.53 WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 10;
UPDATE JAVIER.VENTAS_B SET IMPORTE = 11813.10 WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 11;
UPDATE JAVIER.VENTAS_B SET IMPORTE = 39528.40 WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 12;

-- 2. INSERTAR 2026 - Mes 2 (febrero)
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('1', 2026, 2, -479.72);
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('13', 2026, 2, 15652.84);
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('97', 2026, 2, -416.47);

-- 3. INSERTAR 2026 - Mes 3 (marzo)
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('1', 2026, 3, -614.75);
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('13', 2026, 3, 20380.15);
INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) VALUES ('97', 2026, 3, -887.00);
```

---

## 10. ¿Hay que cambiar algo del código?

### NO, no hay que cambiar nada del código.

**Razones:**

1. **Valores negativos**: El código los maneja correctamente en `getBSales()` (`common.js:328`), en comisiones (`commissions.js:554-555`), y en dashboard (`dashboard.js:96-97`). El único punto delicado es `objectives.js:418` que ignora filas nuevas con importe negativo, pero tus vendedores (1, 13, 97) todos tienen ventas LACLAE, así que las filas ya existen y los negativos se aplican como resta.

2. **Snapshot de comisiones**: El mecanismo de snapshot (`commissions.js:581`) solo afecta a la visualización de la comisión para enero/febrero 2026, no a las ventas B en sí. Las ventas B se suman siempre desde la tabla.

3. **Caché**: Después de ejecutar los cambios, espera 10 minutos o reinicia el backend para que se refresque el caché de `getBSales()`.

---

## 11. Verificación Post-Cambios

Después de ejecutar las sentencias, puedes verificar con:

```sql
-- Ver todos los datos de 2025 del vendedor 13
SELECT * FROM JAVIER.VENTAS_B WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 ORDER BY MES;

-- Ver todos los datos de 2026
SELECT * FROM JAVIER.VENTAS_B WHERE EJERCICIO = 2026 ORDER BY CODIGOVENDEDOR, MES;

-- Ver totales por vendedor/año
SELECT CODIGOVENDEDOR, EJERCICIO, SUM(IMPORTE) as TOTAL
FROM JAVIER.VENTAS_B
GROUP BY CODIGOVENDEDOR, EJERCICIO
ORDER BY CODIGOVENDEDOR, EJERCICIO;
```

### Después de reiniciar el backend (o esperar 10 min):

- `GET /api/commissions?vendor=13&year=2026` → debe incluir los nuevos valores de 2025 en el target y los de 2026 en las ventas actuales
- `GET /api/objectives/evolution?vendor=13` → debe mostrar los meses 2 y 3 de 2026
- `GET /api/dashboard?vendor=13` → debe reflejar las ventas actualizadas

---

## 12. Resumen de Impacto

| Cambio | Afecta a | Riesgo |
|--------|----------|--------|
| UPDATE vendedor 13, 2025, meses 9-12 | Target de comisiones 2026 (se recalcula con los nuevos valores de 2025) | Bajo — solo cambia el objetivo |
| INSERT 2026, mes 2 (vendedores 1, 13, 97) | Comisiones, objetivos, dashboard de 2026 | Bajo — datos nuevos |
| INSERT 2026, mes 3 (vendedores 1, 13, 97) | Comisiones, objetivos, dashboard de 2026 | Bajo — datos nuevos |
| Valores negativos | Se restan de las ventas totales | Bajo — el código lo soporta |
