---
name: audit
description: Auditoría 360°: estructura, dependencias, cobertura, deuda técnica.
---

# Skill: audit — Auditoría 360°

Produce un análisis exhaustivo del estado del proyecto en 6 dimensiones. Prioriza hallazgos por impacto.

## Proceso de Auditoría

### 1. Estructura del Proyecto
- [ ] Verificar separación de responsabilidades (UI/Logic/Data)
- [ ] Detectar archivos demasiado grandes (> 300 líneas)
- [ ] Identificar código muerto (funciones no llamadas, imports no usados)
- [ ] Revisar convenciones de nombres (consistencia camelCase, PascalCase, snake_case)
- [ ] Mapear dependencias circulares entre módulos

### 2. Dependencias
- [ ] `npm audit` / `flutter pub outdated` — CVEs críticos y altos
- [ ] Dependencias desactualizadas (> 1 major version behind)
- [ ] Dependencias no utilizadas (`depcheck` / `dart pub deps`)
- [ ] Licencias incompatibles con el proyecto
- [ ] Dependencias duplicadas con propósito similar

### 3. Cobertura de Tests
- [ ] `npm test -- --coverage` / `flutter test --coverage`
- [ ] Cobertura por capa: lógica de negocio debe ser ≥ 80%
- [ ] Rutas críticas sin test (auth, pagos, datos sensibles)
- [ ] Tests frágiles (dependen de orden, timeouts reales, datos hardcodeados)
- [ ] Ausencia de tests E2E para flujos principales

### 4. Deuda Técnica
- [ ] TODOs y FIXMEs en el código (cuantificar)
- [ ] Código comentado (eliminar o explicar)
- [ ] Funciones > 50 líneas (candidatas a extracción)
- [ ] Duplicación de lógica (DRY violations)
- [ ] Patrones deprecados (Provider legacy en Flutter, Pages Router en Next.js)

### 5. Consistencia
- [ ] Eslint/flutter analyze sin warnings
- [ ] Prettier/dartfmt aplicado
- [ ] Tipos TypeScript/Dart explícitos (zero `any`/`dynamic` injustificados)
- [ ] Error handling consistente en toda la app
- [ ] Logging coherente (no mix de console.log + logger)

### 6. Documentación
- [ ] README con quickstart funcional
- [ ] Variables de entorno documentadas (.env.example actualizado)
- [ ] APIs documentadas (JSDoc / DartDoc / OpenAPI)
- [ ] CHANGELOG actualizado
- [ ] ADRs para decisiones arquitectónicas importantes

## Formato de Hallazgos
```
## Auditoría 360°: [proyecto] — [fecha]

### Resumen Ejecutivo
| Dimensión | Estado | Hallazgos |
|-----------|--------|-----------|
| Estructura | 🟡 Mejorable | 3 archivos > 300L |
| Dependencias | 🔴 Crítico | 2 CVEs altos |
| Tests | 🟡 Mejorable | 62% cobertura |
| Deuda Técnica | 🟡 Mejorable | 47 TODOs |
| Consistencia | 🟢 OK | 0 lint errors |
| Documentación | 🔴 Deficiente | README desactualizado |

### Hallazgos Priorizados
#### CRÍTICO
1. [hallazgo] — [archivo:línea] — Acción: [qué hacer]

#### ALTO
...

### Plan de Mejora Sugerido
1. [acción corta plazo] → @agente
2. [acción medio plazo] → @agente
```

## Notas por Proyecto
- **granja_mari_pepa**: NO auditar `backend/` sin autorización. Solo frontend + config.
- **gmp_app_mobilidad**: `rutero_detail_modal.dart` (3517L) es deuda técnica conocida — documentar, no bloquear.
