# Configuración read/write DB2 — JAVIER vs DSEDAC

**Fecha:** 2026-06-12  
**Módulo central:** `backend/utils/db2-schemas.js`

---

## Reglas de negocio

| Operación | Schema | Tablas típicas |
|---|---|---|
| **Lectura ERP** | `DSEDAC` (fijo) | `CLI`, `CVC`, `ART`, `ARA`, `LAC`, `OPP`, `CPC` (solo lectura) |
| **Escritura app** | `DB2_WRITE_SCHEMA` | `PEDIDOS_CAB`, `PEDIDOS_LIN`, `COBROS`, `BOLSA_COMERCIAL`, `MOVIMIENTOS_BOLSA`, `PEDIDOS_SEQ`, `PEDIDOS_STOCK_RESERVE` |

JAVIER debe tener **estructura idéntica** a DSEDAC en las tablas de escritura comercial (columnas ERP alineadas vía migraciones aditivas en `backend/scripts/sql/migrations/`).

---

## Variables de entorno

```env
# Lectura maestros/deuda ERP — no cambiar salvo entorno especial
DB2_READ_SCHEMA=DSEDAC

# Escritura pedidos/cobros/bolsa
DB2_WRITE_SCHEMA=JAVIER          # test / desarrollo (default)
# DB2_WRITE_SCHEMA=DSEDAC        # producción real

# Gate obligatorio para escribir en DSEDAC (evita accidentes)
PEDIDOS_DSEDAC_STORAGE_APPROVED=false   # true solo tras aprobación SRE/AppSec

# Legacy (fallback si DB2_WRITE_SCHEMA no está definido)
PEDIDOS_CONFIRMATION_SCHEMA=JAVIER
```

### Perfiles recomendados

**Desarrollo / demo (default)**

```env
DB2_READ_SCHEMA=DSEDAC
DB2_WRITE_SCHEMA=JAVIER
PEDIDOS_DSEDAC_STORAGE_APPROVED=false
```

**Producción comercial (escritura ERP real)**

```env
DB2_READ_SCHEMA=DSEDAC
DB2_WRITE_SCHEMA=DSEDAC
PEDIDOS_DSEDAC_STORAGE_APPROVED=true
```

Sin `PEDIDOS_DSEDAC_STORAGE_APPROVED=true`, aunque `DB2_WRITE_SCHEMA=DSEDAC`, el backend **sigue escribiendo en JAVIER** (fail-safe).

---

## Cómo cambiar entre test y producción

1. Editar `.env` en el servidor (o variables PM2).
2. Establecer `DB2_WRITE_SCHEMA` a `JAVIER` o `DSEDAC`.
3. Si es `DSEDAC`, poner `PEDIDOS_DSEDAC_STORAGE_APPROVED=true` solo tras gate explícito.
4. Reiniciar el backend (`pm2 restart gmp-api` en 192.168.1.230).
5. Verificar arranque: log `Route Mode: DDD Routes` y smoke:
   - `GET /api/health`
   - Crear borrador pedido + `GET /api/bolsa/{code}/status`

Export adicional a tablas sistema (`DSEDAC.CPC/LPC` vía `dsedac-exports.service.js`) requiere además:

```env
PEDIDOS_EXPORT_TO_SYSTEM=true
PEDIDOS_DSEDAC_EXPORT_APPROVED=true
```

---

## Bloqueos B1–B3 (cierre)

| ID | Estado | Resolución aditiva |
|---|---|---|
| **B1** | Cerrado (estructura) / diferido (NOT NULL) | Columnas ERP presentes en JAVIER. 256 columnas nullable vs NOT NULL en prod → DDL en `backend/tmp/db-exploration/pilar2-pending-ddl-2026-06-11.sql` (ventana cutover). |
| **B2** | Cerrado (guard) | JAVIER `NUMERIC(11,2)` más ancho que CPC `NUMERIC(10,2)`. Guard `assertMoneyFitsErpNumeric10_2` al escribir con `DB2_WRITE_SCHEMA=DSEDAC`. |
| **B3** | Cerrado (aceptado) | `COBROS.ID` UUID vs `CRC.ID` integer — export vía `IDMARCALIQUIDACION` (30 chars). Ver `ACCEPTED_SEMANTIC_TYPE_MISMATCHES` en `db2-schemas.js`. |

Verificación: `node backend/scripts/pilar2-close-b1-b3.js` → genera manifest en `backend/scripts/sql/migrations/`.

---

## Archivos que consumen el schema

| Archivo | Uso |
|---|---|
| `backend/utils/db2-schemas.js` | Resolución central read/write |
| `backend/services/pedidos.service.js` | `getDb2WriteSchema()` → `ERP_SCHEMA` |
| `backend/routes/cobros.js` | `APP_SCHEMA` para `COBROS` |
| `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` | DDD cobros |
| `backend/services/bolsa-comercial.service.js` | `BOLSA_*` |
| `backend/routes/pedidos.js` | Debug `set-estado` |

Las consultas a `DSEDAC.*` para deuda y catálogo **no** pasan por `DB2_WRITE_SCHEMA`.

---

## Verificación SQL rápida

```sql
-- Schema efectivo en runtime (desde logs de arranque o health interno)
-- Comprobar columnas alineadas JAVIER vs DSEDAC:
SELECT COUNT(*) AS MISSING
  FROM QSYS2.SYSCOLUMNS S
 WHERE S.TABLE_SCHEMA = 'DSEDAC' AND S.TABLE_NAME = 'CPC'
   AND S.COLUMN_NAME NOT IN (
         SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
          WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'PEDIDOS_CAB'
       );
-- Esperado: 0 (salvo columnas app-only documentadas)

-- Integridad JAVIER (15 checks):
-- node backend/scripts/pilar2-integrity-checks.js

-- CRUD humo JAVIER:
-- node backend/scripts/pilar2-crud-smoke.js
```
