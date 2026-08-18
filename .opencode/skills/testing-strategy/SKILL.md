---
name: testing-strategy
description: Test strategy: pyramid, contract tests, golden master, mutation testing, test data builders, fixtures.
---

# Skill: testing-strategy — Estrategia de Tests

Marco mental para decidir QUE testear, COMO testear y DONDE poner el test. Aplica a todos los stacks (Flutter, Node, Next.js, Python).

## Test pyramid moderna

```
       /\
      /  \   E2E (5-10%)        — flujos criticos completos
     /----\
    /      \  Integration (20-30%) — modulos juntos, DB real, mocks de externos
   /--------\
  /          \ Unit (60-70%)      — funciones puras, logica negocio aislada
 /____________\
```

Inverted pyramid (UI tests >>> unit) es el antipattern mas comun. Lento, caro, fragil.

## Decision tree: que test escribir

| Codigo | Test recomendado |
|---|---|
| Funcion pura (calculo, transformacion) | Unit test, parametrizado, table-driven |
| Logica con DB | Integration test contra DB real (testcontainers / migration) |
| Endpoint HTTP | Integration test con supertest / similar, NO mockear el HTTP layer entero |
| UI Widget Flutter | Widget test con `tester.pumpWidget` |
| Flow E2E (login → checkout) | Playwright / Cypress / Patrol |
| Cron job / Background worker | Integration con tiempo simulado (`fake_async`) |
| Codigo legacy sin tests | Characterization tests (snapshot del comportamiento) ANTES de tocar |

## Test data builders > fixtures dispersas

```typescript
// MAL: fixture estatica
const user = { id: 1, name: 'Test', email: 'test@test.com', role: 'admin' };

// BIEN: builder con defaults + overrides
function aUser(overrides?: Partial<User>): User {
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    role: 'comercial',
    ...overrides,
  };
}

const repartidor = aUser({ role: 'repartidor' });
```

## Contract tests (microservicios)

Cuando service A consume service B:
- A escribe contract (que espera de B)
- Pact / similar verifica que B cumple el contract
- B sabe el dia 1 si rompe a A

Mejor que E2E cross-service que son pesadisimos.

## Golden master / Snapshot tests

Para refactor de codigo legacy sin tests:
1. Captura output actual contra muchos inputs
2. Refactor
3. Outputs deben matchear (con tolerancia controlada para floats/timestamps)

```typescript
test.each([
  { input: { vendedor: 'V001', mes: '2026-04' }, name: 'commission V001 abril' },
  { input: { vendedor: 'ALL', mes: '2026-04' }, name: 'commission ALL abril' },
])('$name', ({ input }) => {
  expect(calculateCommissions(input)).toMatchSnapshot();
});
```

## Mutation testing

Mide CALIDAD de tus tests, no cobertura. Stryker / pitest:
- Modifica codigo (mutaciones)
- Ejecuta tests
- Si tests pasan con mutacion → tests son debiles
- Si tests fallan → tests son robustos

Apunta >70% mutation score en codigo critico.

## Cobertura — metrica con ojo critico

- Coverage 80% nice metric, NO objetivo final
- 100% coverage SIN buenas asserciones = inutil
- Coverage por archivo NUNCA mas exigente que la media (gateway antipattern)

```yaml
# Configuracion realista
coverage:
  global: 70%        # branch coverage
  delta: 80%         # nuevo codigo en PR
  exclude: [migrations/, generated/, *.config.ts]
```

## Reglas project-specific

### gmp_app_mobilidad (Flutter + Node)
- Backend: 76 tests Jest existentes (mantener verde)
- Flutter: widget tests existentes + 11 navigation tests
- Para repartidor: NO tocar `albaran_detail_page.dart` — la UI real es `rutero_detail_modal.dart`
- Comisiones logic: tabla de casos vendor='ALL' vs vendor='V001' criticos

### granja_mari_pepa (Next.js)
- Playwright para E2E
- Componentes con `@testing-library/react`
- API routes con supertest sobre Express server

## Restricciones
- NUNCA tests que dependen de orden de ejecucion
- NUNCA tests que usan time real sin mock
- NUNCA "if" en tests (es smell — si necesitas if, son 2 tests)
- NUNCA `setTimeout` para esperar (usar `await waitFor`)
- NUNCA mockear lo que estas testeando (mockear ADYACENTE, no el sujeto)
- NUNCA secrets reales en fixtures

## Checklist antes de mergear
- [ ] Tests pasan en CI (no solo en local)
- [ ] Coverage delta sobre nuevo codigo no baja
- [ ] No tests `.skip` o `.only` olvidados
- [ ] Tests deterministicos (no flaky)
- [ ] Si toca seguridad: tests de unauthorized + invalid input
