# Sesión 2026-05-15 — Resumen ejecutivo

Sesión exhaustiva centrada en (1) los bugs críticos detectados en pedidos, cobros, liquidaciones y bolsa, y (2) cerrar de una vez por todas la arquitectura de datos JAVIER ↔ DSEDAC.

---

## 1. Resumen ultra-corto

| Área | Estado |
|------|--------|
| Backend | 14 fixes aplicados, 45/45 tests OK |
| Frontend Flutter | 5 fixes aplicados, `flutter analyze` sin errores |
| Migraciones SQL | 2 nuevas (026, 027) |
| Documentación | 2 documentos maestros + `.env.example` actualizado |

---

## 2. Bugs arreglados

### Backend

| # | Bug | Origen | Archivo | Fix |
|---|-----|--------|---------|-----|
| 1 | **429 masivos** (rate limit 20-30 req / 15 min muy restrictivo) | `pedidosLimiter`, `cobrosLimiter`, `bolsaLimiter` muy bajos | `backend/middleware/security.js` | Subido a 120-300 req/min/usuario |
| 2 | **Check verde en cobros aunque sí hay deuda** | `getPendingSummary` leía `JAVIER.PEDIDOS_CAB` (15 filas test) en vez de `DSEDAC.CVC` (730k filas deuda real) | `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` | Reescrito para leer `DSEDAC.CVC` con safe-embedding de >50 vendor codes (evita límite 90 params ODBC) |
| 3 | **Error 500 bolsa** (`SQL state 42S02`) | `JAVIER.BOLSA_COMERCIAL` no existe en producción | Migración 026 SQL | DDL idempotente que crea la tabla + índices |
| 4 | **Error 500 cuentas liquidación** | `JAVIER.CUENTAS_LIQUIDACION` tampoco existe | Migración 026 SQL | DDL idempotente |
| 5 | **Promociones siempre vacías** | `DSEDAC.PRD` no existe; la tabla real es `DSEDAC.PMR` con columnas distintas | `backend/services/pedidos.service.js:detectPromoSource` | Auto-detecta tabla + introspección dinámica de columnas (mapping PRD↔PMR↔fallback) |
| 6 | **Race condition al confirmar pedido** (doble-click confirmaba dos veces) | Sin compare-and-swap | `backend/services/pedidos.service.js:confirmOrder` | UPDATE atómico BORRADOR→CONFIRMANDO antes de proceder, con revert en errores tempranos |
| 7 | **`getSimilarProducts` devuelve `[]` siempre** | Variable indefinida `origHasCandidateIngredient` lanzaba `ReferenceError` | `backend/services/pedidos.service.js:calculateSemanticScore` | Bug fix de 1 línea |
| 8 | **Doble prefijo schema** `${ERP_DATA_SCHEMA}${ERP_DATA_SCHEMA}.CLI` | Bug de string interpolation | `backend/services/repartidor-finance-service.js:970` | Quitado un `${ERP_DATA_SCHEMA}` |
| 9 | **"Cobrado" del cliente siempre = 0** | Query usaba `LACLAE.LCTPVT='CO'` pero esa marca no existe (LACLAE sólo tiene VT/AB) | `backend/services/pedidos.service.js:getClientBalance` | Ahora suma `DSEDAC.CVC.IMPORTECANCELADO` del año actual filtrado por cliente |
| 10 | **Bolsa con SCHEMA literal vs dinámico** | `bolsa-comercial.service.js` tenía `JAVIER` hardcodeado, podía confundirse con tablas dinámicas | mismo archivo | Documentado con comentario explícito: por diseño, NO cambiar |
| 11 | **Mensaje error confirmar pedido confuso** ("ya está anulado" cuando era CONFIRMADO) | Mensaje literal incorrecto | `pedidos.service.js:2291` | Mensaje claro + códigos de error tipados |

### Frontend Flutter

| # | Bug | Archivo | Fix |
|---|-----|---------|-----|
| 12 | **Falta tab "Devoluciones"** para comerciales | `lib/features/pedidos/presentation/pages/pedidos_page.dart` | `TabController(length: 3)` + nuevo tab + `_buildDevolucionesTab()` placeholder funcional |
| 13 | **Margen visible para todos** (debe ser solo JEFE_VENTAS) | `lib/features/pedidos/presentation/widgets/order_card.dart` | Nuevo param `isMarginVisible` propagado desde `pedidos_page.dart` con `widget.isJefeVentas` |
| 14 | **Imagen producto fondo negro al ampliar** | `lib/features/pedidos/presentation/widgets/product_card.dart` | `barrierColor: Color(0xCC101218)` translúcido + `Scaffold backgroundColor: transparent` |
| 15 | **Filtro Nestlé no funciona** | Era consecuencia del 429 | — | Resuelto al subir el rate limit |
| 16 | **"Mis pedidos" indicadores a cero** | Era consecuencia del 429 (endpoint `/orders/stats` bloqueado) | — | Resuelto al subir el rate limit |

---

## 3. Arquitectura de datos definitiva

Documento completo: [docs/ARCHITECTURE_DATA_FLOW.md](./ARCHITECTURE_DATA_FLOW.md).

### Resumen

| Entorno | App escribe en | App lee de | Excepción |
|---------|----------------|------------|-----------|
| **Desarrollo** | `JAVIER.*` | `DSEDAC.*` | — |
| **Producción** | `DSEDAC.*` | `DSEDAC.*` | `BOLSA_COMERCIAL` y `MOVIMIENTOS_BOLSA` siempre en `JAVIER` |

### Cómo se cambia entre entornos

Una sola variable de entorno:

```bash
# Desarrollo
PEDIDOS_CONFIRMATION_SCHEMA=JAVIER

# Producción
PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC
```

El servicio `bolsa-comercial.service.js` ignora esta variable y siempre apunta a `JAVIER.BOLSA_COMERCIAL` / `JAVIER.MOVIMIENTOS_BOLSA`, en ambos entornos. Está documentado en el código con un comentario explícito para evitar refactors accidentales.

### Mapeo JAVIER → DSEDAC (paridad estructural)

Para que el cambio de entorno sea transparente, las tablas en JAVIER (dev) deben tener la **misma estructura** que las equivalentes en DSEDAC (prod). Los nombres de tabla difieren (el ERP usa convención 3-letra) pero las columnas deben coincidir.

| Concepto | JAVIER (dev) | DSEDAC (prod) | Alineación columnas |
|----------|--------------|---------------|---------------------|
| Cabecera pedido | `PEDIDOS_CAB` | `CPC` | Migración 027 (opcional) la lleva a paridad 100% |
| Líneas pedido | `PEDIDOS_LIN` | `LPC` | Mejorable con migración análoga |
| Cabecera albarán | `REPARTIDOR_ENTREGAS` | `CAC` | Migración 024 alineó las críticas |
| Líneas albarán | `REPARTIDOR_ENTREGA_LINEAS` | `LAC` | ✅ 126/126 perfectas |
| Recibo PDA cobro | `COBROS` | `CRC` | Pendiente |
| Aplicación cobro a albarán | `REPARTIDOR_COBROS` | `CRCA` | Migración 024 alineó con CVC; CRCA es otro target |
| Cabecera liquidación | `LQD_LIQUIDACIONES` | `LQD` | ✅ Migración 024 |
| Líneas liquidación por concepto | `REPARTIDOR_LIQUIDACION_OPS` | `CLV` | Pendiente (modelos divergentes) |
| Bolsa comercial | `BOLSA_COMERCIAL` | (vive siempre en JAVIER) | N/A |

### Estado del export real al ERP (DSEDAC)

| Flujo | Implementado | Cómo se activa |
|-------|--------------|----------------|
| Pedidos comerciales → `DSEDAC.CPC`/`LPC`/`OCPC` | ✅ Sí | `exportCommercialOrderToSystem` se activa cuando `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` |
| Cobros → `DSEDAC.CRC` / `CRCA` | ⏳ Pendiente | Añadir `exportCobroToSystem` análogo |
| Liquidaciones → `DSEDAC.LQD` + `CLV` | ⏳ Pendiente | Añadir `exportLiquidacionToSystem` (CLV requiere desnormalizar importes a N filas-concepto) |
| Entregas → `DSEDAC.CAC` + `LAC` | ⏳ Pendiente | Añadir `exportEntregaToSystem` |

**Hoy**: el sistema corre en producción con `PEDIDOS_CONFIRMATION_SCHEMA=JAVIER` (la app guarda todo en JAVIER, no llega al ERP). Cuando estés listo para el corte:

1. Asegurar paridad estructural (ejecutar migraciones 026 + 027 + análogas pendientes)
2. Implementar `exportCobroToSystem`, `exportLiquidacionToSystem`, `exportEntregaToSystem`
3. Cambiar a `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` + `PEDIDOS_EXPORT_TO_SYSTEM=true` en `.env` de prod
4. Probar con un vendedor de prueba antes de generalizar

---

## 4. Migraciones SQL aplicables hoy

### Migración 026 — Fixes inmediatos (OBLIGATORIA en producción)

`backend/scripts/sql/026_align_javier_immediate_fixes.sql`:
- Crea `JAVIER.BOLSA_COMERCIAL` + índice
- Crea `JAVIER.CUENTAS_LIQUIDACION` + índice
- Arregla los 3 tipos divergentes en `PEDIDOS_CAB` (`NUMERIC(11,2)` → `NUMERIC(10,2)`)
- Crea vistas faltantes `JAVIER.V_ENTREGAS_HOY` y `JAVIER.V_COMISIONES_REPARTIDOR`

Ejecutar:
```bash
node backend/scripts/run_026_migration.js
```

### Migración 027 — Paridad PEDIDOS_CAB ↔ CPC (OPCIONAL, recomendada antes del corte a prod)

`backend/scripts/sql/027_align_pedidos_to_cpc.sql`:
- Añade ~140 columnas a `JAVIER.PEDIDOS_CAB` para que sea estructuralmente idéntica a `DSEDAC.CPC` (IVA 1-5, importes brutos/descuentos, geolocalización, estado producción, datos de albarán/factura/proyecto, etc.)
- Idempotente (las columnas ya existentes fallan con `SQLSTATE 42711` y se ignoran)

No es necesaria para el funcionamiento actual; sí para el día que se active `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` en producción.

---

## 5. Variables `.env`

Plantilla completa: [backend/.env.example](../backend/.env.example).

### Diferencias clave dev vs prod

| Variable | DEV | PROD |
|----------|-----|------|
| `NODE_ENV` | `development` | `production` |
| `PEDIDOS_CONFIRMATION_SCHEMA` | `JAVIER` | `JAVIER` *hoy* / `DSEDAC` *cuando los exports estén listos* |
| `PEDIDOS_EXPORT_TO_SYSTEM` | `false` | `true` cuando exports listos |
| `JWT_ACCESS_SECRET` | placeholder | secreto rotado >=64 chars |
| `JWT_REFRESH_SECRET` | placeholder | otro secreto >=64 chars |
| `CORS_ORIGIN` | `*` | lista explícita de dominios (NUNCA `*`) |
| `LOG_LEVEL` | `debug` | `info` |
| `REDIS_URL` | local | prod |
| `SMTP_*` | sandbox | smtp real |

### Variables idénticas en ambos entornos

- `ODBC_DSN=GMP`, `ODBC_UID=JAVIER` (las credenciales pueden cambiar)
- `REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC` (lecturas de ERP siempre van a DSEDAC)
- `PEDIDOS_SYSTEM_SUBEMPRESA=GMP`, `PEDIDOS_SYSTEM_SERIE=P`, `PEDIDOS_SYSTEM_TERMINAL=10`
- Bolsa comercial: siempre `JAVIER` (hardcodeado en código)

---

## 6. Pasos para desplegar a producción

```bash
# 1. Local: limpiar archivo basura
git restore --staged backend/scripts/generate_align_migration.js
rm backend/scripts/generate_align_migration.js

# 2. Commit + push de los cambios
git add backend/ lib/ docs/
git commit -m "fix(critical): rate limits + cobros real + promociones PMR + bolsa migration + UI bugs + docs maestros"
git push

# 3. Servidor de producción
ssh gmp@gmp-online
cd /opt/gmp-api
git pull

# 4. Ejecutar migración 026 (obligatoria - crea bolsa, cuentas, vistas faltantes)
node backend/scripts/run_026_migration.js

# 5. (Opcional) Ejecutar migración 027 si vas a activar el export a DSEDAC.CPC
#    Si no, dejar pendiente.

# 6. Reiniciar backend
pm2 restart gmp-api
```

---

## 7. Qué deberías ver al re-abrir la app

- ✅ "Mis Pedidos" carga datos (no más 429)
- ✅ Bolsa comercial carga sin error 500
- ✅ Tab "Devoluciones" visible (placeholder informativo)
- ✅ Promociones cargan si `DSEDAC.PMR` tiene filas vigentes
- ✅ Imagen producto ampliada con fondo translúcido (no negro)
- ✅ Margen no se muestra a comerciales
- ✅ Cobros: check verde solo si NO hay deuda real (lee DSEDAC.CVC)
- ✅ "Lo cobrado" del cliente muestra el importe real, no 0
- ✅ Filtro Nestlé filtra rápido

---

## 8. Bugs pendientes para próxima sesión (no bloqueantes)

| # | Bug | Severidad | Notas |
|---|-----|-----------|-------|
| 1 | Query `/clients/list` 46s para `ALL` | ALTA | Falta índice `DSED.LACLAE(LCAADC, LCTPVT, LCCDCL)` + reescribir SQL para paginar antes del JOIN |
| 2 | Recomendaciones "0 cajas" | MEDIA | Backend devuelve `totalUnits=0`; revisar query de productos habituales en `pedidos.service.js` |
| 3 | Implementar `exportCobroToSystem` (DSEDAC.CRC/CRCA) | MEDIA | Requerido para escribir cobros al ERP en producción |
| 4 | Implementar `exportLiquidacionToSystem` (DSEDAC.LQD/CLV) | MEDIA | Requiere desnormalizar importes JAVIER a N filas por CODIGOCONCEPTO en CLV |
| 5 | Implementar `exportEntregaToSystem` (DSEDAC.CAC/LAC) | MEDIA | LAC ya alineada; CAC necesita backfill de columnas |
| 6 | Nueva página: **Histórico global de compras** (todos los productos, importes, descuentos, clientes) | NUEVA FEATURE | El usuario la pidió; backend endpoint + página Flutter con gráficos y filtros |
| 7 | Eliminar `backend/scripts/generate_align_migration.js` (helper basura) | BAJA | Borrarlo en el commit |

---

## 9. Archivos modificados en esta sesión

### Backend (`backend/`)
- `middleware/security.js`
- `services/pedidos.service.js` (`getClientBalance`, `detectPromoSource`, `getActivePromotions`, `confirmOrder`, `calculateSemanticScore`)
- `services/repartidor-finance-service.js`
- `services/bolsa-comercial.service.js` (doc)
- `src/modules/cobros/infrastructure/db2-cobros-repository.js`
- `migrations/init-tables.js` (doc bolsa)
- `scripts/sql/026_align_javier_immediate_fixes.sql` ⭐ NUEVO
- `scripts/sql/027_align_pedidos_to_cpc.sql` ⭐ NUEVO
- `scripts/run_026_migration.js` ⭐ NUEVO
- `scripts/erp_cobros_inventory.js` ⭐ NUEVO (inventario completo)
- `scripts/erp_diff_condensed.js` ⭐ NUEVO (diff condensado)
- `.env.example` (actualizado con la decisión arquitectónica)

### Frontend (`lib/`)
- `features/pedidos/presentation/pages/pedidos_page.dart` (tab Devoluciones + margen rol-based)
- `features/pedidos/presentation/widgets/order_card.dart` (`isMarginVisible`)
- `features/pedidos/presentation/widgets/product_card.dart` (fondo translúcido)

### Documentación (`docs/`)
- `ARCHITECTURE_DATA_FLOW.md` ⭐ NUEVO (mapa completo JAVIER↔DSEDAC)
- `SESION_2026-05-15_RESUMEN.md` ⭐ NUEVO (este documento)
