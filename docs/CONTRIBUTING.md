# Contribuir a GMP App Movilidad

Monorepo con dos unidades desplegables: app Flutter (`lib/`) y API Express (`backend/`). Reglas de repo: [ADR 0001](docs/adr/0001-monorepo-dos-unidades-desplegables.md). Setup: [README](README.md).

## TL;DR para el primer commit

```bash
npm install                                   # hooks (husky/commitlint/lint-staged)
git checkout -b feat/mi-cambio
# ...cambios...
git add -A
git commit -m "feat(rutero): pagina detalle con estados offline"   # Conventional Commits, obligatorio
```

Si el hook `commit-msg` rechaza tu mensaje: no uses `--no-verify`; corrige el formato.

## Ramas

| Rama | Uso |
|---|---|
| `main` | release; protegida |
| `test` | integración/staging; destino habitual de merges |
| `feat/*`, `fix/*`, `refactor/*`, `docs/*`, `chore/*` | trabajo diario |

## Conventional Commits (obligatorio)

Tipos cerrados: `feat | fix | docs | style | refactor | test | chore | perf | ci | revert`.

```
<tipo>(<scope>): <descripción en presente, sin punto final>

[cuerpo opcional: por qué, no qué]
[footer: refs de issue/task]
```

Scopes sugeridos por módulo real: `rutero`, `cobros`, `reparto`, `pedidos`, `clientes`, `auth`, `api`, `db2`, `ui`, `deps`, `repo`. Ejemplos:

- `fix(cobros): deduplicar CPC con ROW_NUMBER antes de sumar importes`
- `perf(api): cachear dashboard metrics en Redis con TTL 60s`
- `docs(adr): registrar decision ODBC frente a JT400`

## Política de tamaño de PR/commit — "small CLs"

Estilo guía de revisión de Google adaptado: **un PR = un cambio = una responsabilidad**.

1. **Revisable en minutos, no en horas.** Objetivo < ~400 líneas de diff neto; si pasa de eso casi siempre son dos cambios disfrazados.
2. **Un PR no mezcla** feature nueva + refactor masivo + cambio cosmético. Sepáralos en PRs encadenados.
3. **Refactors puros**: cero cambios de comportamiento, commits `refactor:` aislados, tests existentes deben seguir verdes sin tocarlos.
4. **Commits atómicos**: cada commit compila y deja el repo en estado coherente (tests rápidos OK).
5. **Cambios generados** (codegen `*.g.dart`, locks): commítalos en el mismo PR que los genera, nunca sueltos.
6. Si algo es demasiado grande para partirlo: documéntalo en la descripción del PR con plan de review por partes.
7. Descripción del PR obligatoria: qué cambia, por qué, cómo se probó, riesgos y rollback.

## Gates locales (hooks git)

| Hook | Qué hace | Tiempo objetivo |
|---|---|---|
| `pre-commit` | gitleaks sobre staged + `dart format --set-exit-if-changed` + `node --check` solo en staged | <10 s |
| `commit-msg` | commitlint (Conventional Commits) | <2 s |
| `pre-push` | whitespace errors; la suite pesada la corre CI (`ci-cd.yml`) | <10 s |

Prerequisito: `npm install` en la raíz tras clonar (instala husky/commitlint/lint-staged).

## Tests obligatorios según el cambio

| Cambio | Test mínimo |
|---|---|
| Endpoint API | test de contrato (`__tests__/*_contracts.test.js`) + idempotencia si escribe |
| Query DB2 nueva | verificación QSYS2 previa ([ADR 0004](docs/adr/0004-esquema-db2-dsedac-javier.md)) + audit read-only |
| Pantalla/widget Flutter | widget test + estados loading/empty/error/offline |
| Modelos/providers Dart | unit test + regenerar codegen |
| Escritura ERP / deploy | gates de producción — requiere aprobación explícita de Javier |

## Revisión

- Owner por defecto: @jlp717 (ver [`CODEOWNERS`](CODEOWNERS)). GitHub lo asigna automáticamente.
- El revisor puede pedir split del PR si viola la política de tamaño; no es subjetivo, es esta página.
- Decisiones de arquitectura que aparezcan durante el cambio → nuevo ADR en `docs/adr/` antes del merge.

## A quién preguntar

Dudas de setup/arquitectura: abre issue o pregunta directamente a @jlp717. Contexto de decisiones históricas: `docs/adr/`. Reglas del equipo de agentes OpenCode: `AGENTS.md`.
