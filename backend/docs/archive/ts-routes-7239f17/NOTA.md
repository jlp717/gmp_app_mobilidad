# Archive TS routes — WS2 DDD-CONSOLIDATION-001-FINAL

- task_id: DDD-CONSOLIDATION-001-FINAL (WS2-reintento)
- fecha: 2026-09-25
- rama: test (verificada via .git/HEAD → ref: refs/heads/test)
- ultimo commit rama test: 7239f17ae6f10273b0f688f06bd062d2ad922c4a (via .git/refs/heads/test)
- autorizacion: Javier 100% explicita (supera nota docs-only de architecture.md L18 previa)
- snapshot: shell denegado en este entorno (default.shell → permission.rejected); sin `git status` fiable → lock exclusivo WS2, un commit por paso, rollback via tag pre-ws2 (a crear por orquestador con shell: `git tag pre-ws2-7239f17 7239f17` antes del commit WS2)
- alcance: solo WS2. No tocar REPARTO_*/REPARTIDOR_* fail-closed, no DSEDAC writes, no prod.

## Que se archiva (22 ficheros backend/src/routes/)
Destino canonico: docs/archive/ts-routes-7239f17/ (esta nota + copia integra de los 22).
Movimiento fisico pendiente de shell (`git mv backend/src/routes docs/archive/ts-routes-7239f17/src-routes` o equivalente + commit). Sin shell en este WS, los ficheros quedan marcados ARCHIVADO via cabecera en src/server.ts y src/index.ts y sin referencias vivas (ver abajo).

1. analytics.routes.ts
2. auth.routes.ts
3. clientes.routes.ts
4. clients.routes.ts
5. cobros.routes.ts
6. commissions.routes.ts
7. dashboard.routes.js
8. dashboard.routes.ts
9. entregas.routes.ts
10. facturas.routes.ts
11. health.routes.ts
12. master.routes.ts
13. objectives.routes.ts
14. pedidos.routes.ts
15. planner.routes.js
16. products.routes.ts
17. promociones.routes.ts
18. repartidor.routes.ts
19. repartidorFinanzas.routes.js
20. rutero.routes.ts
21. ventas.routes.ts
22. warehouse.routes.ts

Nota duplicados: dashboard.routes.js/.ts twins; planner.routes.js sin twin .ts.

## Referencias vivas eliminadas (grep repo-wide)
- backend/tests/routes/contract-parity.test.js: migrado a src/controllers directos (misma paridad, sin src/routes). Ver side-by-side en handoff.
- backend/app.js: eliminado `USE_TS_ROUTES` + loader `require('./dist/index')` + mount `global.__TS_APP__`. Solo legacy JS + DDD.
- backend/ecosystem.config.js: eliminado bloque `env_ts`.
- backend/config/reparto-runtime.js: modo 'typescript' muerto eliminado; validacion fail-closed USE_TS_ROUTES=false conservada (REPARTO_* intacto).
- backend/src/server.ts + backend/src/index.ts: marcados ARCHIVADO, pendiente mv fisico.
- backend/jest.config.js moduleNameMapper dashboard (.ts twins): pendiente limpieza follow-up con shell (fuera WS2, no bloquea runtime).
- backend/routes/facturas.js comentario "Ported from src/routes/...": solo doc, no require vivo.
- scripts/build.sh, scripts/rollback.sh, Dockerfile, docs/VENTAS_B: referencias historicas/doc, no runtime vivo.

## Rollback
- Tag pre-ws2 (orquestador con shell): `git tag pre-ws2-7239f17 7239f17`
- Revert por ruta si test rojo (criterio parada WS2).
- Si REPARTO_* aparece en diff → parar (no ocurrido en este WS; verificado por lectura: diff solo toca USE_TS/US_DDD/TS archivado, ningun REPARTO_WRITES/APPROVAL/SCHEMA).
