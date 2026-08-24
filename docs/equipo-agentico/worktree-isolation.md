# Worktree Isolation — GMP v5.0 Pilar 6

> Cada worktree = rama + directorio aislado compartiendo .git. Aislamiento de archivos solo es mitad del trabajo.

## Regla
- 1 worktree por capa: `feat/api-deuda` vs `feat/ui-rutero` vs `fix/tests-rojos`. Nunca 2 agentes misma capa.
- Cada worktree usa su propio puerto y DB branch.
- DB: `ODBC_DSN=GMP` apunta a schema `JAVIER`. Para trabajo paralelo con writes, usar `JAVIER_TMP_<worktree>` y `SYSCOPY` o `CREATE TABLE ... AS SELECT` temporal. Ver `lib/provider-health-store.ts` para health.
- Puertos: principal `3335`, worktrees `3336/3337/3338`. Ver `.opencode/config/runtime-health.yaml`.
- PM2: `pm2 start backend/server.js --name gmp-api-<worktree>` con `PORT` distinto. Nunca `pm2 save` sin Javier.

## Comandos
```bash
git worktree add ../gmp_app_mobilidad_worktrees/feat-x -b feat/x
git worktree list
git worktree remove ../gmp_app_mobilidad_worktrees/feat-x
```

## Verificación
- `git worktree list` debe mostrar 1-3 activos max.
- `lsof -i :3335,3336` sin colisión antes de `pm2 restart`.

Ref: Zylos 2026, MindStudio parallel agents.
