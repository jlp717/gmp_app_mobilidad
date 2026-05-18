# 📚 Archivo de Documentación Histórica

Este directorio contiene documentación histórica y scripts de referencia que han sido preservados para consulta futura, pero que no forman parte del código base activo.

## Estructura del Archivo

```
docs/archive/
├── security/           # Documentación de auditorías y seguridad
├── architecture/       # Decisiones de arquitectura e implementaciones
├── performance/        # Reportes de optimización y benchmarks
├── changelogs/         # Historial de versiones
├── audits/             # Scripts y reportes de auditoría de datos
└── README.md           # Este archivo
```

## Contenido por Categoría

### 🔒 Security (`/security/`)

| Archivo | Descripción |
|---------|-------------|
| `SECURITY_REPORT.md` | Auditoría completa de seguridad con 35 vulnerabilidades documentadas, matriz de cumplimiento OWASP |
| `SECURITY_IMPLEMENTATION.md` | Guía paso a paso de implementación de seguridad con procedimientos de rollback |
| `SECURITY_OVERHAUL_SUMMARY.md` | Resumen del overhaul de seguridad |

### 🏗️ Architecture (`/architecture/`)

| Archivo | Descripción |
|---------|-------------|
| `IMPLEMENTATION_SUMMARY.md` | Documentación de la implementación de AgentDB/V3 Memory Unification (3,420 líneas) |
| `AGENTDB_README.md` | Guía de uso de AgentDB |
| `V3_ARCHITECTURE_DIAGRAM.md` | Diagramas de arquitectura V3 |
| `V3_OPTIMIZATION_SUMMARY.md` | Resumen de optimizaciones V3 |
| `V3_PERFORMANCE_INDEX.md` | Índice de performance V3 |
| `MIGRATION_STATUS.md` | Estado de migraciones completadas |

### ⚡ Performance (`/performance/`)

| Archivo | Descripción |
|---------|-------------|
| `PERFORMANCE_OPTIMIZATION_REPORT.md` | Reporte completo de optimización con benchmarks antes/después |

### 📝 Changelogs (`/changelogs/`)

| Archivo | Descripción |
|---------|-------------|
| `CHANGELOG.md` | Historial de versiones del proyecto |

### 🔍 Audits (`/audits/`)

| Archivo | Descripción |
|---------|-------------|
| `report.json` | Hallazgos de auditoría estructurados |
| `runbook.md` | Procedimientos operacionales de auditoría |
| `anomalies.csv` | Anomalías de datos detectadas |
| `fix_proposals.diff` | Propuestas de corrección |
| `scripts/` | Scripts de auditoría (scan, fix, verify) |

### 🧪 Validation Scripts (`/backend/scripts/validation/`)

| Archivo | Descripción |
|---------|-------------|
| `validate_invoice_amounts.js` | Validación masiva de importes de facturas (100+ registros) |
| `analyze_factura_219.js` | Análisis profundo de factura específica para debugging de discrepancias |

## ¿Cuándo Usar Este Archivo?

Estos documentos son útiles para:

1. **Investigación de bugs**: Si un bug resurge, los scripts de validación pueden ayudar a verificar el fix
2. **Auditorías de cumplimiento**: Los reportes de seguridad y auditoría documentan el estado del sistema en puntos específicos
3. **Referencia arquitectónica**: Las decisiones de arquitectura documentan el "por qué" detrás del código
4. **Benchmarks de performance**: Los reportes de optimización proporcionan línea base para testing de regresión

## Política de Archivo

Los archivos se mueven a este directorio cuando:

- ✅ Son documentación histórica valiosa pero no activa
- ✅ Scripts de debugging/validación que pueden ser útiles para referencia futura
- ✅ Reportes de auditoría que documentan el estado del sistema en un punto temporal
- ✅ Decisiones arquitectónicas que explican el razonamiento detrás del código

Los archivos **NO** se archivan, se eliminan directamente cuando:

- ❌ Son outputs temporales de comandos (`*_out.txt`)
- ❌ Screenshots de debugging
- ❌ Scripts de exploración de una sola vez (`debug_*.js`, `explore_*.js`)
- ❌ Datos volcados de la base de datos (`.json` dumps)

---

**Fecha de creación del archivo**: 2026-04-01  
**Motivo**: Limpieza masiva de 491 archivos (~68,000 líneas) de artifacts temporales
