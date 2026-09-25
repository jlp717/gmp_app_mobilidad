# Rescue + runbook manual — 2026-09-25

> SNAPSHOT 2026-09-25: HEAD=`test` (`7239f17`), `origin/test`=`7239f17`, `origin/main`=`d0d471d`. Este doc no ejecuta nada destructivo.
> LOCK (denylist): **`main`, `test`, `PR#42`**. Prohibido: push --delete sobre denylist, cherry-pick a test, force-push, rewrite.

## STOP global

Parar ante cualquier intento de push/delete automatizado. Ante duda → NEEDS RESCUE. PRs DESCONOCIDOS (API 403) → verificar con `gh` antes de borrar.

## Reporte NEEDS RESCUE (4)

### 1. origin/codex/professionalization-implementation-20260918 (14 únicos vs test)

Commits: fdd6f8c, a7d1696, 4e81681, 59ad12a, 448aaaa, 6861581, 3509186, 01f2211, d156d56, 635e448, 34a00e4, 88d9931, f1b6f55, 145859a.
Qué hacen: CI fixtures aislados, lint reproducible, OpenAPI reconciliado, contratos cache/telemetría, recovery receipt cerrado, clock determinista, foundations calidad.
Recomendación: rescate vía BUILD con spec + PR a test (jest + flutter analyze verdes). NO cherry-pick directo.
STOP: sin spec aprobada no hay port.

### 2. origin/codex/professionalization-plan-20260918 (1 único)

Commit: 6cb77ba docs(audit): executable professionalization plan.
Recomendación: portar doc a `docs/audits/` vía PR docs-only. Trivial, sin código.

### 3. origin/fix/kpi-schema-interpolation (51 ahead, rama mayo divergente)

Top útil: 27ce951 fix SCHEMA en safeCreateIndex; deac560 ETL catch-up al arranque scheduler. Resto (~49) historia mayo ya superada por test (558 behind).
Recomendación: extraer SOLO top 2 como patch con tests nuevos; resto NO se rescata.
STOP: si el diff top vs test ya está cubierto → cerrar como absorbida.

### 4. origin/pre-new-logic (15 únicos)

Commits clave: c880fde (meses futuros PRE), 8030331, c4d654a, 18bbff6, 5260569, d721d2e, b0b8632, 5b1d278, 022ef13, b0cfbf2, d06c74e, f22648a (+2 merges base).
Qué hacen: VENDOR_COLUMN date-aware, puerto PRE 3002, túnel Cloudflare PRE, aislamiento entorno PRE.
Recomendación: coordinar con dueño entorno PRE; no borrar hasta migrar lógica o confirmar obsoleta.

## Bloque PowerShell manual (copy-paste, 11 SAFE, uno por uno)

```powershell
cd C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad
git fetch origin
git ls-remote origin | Select-String -SimpleMatch heads | Measure-Object -Line
$SAFE = @(
  origin/codex/repartidor-preserve-2026-08-10,
  origin/cursor/fix-github-actions-d9cf,
  origin/feat/load-planner-v2,
  origin/feature/backend-modularization,
  origin/feature/final-optimizations,
  origin/fix/orchestrator-delegation-pipeline,
  origin/master,
  origin/optimization-phase-1,
  origin/original-working-version,
  origin/regression-blockers-tests-20260613,
  origin/security-sql-parameterization
)
foreach ($b in $SAFE) { Write-Output(\"===== $b =====\"); gh pr list --head \"$b\"; git log --oneline origin/test..$b | Select-Object -First 10; git log --oneline origin/main..$b | Select-Object -First 10 }
```

Borrar SOLO si: `gh pr list` vacío o PR mergeado/closed, y `git log origin/test..` vacío o trivial ya absorbido. Si muestra valor → NEEDS RESCUE, no borrar.

```powershell
git push origin --delete codex/repartidor-preserve-2026-08-10
git rev-parse origin/main origin/test
git push origin --delete cursor/fix-github-actions-d9cf
git rev-parse origin/main origin/test
git push origin --delete feat/load-planner-v2
git rev-parse origin/main origin/test
git push origin --delete feature/backend-modularization
git rev-parse origin/main origin/test
git push origin --delete feature/final-optimizations
git rev-parse origin/main origin/test
git push origin --delete fix/orchestrator-delegation-pipeline
git rev-parse origin/main origin/test
git push origin --delete master
git rev-parse origin/main origin/test
git push origin --delete optimization-phase-1
git rev-parse origin/main origin/test
git push origin --delete original-working-version
git rev-parse origin/main origin/test
git push origin --delete regression-blockers-tests-20260613
git rev-parse origin/main origin/test
git push origin --delete security-sql-parameterization
git rev-parse origin/main origin/test
git ls-remote origin
```

Esperado tras cada delete: `origin/main` = d0d471d, `origin/test` = 7239f17. Si cambian → STOP inmediato.

## Checklist post-manual

- [ ] 11 SAFE borradas en remoto (`git ls-remote` ya no las lista)
- [ ] `origin/main` = d0d471d y `origin/test` = 7239f17 intactos
- [ ] PR#42 intacto (verificado con `gh pr view 42`)
- [ ] 4 NEEDS RESCUE intactas en remoto
- [ ] packed-refs stale anotado (se regenera solo con fetch/gc; no editar a mano)
- [ ] Gate en ledger: `gate_set(branch_hygiene_manual, PASS, evidence=...)`
- [ ] Dirs huérfanos feat//feature/ re-verificados tras limpieza
