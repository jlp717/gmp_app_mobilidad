# Despliegue: Migración LCCDVD → R1_T8CDVD

## Resumen
Activar nueva columna de vendedor (`R1_T8CDVD` = "quién tiene el cliente asignado") desde marzo 2026, preservando enero/febrero 2026 con la columna original (`LCCDVD` = "quién vendió").

## Pre-requisitos
1. Ejecutar la migración SQL de snapshot ANTES del despliegue
2. Verificar que los tests pasan localmente

---

## Paso 1: Ejecutar migración SQL (snapshot)

Conectar a la DB2 y ejecutar:
```
backend/migrations/001_snapshot_jan_feb_2026.sql
```

Verificar:
```sql
SELECT MES, COUNT(*) as REGISTROS, SUM(IMPORTE_PAGADO) as TOTAL_PAGADO
FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
GROUP BY MES ORDER BY MES;
```

## Paso 2: Despliegue vía Putty

```bash
cd /ruta/del/proyecto
git pull origin test && pm2 restart gmp-api
```

## Paso 3: Verificación post-despliegue

```bash
# 1. Verificar arranque
pm2 logs gmp-api --lines 50
# Buscar: "[CONFIG] VENDOR_COLUMN = R1_T8CDVD (transition: 3/2026)"

# 2. Verificar que no hay errores
pm2 logs gmp-api --err --lines 100

# 3. Test de humo - comisiones
curl -s "http://localhost:3334/api/commissions/summary?vendedorCodes=33&year=2026" | head -200

# 4. Test de humo - objetivos
curl -s "http://localhost:3334/api/objectives/evolution?vendedorCodes=33&years=2026" | head -200
```

## Paso 4: Monitoreo 24h

```bash
# Logs en tiempo real
pm2 logs gmp-api --lines 200

# Estado del proceso
pm2 status

# Monitoreo de memoria/CPU
pm2 monit
```

---

## Rollback (si hay problemas)

### Opción A: Rollback rápido (cambiar env)
Editar `ecosystem.config.js`, cambiar `VENDOR_COLUMN: 'R1_T8CDVD'` a `VENDOR_COLUMN: 'LCCDVD'` en los 3 bloques env, luego:
```bash
pm2 restart gmp-api
```
Con `VENDOR_COLUMN=LCCDVD`, toda la lógica vuelve al comportamiento original automáticamente.

### Opción B: Rollback completo (revertir código)
```bash
git log --oneline -5        # Identificar el commit anterior
git revert <commit-hash>    # Revertir el commit de la migración
git push origin test
pm2 restart gmp-api
```

### Verificar integridad post-rollback
```sql
-- Los datos de snapshot siguen intactos
SELECT COUNT(*) FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102;

-- Los pagos originales no fueron modificados
SELECT COUNT(*) FROM JAVIER.COMMISSION_PAYMENTS WHERE ANIO = 2026 AND MES IN (1, 2);
```

---

## Archivos modificados
| Archivo | Cambio |
|---------|--------|
| `backend/utils/common.js` | Core: VENDOR_COLUMN, getVendorColumn(), buildColumnaVendedorFilter() |
| `backend/routes/commissions.js` | Usa funciones date-aware para filtros de vendedor |
| `backend/routes/objectives.js` | Usa funciones date-aware para filtros de vendedor |
| `backend/routes/dashboard.js` | Usa buildColumnaVendedorFilter en métricas |
| `backend/utils/salesQuery.js` | vendorColumn lee de env |
| `backend/ecosystem.config.js` | VENDOR_COLUMN=R1_T8CDVD en todos los envs |

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|--------|-----------|
| Datos de ene/feb 2026 cambian | getVendorColumn devuelve LCCDVD para < marzo 2026 |
| R1_T8CDVD no existe en LACLAE | La columna existe; verificado en pre-new-logic |
| Performance por OR en filtros | OR solo aplica en queries multi-mes; índices existentes cubren ambas columnas |
| Bug inesperado en producción | Rollback instantáneo: cambiar env a LCCDVD y restart |
