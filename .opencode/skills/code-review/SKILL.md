---
name: code-review
description: Revisión exhaustiva: seguridad OWASP, rendimiento, SOLID/DRY/KISS. Solo reporta.
---

# Skill: code-review — Revisión Exhaustiva de Código

Protocolo de revisión para @code-reviewer. READ ONLY. Produce informe estructurado con severidad y fixes concretos.

## Proceso de Revisión

### Fase 1: Contexto (antes de revisar)
- [ ] Leer el AGENTS.md del proyecto (reglas críticas)
- [ ] Identificar qué cambios se hicieron (git diff)
- [ ] Entender el propósito del código

### Fase 2: Seguridad (OWASP Top 10)
- [ ] **A01**: ¿Todas las rutas protegidas verifican auth? ¿Roles?
- [ ] **A02**: ¿Passwords con bcrypt? ¿Datos sensibles cifrados en BD?
- [ ] **A03**: ¿Queries parametrizadas? ¿Inputs sanitizados? ¿XSS?
- [ ] **A04**: ¿Rate limiting? ¿Límites en uploads?
- [ ] **A05**: ¿Headers HTTP seguros? ¿CORS restrictivo?
- [ ] **A06**: `npm audit` / `flutter pub outdated` — CVEs?
- [ ] **A07**: ¿JWT validado correctamente? ¿Logout invalida token?
- [ ] **Secrets**: ¿Hay API keys, passwords o tokens hardcodeados?

### Fase 3: Rendimiento
- [ ] **N+1 queries**: ¿hay loops con DB queries dentro?
- [ ] **Bundle size**: ¿imports pesados sin lazy loading?
- [ ] **Re-renders**: ¿useEffect con deps incorrectas? ¿missing useMemo?
- [ ] **Flutter rebuilds**: ¿widgets reconstruyéndose innecesariamente?
- [ ] **Memory leaks**: ¿event listeners sin cleanup? ¿timers sin cancel?
- [ ] **Imágenes**: ¿optimizadas con next/image? ¿lazy loading?

### Fase 4: Calidad SOLID/DRY/KISS
- [ ] **S (SRP)**: ¿cada clase/función tiene una sola responsabilidad?
- [ ] **O (OCP)**: ¿extensible sin modificar código existente?
- [ ] **DRY**: ¿lógica duplicada que podría extraerse?
- [ ] **KISS**: ¿la implementación es más compleja de lo necesario?
- [ ] Funciones > 30 líneas → candidatas a extracción
- [ ] Zero `any` (TS) / `dynamic` (Dart) sin justificación

### Fase 5: Tests
- [ ] ¿El nuevo código tiene tests?
- [ ] ¿Los tests cubren happy path + error cases?
- [ ] ¿Hay tests E2E para flujos críticos?
- [ ] Cobertura de lógica de negocio ≥ 80%

## Formato de Reporte (Obligatorio)

```markdown
## Code Review: [feature/archivo/PR]
**Fecha**: [fecha]
**Revisado por**: @code-reviewer
**Veredicto**: 🔴 RECHAZADO / 🟡 NECESITA CAMBIOS / 🟢 APROBADO

---

### 🔴 CRITICAL — Bloquea merge
**[archivo.ts:42]** — Injection SQL
> El parámetro `userId` se concatena directamente en la query
```typescript
// Actual (vulnerable):
db.query(`SELECT * FROM users WHERE id = ${userId}`);
// Fix:
db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

### 🟠 HIGH — Resolver antes de producción
...

### 🟡 MEDIUM — Resolver en siguiente iteración
...

### 🟢 LOW / INFO
...

### Cobertura de Tests
- Cobertura actual: X%
- Lógica de negocio: Y%
- Flujos sin cubrir: [lista]
```

## Reglas por Proyecto
- **granja_mari_pepa**: NO revisar `backend/` (fuera de scope del agente de frontend)
- **gmp_app_mobilidad**: Especial atención a queries DB2 (parametrización siempre)
- Ambos proyectos: `.env` con credenciales reales → ALERT INMEDIATO a @security-sentinel
