# Auditoría adversaria — Liquidación diaria + Cobros comercial (2026-09-22)

Ejecutado contra API `192.168.1.230:3335` (`REPARTO_TABLE_SET=isolated_test`) y DB2 vía ODBC en ese host.

## 1. Liquidación (`getLqdForVendorDay` / resumen-diario)

| Pregunta | Evidencia |
|---|---|
| ¿Qué tabla lee LQD? | En `isolated_test` → `JAVIER.TEST_LQD`. Fuera → `DSEDAC.LQD`. |
| ¿TEST_LQD refleja pedidos/cobros de la app? | **No.** Es snapshot ERP (`INSERT … SELECT * FROM DSEDAC.LQD`). Conteos 2026-09-22: LIVE 62833 / TEST 62830. |
| ¿La UI puede engañar? | **Sí (antes del fix).** `getDailySummary` prefería LQD si había fila del día e ignoraba `TEST_COBROS`. |

### SQL / día conflictivo (vendedor 35)

| Fecha | TEST_LQD filas / TI | TEST_COBROS N / TOTAL | ¿UI prefería LQD? |
|---|---|---|---|
| 2026-09-16 | 1 / **1411.80** | 4 / **0.04** | sí → gap |
| 2026-09-18 | 1 / 394.05 | 0 / 0 | LQD OK (sin cobros app) |
| 2026-09-22 | 0 | 0 | fallback COBROS |

Fuente: `days-evidence.jsonl`.

### Fix (sin romper prod)

En `isolated_test`, si hay actividad en cobros app ese día → summary usa `JAVIER.TEST_COBROS` y deja `lqd` en la respuesta como snapshot ERP (`lqdIgnoredReason=isolated_test_prefers_app_cobros_over_lqd_snapshot`).

Prod sigue preferiendo `DSEDAC.LQD` (pizarra ERP) aunque existan cobros app el mismo día.

## 2. Cobros comercial

| Check | Resultado |
|---|---|
| Escritura | `db2AppTable('COBROS')` → `JAVIER.TEST_COBROS` en isolated_test |
| Anti-duplicado vs repartidor | `LOCK TABLE TEST_REPARTIDOR_COBROS` + `COBRO_ALREADY_COLLECTED_BY_REPARTIDOR` (409) |
| PDF Carlos/Javier/comercial | `notifyCommercialCobro` best-effort + `.catch` tras insert; no tumba el registro |
| Frontera objetivos/comisiones/LY | `DSED.LACLAE`, `DSEDAC.CVC`, `JAVIER.COMMERCIAL_TARGETS` — no movidos a TEST_* |

### Cobro de prueba (TEST, 0.01 €)

- Cliente `4300009586`, label visible `F-0-12346`, payment ref `CVC:F-12346`
- `POST /cobros/.../registrar` → **200**
- Fila en `JAVIER.TEST_COBROS`: `ID=CBR-25b5aee8…`, `REF=CVC:COB:F:GMP:2025:F:0:12346:1:1`, token `adv-cobro-35-1790066235454`
- Nota: enviar solo el label `F-0-12346` (sin `id`/`docKey.reference`) → 404 `ORDER_NOT_FOUND_FOR_PAYMENT`. La app Flutter ya usa `paymentReference` (estable); no es regresión de UI.

Evidencia: `cobro-stable-ref-evidence.jsonl`.

## 3. Archivos tocados

- `backend/services/comercial-devoluciones-service.js` — prioridad summary
- `backend/__tests__/comercial-devoluciones-service.test.js` — casos isolated vs prod
- este directorio de evidencia

## 4. Verificación

```bash
cd backend && npm test -- --testPathPattern=comercial-devoluciones-service
# 22 passed
```

Post-deploy (`eb550c3` en 230, `/api/ready` OK):

```json
{
  "source": "JAVIER.TEST_COBROS",
  "totalAIngresar": 0.04,
  "lqdIgnoredReason": "isolated_test_prefers_app_cobros_over_lqd_snapshot",
  "lqdSource": "JAVIER.TEST_LQD",
  "lqdTI": 1411.8
}
```

Antes del fix ese día mostraba `totalAIngresar=1411.80` desde LQD.