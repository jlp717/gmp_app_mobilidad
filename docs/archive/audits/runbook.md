# Runbook de Auditoría — GMP App Mobilidad

## Resumen Ejecutivo (10 líneas)

| Prioridad | Hallazgo | Riesgo |
|-----------|----------|--------|
| **CRÍTICO** | NUMEROFACTURA=999999 pasa todos los filtros → documentos "A-999999" visibles, PDF crashea | Bajo (solo excluye sentinelas ERP) |
| **CRÍTICO** | IMPORTETOTAL=-9999999 / -0 corrompe totales y genera PDFs ilegibles | Bajo (sanitiza datos inválidos) |
| **CRÍTICO** | PDF sin validación previa → crash en pdfkit con datos extremos | Bajo (solo bloquea docs corruptos) |
| **ALTO** | DELETE+INSERT sin transacción en confirmación de entrega → pérdida de estado | Medio (añade recovery) |
| **ALTO** | Rutero→histórico depende de JOIN por ID — formato inconsistente = pérdida | Bajo (verificar formato) |
| **MEDIO** | Entregas confirmadas sin firma (ENTREGADO sin FIRMA_PATH) | Bajo (solo logging) |
| **MEDIO** | SQL injection potencial en queries dinámicas | Seguridad (tech debt) |

**Tiempo estimado: ~2 horas** para fixes críticos + altos.

---

## Pre-requisitos

```bash
# Variables de entorno (o defaults)
export ODBC_DSN=GMP
export ODBC_UID=JAVIER
export ODBC_PWD=JAVIER
```

## Paso 1: Scan de anomalías (solo lectura)

```bash
cd backend/audit/scripts

# Escaneo completo (solo lectura, no modifica nada)
node scan_anomalies.js --dry-run

# Con límite para prueba rápida
node scan_anomalies.js --dry-run --limit 50
```

**Salida**:
- `backend/audit/anomalies.csv` — cada registro anómalo
- `backend/audit/report.json` — métricas y resumen

**Verificar**: Abrir anomalies.csv y confirmar que se detectan los casos del cliente 30784.

---

## Paso 2: Preview de correcciones de código (dry-run)

```bash
# Ver qué cambios se harían (NO modifica archivos)
node fix_anomalies.js --dry-run
```

**Verificar**: Revisar que cada patch tiene sentido antes de aplicar.

---

## Paso 3: Backup manual

```bash
# Backup de archivos que se van a modificar
mkdir -p ../backups/manual
cp ../../services/facturas.service.js ../backups/manual/
cp ../../services/pdf.service.js ../backups/manual/
cp ../../app/services/pdfService.js ../backups/manual/
cp ../../routes/entregas.js ../backups/manual/
```

---

## Paso 4: Aplicar correcciones

```bash
# ⚠️ ESTO MODIFICA LOS ARCHIVOS DE CÓDIGO
node fix_anomalies.js --apply
```

**Salida**:
- Backups automáticos en `backend/audit/backups/`
- `backend/audit/migration_audit.json` — log de cambios

---

## Paso 5: Verificación automatizada

```bash
# Tests offline (verifica que los patches están presentes)
node verify_fixes.js

# Tests con BD real (verifica exclusión de sentinelas)
node verify_fixes.js --live
```

**Criterio de éxito**: Todos los tests PASS.

---

## Paso 6: Test funcional en staging

### 6.1 Facturas
1. Abrir la app → Facturas
2. Buscar cliente "MARTIN MORALES" (30784)
3. **Verificar**: No aparece "A-999999" ni documentos con importes -9999999 o -0
4. Abrir una factura normal → Ver PDF → **Verificar**: Se abre correctamente
5. Reabrir el mismo PDF → **Verificar**: Se abre sin error en segundo intento

### 6.2 Rutero/Entregas
1. Abrir la app como repartidor
2. Ir al rutero del día
3. **Verificar**: No hay entregas con importes de 999999€
4. Confirmar una entrega (ENTREGADO) con firma
5. **Verificar**: Aparece inmediatamente en histórico
6. Intentar confirmar la misma entrega de nuevo → **Verificar**: Mensaje "ya confirmada"

### 6.3 PDF de factura F-14678
1. Buscar factura F-14678
2. **Verificar**: Total sin IVA = 416,73€, Total con IVA = 454,77€
3. **Verificar**: NO aparece "Pendiente" ni "Entregado" en el PDF
4. **Verificar**: NO aparece 9.013,64€ ni 16.539,32€ en el PDF

---

## Paso 7: Rollback (si necesario)

```bash
# Opción A: Desde backups automáticos
cp ../backups/services_facturas.service.js.bak ../../services/facturas.service.js
cp ../backups/services_pdf.service.js.bak ../../services/pdf.service.js
cp ../backups/app_services_pdfService.js.bak ../../app/services/pdfService.js
cp ../backups/routes_entregas.js.bak ../../routes/entregas.js

# Opción B: Desde backups manuales
cp ../backups/manual/* ../../services/ 2>/dev/null
# (restaurar cada archivo a su ubicación original)

# Opción C: Git
git checkout -- services/facturas.service.js services/pdf.service.js app/services/pdfService.js routes/entregas.js
```

---

## Paso 8: Re-scan post-fix

```bash
# Confirmar que las anomalías de código están resueltas
node scan_anomalies.js --dry-run

# Los registros en BD siguen existiendo (no se modifican datos)
# pero ahora están filtrados por el código
```

---

## Notas importantes

1. **Los scripts NO modifican datos en la BD** (DSEDAC es ERP-managed). Solo modifican código backend.
2. **El scan es solo lectura** — se puede ejecutar en cualquier momento sin riesgo.
3. **Todos los patches son reversibles** — backups automáticos + git.
4. **Los fixes son genéricos** — no hardcodean cliente 30784. Cualquier cliente con los mismos patrones se beneficia.
5. **El campo "Pendiente/Entregado" NO se renderiza en el PDF** — el hallazgo F-004 requiere investigación en Flutter.
6. **SQL injection** flaggeado pero fuera del scope de esta auditoría.

---

## Estructura de archivos generados

```
backend/audit/
├── report.json              # Informe de hallazgos
├── anomalies.csv            # Registros anómalos (generado por scan)
├── migration_audit.json     # Log de cambios aplicados
├── runbook.md               # Este documento
├── fix_proposals.diff       # Diff de todos los cambios propuestos
├── scripts/
│   ├── scan_anomalies.js    # Escaneo de BD (--dry-run / --limit)
│   ├── fix_anomalies.js     # Aplicación de patches (--dry-run / --apply)
│   └── verify_fixes.js      # Verificación automatizada (--live)
└── backups/                 # Backups automáticos (creado por --apply)
```
