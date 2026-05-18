# Revision comisiones repartidores

Fecha: 2026-05-18

## Regla validada

Para repartidores, la base de calculo mensual es el total repartido del periodo
(`deliveredAmount`). El total cobrado (`collectedAmount`) se compara contra los
umbrales configurados:

| Umbral sobre base | Porcentaje comision |
| --- | --- |
| 20% | 0.5% |
| 30% | 0.7% |
| 50% | 0.8% |
| 70% | 1.0% |

La comision se calcula con el tramo mas alto alcanzado, y solo sobre el exceso
por encima de ese tramo. Ejemplo: base 100000, cobrado 21000. Umbral 20% =
20000; exceso = 1000; comision = 1000 * 0.5% = 5.

## Flujo Tobaken / frontend

| Capa | Archivo | Uso |
| --- | --- | --- |
| Pantalla | `lib/features/repartidor_finanzas/presentation/pages/comisiones_page.dart` | Muestra cobrado, base, porcentaje, comision y tabla de tramos. |
| Provider | `lib/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart` | `repartidorCommissionSummaryProvider` y `repartidorCommissionTiersProvider`. |
| Modelos | `lib/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart` | Parseo de resumen, tramos y tramo aplicado. |
| API client | `lib/features/repartidor_finanzas/data/repartidor_finanzas_service.dart` | Llama a `/repartidor-finanzas/commissions/summary/:repartidorId` y `/tiers`. |

## Backend

| Endpoint | Archivo | Funcion |
| --- | --- | --- |
| `GET /repartidor-finanzas/commissions/summary/:repartidorId` | `backend/routes/repartidor-finanzas.js` | Devuelve resumen mensual. |
| `GET /repartidor-finanzas/commissions/tiers` | `backend/routes/repartidor-finanzas.js` | Devuelve tramos activos. |
| `PUT /repartidor-finanzas/commissions/tiers` | `backend/routes/repartidor-finanzas.js` | Permite editar tramos a jefe/admin. |
| Calculo | `backend/services/repartidor-finance-service.js` | `calculateCommission`: tramo mas alto alcanzado sobre exceso. |

## Tablas usadas

| Tabla | Esquema | Uso | Origen de esquema |
| --- | --- | --- | --- |
| `OPP` | `ERP_DATA_SCHEMA` | Relaciona orden/preparacion con repartidor y fecha de reparto. | `REPARTIDOR_FINANCE_ERP_SCHEMA`, `FINANCE_ERP_SCHEMA` o `PEDIDOS_CONFIRMATION_SCHEMA`; solo `JAVIER`/`DSEDAC`. |
| `CPC` | `ERP_DATA_SCHEMA` | Importe total repartido (`IMPORTETOTAL`) y claves de documento. | Mismo origen que `OPP`. |
| `CVC` | `ERP_DATA_SCHEMA` | Pendiente del documento; permite inferir cobrado real: `IMPORTETOTAL - IMPORTEPENDIENTE`, o total si pendiente es 0. | Mismo origen que `OPP`. |
| `REPARTIDOR_COMMISSION_TIERS` | `COMMISSION_CONFIG_SCHEMA` | Configuracion editable de tramos 20/30/50/70. | `REPARTIDOR_COMMISSION_CONFIG_SCHEMA`, `COMMISSION_APP_SCHEMA` o `JAVIER` por defecto. |

## Paridad JAVIER / DSEDAC

La pantalla de repartidor ya no depende de tablas hardcodeadas para los datos
ERP: `OPP`, `CPC` y `CVC` salen del esquema ERP configurado. Los tramos son
configuracion propia de la app; por defecto quedan en `JAVIER` para evitar que
un cambio de `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` falle si `DSEDAC` no tiene esa
tabla auxiliar. Si se quiere operar todo en `DSEDAC`, debe existir
`DSEDAC.REPARTIDOR_COMMISSION_TIERS` con la misma estructura y debe definirse
`REPARTIDOR_COMMISSION_CONFIG_SCHEMA=DSEDAC`.

Para comerciales, el flujo actual sigue usando tablas de configuracion propias
en `JAVIER` (`COMM_CONFIG`, `COMMISSION_EXCEPTIONS`, `COMMISSION_PAYMENTS`,
`COMMISSION_SNAPSHOT_2026_0102`, `COMMERCIAL_TARGETS`, `VENTAS_B`) y ventas de
`DSED.LACLAE`. La regla comercial ya usa tramo unico sobre incremento por encima
del objetivo, pero la parametrizacion de esquema comercial completa sigue siendo
un trabajo separado.
