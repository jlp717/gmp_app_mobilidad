# Arquitectura de datos GMP App — JAVIER (dev) vs DSEDAC (prod)

Última actualización: 2026-05-15

## Regla de oro (corregida)

> **En desarrollo la app escribe en `JAVIER`.**
> **En producción la app escribe en `DSEDAC` (ERP real).**
> **Única excepción: `BOLSA_COMERCIAL` y `MOVIMIENTOS_BOLSA` viven SIEMPRE en `JAVIER`, también en producción.**

El motivo es que los datos generados por la app (pedidos, cobros, liquidaciones, entregas) tienen que aparecer en el ERP. Por eso en producción se escriben directamente en las tablas reales del ERP (`DSEDAC.CPC`, `DSEDAC.CRC`, `DSEDAC.CLV`, etc.). La bolsa comercial es un concepto interno que el ERP no necesita.

## Cómo cambiar entre desarrollo y producción

Una sola variable de entorno controla el destino de las escrituras:

```bash
# DESARROLLO (sandbox local, no se ve en el ERP)
PEDIDOS_CONFIRMATION_SCHEMA=JAVIER

# PRODUCCION (se escribe directamente en el ERP)
PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC
```

Bolsa comercial se ignora a esta variable: su tabla está hardcodeada a `JAVIER` por diseño en `backend/services/bolsa-comercial.service.js`.

## Mapeo JAVIER (dev) ↔ DSEDAC (prod)

Para que el cambio sea transparente, las tablas en JAVIER deben tener la **misma estructura** (mismos nombres de columna, mismos tipos) que las del ERP en DSEDAC. Sin embargo los **nombres de tabla son distintos** (la convención del ERP es críptica: 3-letra). Por tanto el código debe distinguir.

| Concepto | JAVIER (dev) | DSEDAC (prod) | Estado |
|----------|--------------|---------------|--------|
| Cabecera pedido | `PEDIDOS_CAB` | `CPC` | ⚠️ Nombres distintos, columnas alineadas tras migración 027 |
| Líneas pedido | `PEDIDOS_LIN` | `LPC` | ⚠️ Nombres distintos, columnas alineables |
| Observaciones pedido | (vive en `PEDIDOS_CAB.OBSERVACIONES`) | `OCPC` | ⚠️ |
| Cabecera albarán cliente | `REPARTIDOR_ENTREGAS` | `CAC` | ⚠️ Modelos divergentes (la JAVIER es de preparación, no es mirror exacto) |
| Líneas albarán cliente | `REPARTIDOR_ENTREGA_LINEAS` | `LAC` | ✅ 126/126 columnas alineadas |
| Recibo PDA (cobro) | `COBROS` | `CRC` | ⚠️ Modelos divergentes; ver decisión más abajo |
| Registro cobro albaranes | `REPARTIDOR_COBROS` | `CRCA` | ⚠️ JAVIER tiene 102 columnas más (info de remesa, banco, asiento contable que ya se almacenan localmente) |
| Cuenta liquidación vendedor (líneas concepto) | `REPARTIDOR_LIQUIDACION_OPS` | `CLV` | ⚠️ Modelos divergentes; CLV es 1 fila por concepto, JAVIER es 1 fila por liquidación con todos los importes |
| Cabecera liquidación | `LQD_LIQUIDACIONES` | `LQD` (la cabecera, separada de CLV) | ✅ Migración 024 ya alineó |
| Bolsa comercial | `BOLSA_COMERCIAL` | `BOLSA_COMERCIAL` (en JAVIER también) | ✅ Por diseño, no se replica al ERP |
| Vencimientos / deuda viva (READ) | `DSEDAC.CVC` desde la app | `DSEDAC.CVC` | ✅ La app solo lee, no escribe |
| Clientes (READ) | `DSEDAC.CLI`/`CLC`/`CLP`/`CLX` | idem | ✅ Solo lectura |
| Artículos (READ) | `DSEDAC.ART`/`ARTX`/`ARO`/`ARA` | idem | ✅ Solo lectura |
| Promociones (READ) | `DSEDAC.PMR` | idem | ✅ Solo lectura (auto-detecta PRD/PMR) |

### Tablas exclusivas de JAVIER (no van al ERP, ni en dev ni en prod)

Son tablas que la app gestiona internamente y que el ERP no necesita:

- `BOLSA_COMERCIAL`, `MOVIMIENTOS_BOLSA` (control de margen mensual por vendedor)
- `LQD_IDEMPOTENCY`, `LQD_COMMISSION_TIERS` (idempotencia + tramos comisión)
- `REPARTIDOR_COBROS_AUDIT` (log de eventos de cobros)
- `REPARTIDOR_FIRMAS` (digitalización de firmas)
- `CLIENT_SIGNERS` (firmantes autorizados por cliente)
- `DELIVERY_STATUS` (estado entrega/firma, con foto y geoloc)
- `RUTERO_CONFIG`, `RUTERO_LOG` (configuración de rutas custom)
- `CART_CONTENT` (carrito en curso del comercial)
- `CLIENT_NOTES` (notas privadas por cliente)
- `KPI_*` (sistema de alertas KPI)
- `OBJ_*`, `COMMERCIAL_TARGETS*`, `COMMISSION_*`, `PAYMENT_CONDITIONS`, `VENDOR_PIN_HASHES`, `SECURITY_AUDIT`, `LOGIN_LOGS`

Estas tablas **están siempre en JAVIER**, tanto en dev como en prod. Son metadata local de la app móvil.

## Cómo saber si una tabla debe ir a DSEDAC en producción

Pregúntate:
1. ¿Esta información tiene que aparecer en el ERP para que contabilidad, almacén u otros sistemas la vean?
   - **Sí** → la tabla equivalente DSEDAC debe existir y el código debe escribir allí cuando `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC`.
   - **No** → siempre JAVIER, no importa el entorno.

2. ¿Es un dato puramente interno de la app móvil (login, KPI, configuración, log)?
   - **Sí** → siempre JAVIER.

## Estado actual del export a DSEDAC en producción

| Flujo | Implementado | Función |
|-------|-------------|---------|
| Pedidos comerciales → `DSEDAC.CPC`/`LPC`/`OCPC` | ✅ Sí, con feature flag | `exportCommercialOrderToSystem` en `pedidos.service.js:887`. Se activa solo cuando `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` y `PEDIDOS_EXPORT_TO_SYSTEM=true`. |
| Cobros → `DSEDAC.CRC` (cabecera) y `DSEDAC.CRCA` (aplicación a albarán) | ⏳ No implementado | Pendiente: añadir `exportCobroToSystem` análogo, mapeando JAVIER.COBROS → CRC y JAVIER.REPARTIDOR_COBROS → CRCA. |
| Liquidaciones diarias → `DSEDAC.LQD` (cabecera) + `DSEDAC.CLV` (líneas) | ⏳ No implementado | Pendiente: análogo. CLV requiere desnormalizar los importes de JAVIER (EFECTIVO, CHEQUES, etc.) a N filas por concepto. |
| Entregas/albaranes → `DSEDAC.CAC` + `DSEDAC.LAC` | ⏳ No implementado | Pendiente: análogo. La línea ya está alineada 126/126, la cabecera necesita backfill de columnas. |

**Implicación práctica hoy**: la app puede correr en producción con `PEDIDOS_CONFIRMATION_SCHEMA=JAVIER` y todo funciona, pero los pedidos/cobros/entregas no aparecen automáticamente en el ERP. Cuando estés listo para activar el export, hay que:

1. Asegurar paridad estructural (migración 027 para pedidos, y análogas para cobros/entregas)
2. Implementar las funciones `exportXxxToSystem` que faltan
3. Cambiar `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` en `.env` de producción
4. Probar primero con una cuenta de prueba antes de generalizar

## Variables `.env` por entorno

### Desarrollo

```bash
NODE_ENV=development
ODBC_DSN=GMP
ODBC_UID=JAVIER
ODBC_PWD=<dev-password>
PEDIDOS_CONFIRMATION_SCHEMA=JAVIER       # pedidos/cobros app en JAVIER
REPARTIDOR_FINANCE_READ_SCHEMA=DSEDAC    # lecturas ERP reales
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER     # LQD sombra/canary
REPARTIDOR_FINANCE_APP_SCHEMA=JAVIER     # tablas app de repartidor
PEDIDOS_EXPORT_TO_SYSTEM=false
JWT_ACCESS_SECRET=dev-only-secret
JWT_REFRESH_SECRET=dev-only-secret-2
CORS_ORIGIN=*
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
```

### Producción

```bash
NODE_ENV=production
ODBC_DSN=GMP
ODBC_UID=<prod-user>
ODBC_PWD=<prod-password-strong>
PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC       # cuando los exports estén completos
REPARTIDOR_FINANCE_READ_SCHEMA=DSEDAC
REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC
REPARTIDOR_FINANCE_APP_SCHEMA=JAVIER     # cambiar a DSEDAC solo si esas tablas existen alli
PEDIDOS_EXPORT_TO_SYSTEM=true            # activa exportCommercialOrderToSystem
JWT_ACCESS_SECRET=<rotated-strong-64-chars>
JWT_REFRESH_SECRET=<another-strong-64-chars>
CORS_ORIGIN=https://app.tu-dominio.com,https://movilidad.tu-dominio.com
REDIS_URL=redis://<prod-redis-host>:6379
LOG_LEVEL=info
```

> **Nota crítica:** mientras los exports de cobros/liquidaciones/entregas a DSEDAC no estén implementados, dejar `PEDIDOS_CONFIRMATION_SCHEMA=JAVIER` también en producción y planificar la migración.
