---
name: regression-safety-checks
description: Cross-module dependency analysis + smoke test design. Run before merging changes that touch shared code (providers, endpoints, DB tables, components).
---

# Skill: regression-safety-checks

Procedimiento sistemático para detectar y prevenir regresiones entre módulos.

## Cuándo aplicar (mandatorio)

- Cambio en provider usado en >2 pantallas
- Cambio en endpoint API consumido por >1 cliente
- Cambio en schema DB
- Cambio en widget/componente reutilizado
- Cambio en middleware (auth, logging, error handling)
- Cambio en theme/AppColors
- Refactor de servicio backend compartido
- Migración entre versiones de framework

## Cuándo NO necesitas (opcional)

- Cambio aislado en archivo sin imports externos
- Bugfix con test directo del happy path + edge case
- Cambio puramente cosmético en pantalla específica
- Documentación

## Procedimiento

### Paso 1: Mapeo de dependencias

```bash
# Backend Node — encuentra qué endpoints usan una función
grep -r "pedidos.service" backend/routes/ backend/services/

# Backend Node — encuentra qué módulos importan
grep -r "require.*facturas" backend/

# Flutter — encuentra usos de un provider
grep -r "pedidosProvider" lib/

# Flutter — encuentra usos de un widget
grep -r "OrderStatusBadge" lib/

# Next.js — encuentra usos de un componente
grep -rn "import.*ClienteForm" frontend/

# DB — qué endpoints usan una tabla
grep -r "JAVIER.PEDIDOS\|FROM PEDIDOS" backend/
```

### Paso 2: Inventario de impacto

Output formato:
```markdown
## Cambio: [descripción 1 línea]

### Archivos modificados
- [path 1]
- [path 2]

### Importado / consumido por
| Archivo | Tipo de uso | Riesgo |
|---|---|---|
| dashboard_page.dart | Llama getKPIs() | Medium |
| comisiones_page.dart | Lee provider | High |
| backend/routes/dashboard.js | GET endpoint | Low |

### Módulos afectados
1. **Dashboard** (riesgo: alto) — KPI calculation puede cambiar
2. **Comisiones** (riesgo: medium) — Recalcula con nuevo formato
3. **Repartidor** (riesgo: bajo) — solo lectura de campo X
```

### Paso 3: Smoke test plan

Para cada módulo afectado riesgo MEDIUM/HIGH:

```markdown
## Smoke test: [nombre modulo]

### Setup
[Datos de prueba — vendedor V001, cliente C001, fecha 2026-04-15]

### Steps
1. Login como JEFE_VENTAS
2. Navegar a [pantalla]
3. Verificar [valor esperado]

### Acceptance criteria
- KPI total facturas mes muestra: 1.234,56€ (matches baseline pre-cambio)
- Sin errores en consola
- Tiempo respuesta <500ms
```

### Paso 4: Ejecución

- Tests unitarios: `cd backend && npx jest --testPathPattern=<modulo>`
- Widget tests: `flutter test test/widgets/<modulo>_test.dart`
- Integration tests: smoke test scripts
- Manual smoke (si automated no cubre): @qa-engineer asignado

### Paso 5: Antes de aprobar merge

- [ ] Tests automated pasan
- [ ] Smoke tests manuales pasan en módulos afectados
- [ ] @code-reviewer aprueba (puede pedir más tests)
- [ ] Si HIGH risk: @staff-engineer hace second review

### Paso 6: Post-deploy verification

Si el cambio llega a prod:
- Monitor logs/metrics módulos afectados primeras 24h
- Si Sentry/error rate aumenta en módulo X → rollback inmediato
- @regression-detector + @sre-specialist colaboran

## Tablas de impacto típicas (gmp_app_mobilidad)

### Si cambias `pedidos.service.js`
| Módulo afectado | Cómo lo usa |
|---|---|
| dashboard | KPI total / promedio pedidos |
| repartidor | Lista pedidos pendientes entrega |
| comisiones | Calcula comisión por pedido |
| facturas | Asocia factura a pedido origen |

### Si cambias `JAVIER.RUTERO_CONFIG`
| Módulo | Uso |
|---|---|
| repartidor | Orden de visitas del día |
| reports | Histórico rutas |
| jefe-ventas | Visualización rutas equipo |

### Si cambias `pedidosProvider` (Riverpod)
| Pantalla | Uso |
|---|---|
| pedidos_page | Lista principal |
| repartidor_rutero_page | Pedidos por ruta |
| dashboard | KPIs |
| kpi_page | Métricas detalladas |

### Si cambias `main_shell.dart`
| Tab | Páginas afectadas |
|---|---|
| Pedidos, Facturas, Clientes, Comisiones, Repartidor, KPI, Más |
**Regla absoluta**: actualizar AMBOS `_getNavItems` Y `_buildCurrentPage`.

## Tabla impacto granja_mari_pepa

### Si cambias `app/layout.tsx`
- TODAS las páginas heredan layout
- Side effect: cualquier provider/context global

### Si cambias componente compartido `frontend/components/ui/*`
- shadcn/ui base: cambia donde se use el componente
- Verificar con `grep -rn "import.*<Component>" frontend/app/`

### Si cambias Server Action compartida
- Páginas que la invocan via `<form action={X}>`
- Componentes que la importan directamente

## Anti-patterns

- "Solo es un campo opcional, no rompe nada" → SI rompe si lo lee deserializer estricto
- "Nadie usa esto" → grep antes, no asumas
- "Test de mi módulo verde" → puede fallar smoke en otro
- "Lo mergeo y vemos en prod" → NO. Smoke test PRE-merge.
- Cambio breaking sin major version bump
- Cambio de tipo en API sin coordinar con consumer

## Cierre

Antes de mergear, el output del @regression-detector debe estar:
- ✓ Adjunto al PR
- ✓ Tests propuestos ejecutados
- ✓ Sin findings HIGH sin resolver

Sin esto, @code-reviewer NO aprueba (regla del equipo).
