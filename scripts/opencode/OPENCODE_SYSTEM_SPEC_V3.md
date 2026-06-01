# OpenCode Multi-Agent System Spec v3

Fecha: 2026-05-31  
Proyectos: GMP Movilidad y Granja Mari Pepa  
Estado verificado: OpenCode READY para uso operativo en ambos proyectos, con servicios auxiliares ChromaDB/Redis/Docker en modo degradado hasta instalacion.

## 0. Verdad Operativa

No se puede garantizar "cero fallos" en un sistema que depende de modelos externos, red local, DB2, SSH, Cursor ACP, OpenCode Go, Telegram y Docker. Lo que si queda garantizado por diseno es:

- El sistema no debe inventar entidades: lee/verifica antes de escribir o consultar.
- Los fallos externos quedan visibles como warnings/degraded, no como exito simulado.
- El arranque y readiness son verificables con scripts reales.
- GMP y Granja cargan configuracion OpenCode, agentes, MCPs y reglas.
- GMP tiene probe real con 3 proveedores: OpenAI, Cursor ACP y OpenCode Go.

Verificador principal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\opencode\test-opencode-readiness.ps1 -Project all
```

Resultado verificado en 2026-05-31:

- READY global.
- GMP: 19 agentes, 9 plugins, 22 MCPs, 10 tools, 6 custom plugins, 330 entradas en manifiesto.
- Granja: 13 agentes, 3 plugins, 22 MCPs, DB2 MCP habilitado.
- Modelos: OpenAI 10, Cursor ACP 142, OpenCode Go 12.
- Perfil de calidad: orquestadores GMP/Granja en `openai/gpt-5.5`; agentes criticos en `openai/gpt-5.5` o `openai/gpt-5.5-pro`; OpenCode Go queda solo como fallback, no como agente activo.
- Warnings: ChromaDB, Redis y Docker no estan disponibles todavia en la maquina.

## 1. Arquitectura

### Componentes

- OpenCode: runtime principal de agentes, subagentes, comandos, tools, plugins y MCPs.
- StateGraph local: `.opencode/tools/state-manager.ts` persiste cada tarea en `.opencode/state/*.json`.
- Debate multi-agente: `debate-protocol.ts` coordina Check-Reviewer y Simplify-Reviewer.
- Routing heterogeneo: `.opencode/probe-results.json` decide Tier A/B/C a partir de modelos probados.
- Memoria: `.opencode/memory/*` + ChromaDB cuando este disponible + fallback por keywords.
- Seguridad: plugins `env-protection`, `anti-hallucination-guard`, `anti-doom-loop`, `rate-limit-handler`.
- Observabilidad: `.opencode/metrics-server.js`, `.opencode/metrics/current.prom`, Prometheus/Grafana via compose.
- Sandbox: `.opencode/tools/sandbox-run.ts` preparado para Docker, degradado si Docker no existe.
- Manifiesto de herramientas: `.opencode/memory/tools-manifest.json`.
- Comunicacion movil: Telegram mediante tool/script de notificacion.

### Tecnologias elegidas y justificacion

- OpenCode nativo en vez de un runtime externo LangGraph/CrewAI/AutoGen completo: evita duplicar orquestadores y usa el mecanismo oficial de agentes/subagentes de OpenCode.
- Patron LangGraph StateGraph implementado en TypeScript: persistencia local atomica, reanudacion y transiciones deterministas. No se habilita PostgreSQL para GMP/Granja porque las reglas del proyecto prohiben introducir PostgreSQL/Supabase. Si se quiere Postgres solo para orquestacion, debe aprobarse como servicio auxiliar aislado.
- CrewAI-style debate: implementado como protocolo determinista entre reviewers, no como dependencia Python externa.
- AutoGen-style heterogeneous agents: implementado por tiers de modelos y anti-echo-chamber.
- DSPy-style prompt optimization: implementado como ciclo de reflexion y versionado de prompts, no como runtime DSPy instalado.
- Letta/MemGPT-style memory: core memory + archival memory + external memory. ChromaDB es el vector store elegido por encajar con el mandato previo de no pgvector/Postgres.
- Redis 8: cache opcional para probes, schemas DB2 y rate limits. Si no esta, se usa fallback en memoria.
- ClickHouse: preparado como log analytics opcional en Docker Compose.
- Prometheus/Grafana: stack preparado para metricas reales.
- Docker: sandbox local reforzado cuando Docker Desktop exista. Daytona/e2b no estan configurados porque requieren cuenta/credenciales externas.
- DB2: unica base de datos de negocio para GMP y Granja.

## 2. Flujo Extremo A Extremo

Caso: "optimiza la consulta lenta de DB2 en el modulo de fichas tecnicas".

1. Telegram/OpenCode recibe el mensaje.
2. Orquestador extrae intencion: `optimize`, entidades: DB2, fichas tecnicas, consulta lenta, modulo afectado.
3. StateGraph crea task_id y estado `RECEIVE -> CLASSIFY`.
4. Context-Manager carga memoria, lessons, corrections, project-state y resultados ChromaDB si existe.
5. Tier se clasifica como Tier 3 porque toca DB2, rendimiento y posible backend/app.
6. Architect-Planner genera grafo: descubrir query, verificar tablas/columnas, medir baseline, EXPLAIN, proponer indices o rewrite, implementar, probar, revisar.
7. Se pide aprobacion si el plan implica cambios DB o deploy.
8. DB2-AS400-Specialist verifica tabla en `QSYS2.SYSTABLES` y columnas en `QSYS2.SYSCOLUMNS` antes de SQL.
9. Performance-Analyst mide baseline y plan de ejecucion.
10. Node-Express-Specialist o Flutter-Data-Specialist modifica solo archivos declarados.
11. Test-Writer crea/ajusta tests de contrato, unitarios o integracion.
12. Test-Specialist ejecuta pruebas, linters y seguridad.
13. Check-Reviewer y Simplify-Reviewer debaten si hay cambios complejos.
14. DevOps crea rama/commit/PR si procede; deploy a produccion solo con aprobacion explicita.
15. Release-Notifier envia Telegram con resumen, archivos, pruebas y estado final.
16. Context-Manager guarda sesion, lecciones, señales RLHF y metricas.

## 3. Routing De Modelos

Fuente de verdad: `.opencode/probe-results.json`.

Asignacion verificada:

- Tier A: `openai/gpt-5.5-pro`; fallback `openai/gpt-5.5` y Cursor ACP.
- Tier B: `openai/gpt-5.5`; fallback `openai/gpt-5.4`, Cursor ACP y OpenCode Go.
- Tier C: `openai/gpt-5.4-fast`; fallback `openai/gpt-5.4-mini` y OpenCode Go.
- Check-Reviewer y Simplify-Reviewer usan modelos distintos.

Reglas:

- Nunca se usa un modelo que no aparezca confirmado por probe.
- Timeout o 500/503: fallback inmediato.
- 429: backoff 5s, 30s, 120s y despues fallback.
- Re-probe manual con `/probe`; arranque valida proveedores.

## 4. Memoria Persistente

- Core memory: estado activo, reglas criticas, glosario reciente, correcciones recientes.
- Archival memory: ChromaDB cuando este disponible; fallback keyword si no.
- External memory: `.opencode/memory/*.jsonl`, `lessons.md`, `project-state.md`, `TEAM_TRACE.jsonl`.
- Reanudacion: `.opencode/state/*.json` conserva tareas interrumpidas.
- Purga: `/forget` con backup previo.

## 5. Descubrimiento De Herramientas

Se escanean endpoints, scripts, dependencias, workflows, integraciones, MCPs, DB2/SSH, rutas de imagenes y servicios locales. El resultado queda en:

```text
.opencode/memory/tools-manifest.json
```

Estado verificado GMP: 330 entradas.

## 6. Auto-Mejora

- `task-tracer` y TEAM_TRACE capturan acciones.
- `memory-save` y Context-Manager guardan sesiones.
- `rlhf-signals.jsonl` registra feedback positivo/neutro/negativo.
- `prompt-improvements.md` propone reglas nuevas.
- Autoaplicacion solo cuando se repite el mismo patron 3 sesiones y tras notificacion.

## 7. Configuracion Maestra

Archivos activos:

- Global: `C:\Users\Javier\.config\opencode\opencode.json`
- Global instructions: `C:\Users\Javier\.config\opencode\AGENTS.md`
- GMP root: `opencode.json`
- GMP project: `.opencode/opencode.json`
- GMP rules: `.opencode/rules.json`
- Granja root: `C:\Users\Javier\Desktop\Repositorios\granja_mari_pepa\opencode.json`
- Granja project: `C:\Users\Javier\Desktop\Repositorios\granja_mari_pepa\.opencode\opencode.json`
- Granja rules: `C:\Users\Javier\Desktop\Repositorios\granja_mari_pepa\.opencode\rules.json`

## 8. Respuestas Obligatorias

1. Se sabe por probe real y `probe-results.json`; routing solo usa modelos confirmados.
2. Si: subagentes se invocan como DAG con StateGraph compartido, handoff estructurado y TEAM_TRACE.
3. Hay reglas deterministas en `.opencode/rules.json`; no son miles, pero son suficientes y extensibles. La cantidad no sustituye verificacion real.
4. En arranque y bajo demanda: scan de endpoints, scripts, dependencias, CI, integraciones y servicios.
5. Si: memoria externa y StateGraph estan implementados; ChromaDB queda degradado hasta instalarse.
6. Es potente y verificable, pero no infalible. Usa planes, memoria, probe, reglas, reviews y no-alucinacion.
7. Si: extractor de intencion en orquestador y Context-Manager.
8. Con glosario, corrections, rlhf-signals y prompt-improvements.
9. Si: confianza baja exige pregunta; media procede con confirmacion; alta procede.
10. No operativo hoy. Voz requeriria Whisper/Telegram voice.
11. Si: split de tareas, prioridad y dependencias.
12. Con regla de no inventar, verificacion de entidades y preguntas ante falta de datos.
13. Arranque, incremental y bajo demanda.
14. Si: `tools-manifest.json`; no guarda credenciales.
15. Hash/scan incremental de endpoints, workflows y scripts.
16. Si: puede marcar herramientas inferidas con `action_needed`.
17. Variables de entorno y bloqueo de secretos; Vault no configurado.
18. DB2 via MCP/ODBC; tunneling SSH documentado, ejecucion requiere credenciales.
19. CLIs interactivos mediante scripts no interactivos o sandbox cuando Docker exista.
20. Topologia: orquestadores, contexto, repo, planner, especialistas, testers, reviewers, devops, notifier.
21. Mensajes sincronicos OpenCode + StateGraph en disco; no gRPC/colas externas hoy.
22. Si, paralelo cuando `depends_on` lo permite; file_locks evitan conflictos.
23. Si: Check-Reviewer, Simplify-Reviewer, Security-Validator, anti-doom-loop.
24. Parcial: planner puede subdelegar discovery; evitar anidamiento profundo.
25. Parcial: Web-Researcher/context7 puede traer docs; no instala dependencias sin aprobacion.
26. Timeout por tier y doom-loop tras 3 repeticiones.
27. Routing por tier, probe, latencia, disponibilidad y criticidad.
28. Si hay modelos locales/proxy disponibles se usan en Tier C; cloud para Tier A/B.
29. Backoff 5/30/120s, fallback de tier, proveedor alternativo, escalado humano.
30. Si: reviewers y debate; modelos distintos.
31. Lectura previa, RAG local, DB2 schema verification, tests.
32. Si: fallbacks por error/latencia y re-probe.
33. Corto plazo: contexto activo + compaction; largo plazo: files + ChromaDB opcional.
34. Preferencias, estado, lecciones, snippets, errores, sesiones y correcciones.
35. Context-Manager carga memoria al inicio.
36. Si: reflexion post-sesion.
37. Si: `.opencode/state/*.json`.
38. Si: memoria por proyecto y shared_patterns.
39. `/forget` con backup; datos locales.
40. Planner genera workstreams con dependencias, recursos y criterios.
41. Si: puede dividir optimizacion DB en EXPLAIN, indices, rewrite y medicion.
42. Reintenta paso; tras 3 fallos replanifica rama; luego rollback.
43. Si: riesgos, side effects y reviewers.
44. Si por StateGraph local; DB externa no habilitada.
45. `file_locks` y colas por recurso.
46. Si: Tier 2/3 presenta plan antes de ejecutar.
47. Si: regla obligatoria leer antes de editar.
48. AST disponible cuando herramienta exista; por defecto diffs controlados.
49. Repo-Explorer detecta estilos, linters y patrones.
50. Si: Test-Writer.
51. Si, con scripts rollback y aprobacion para ejecutar DB2 DDL.
52. Flutter/Node pueden hot reload, pero el agente no fuerza produccion.
53. Telegram con resumen, archivos, tests y commits.
54. Sandbox Docker cuando exista, linters/tests/audit/artefactos segun proyecto.
55. Objetivo 80% negocio; genera tests si faltan.
56. Si: secrets scan y env-protection.
57. Parcial: OWASP checklist y npm audit; Semgrep/CodeQL no instalados hoy.
58. Si con k6/Docker cuando Docker este disponible.
59. Si: log + diff; maximo 2 ciclos correctivos.
60. No hay staging exacto declarado; se puede configurar como proyecto futuro.
61. Feature branches, commits atomicos, PR si GitHub token existe.
62. Staging/prod via SSH/webhook; produccion exige aprobacion.
63. Snapshot + git revert + healthcheck; rollback automatico ante fallo post-deploy.
64. Si: Telegram requiere SI/NO para produccion.
65. TEAM_TRACE.jsonl y metricas; ClickHouse opcional.
66. Telegram ejecutivo, corto, acciones claras.
67. Si: Telegram push.
68. No offline hoy.
69. Si: PAUSA, SIGUE, CANCELAR.
70. Si: chat natural con orquestador.
71. Si para Tier 2/3.
72. Si: meta-reflexion.
73. DPO/RLHF practico sobre prompts/reglas, no fine-tuning de modelo base.
74. Parcial: historial y aprobacion por silencio tras 60s si se repite 3 veces.
75. Al cierre de sesion; online para correcciones criticas.
76. Si: `/probe` descubre modelos; tools/plugins por archivos.
77. Si: `/metrics`, readiness y agent-performance.
78. JSON OpenCode con models, agents, tools, rules, envs, security, ui.
79. Si: versionado junto al codigo; `.opencode` puede estar ignorado si se decide.
80. Parcial: Grafana/Prometheus; panel web custom no implementado.
81. Si: rules.json y plugins bloqueantes.
82. Añadir agente `.md`, config y permisos; sin tocar nucleo.
83. Si: GMP y Granja verificados.
84. Parcial: permisos por agente y confirmaciones; RBAC multiusuario no implementado.
85. Reanuda desde StateGraph.
86. Circuit breaker/backoff/degraded.
87. Sandbox Docker limita CPU/mem cuando Docker exista.
88. Escritura atomica en tools; snapshots antes de cambios.
89. Si hay proveedor local/proxy en probe; si no, degradado.
90. Snapshot antes de modificar existentes.
91. Verifica DB2 tabla/columnas, genera migration+rollback, actualiza backend/app, tests, aprobacion.
92. Verifica 192.168.1.191, logs backend, construccion URL, sanitizacion y tiempos.
93. Lee scripts Python, verifica DB2, crea migracion y rollback.
94. Escanea IPs/URLs hardcodeadas, reporta y externaliza si se aprueba.
95. Si: puede generar docs API/arquitectura desde rutas reales.
96. Tests de contrato backend/app y serializers.
97. Parcial: puede analizar; optimizacion requiere acceso al servidor de imagenes.
98. Puede documentar/ejecutar via SSH si credenciales y comandos DB2 estan disponibles.
99. Si con `ssh -L`, sujeto a credenciales y BatchMode.
100. Lee Jenkins/GitHub Actions y mejora sin romper.
101. Tier 1 <5 min, Tier 2 <20 min, Tier 3 <60 min como objetivo.
102. 2 proyectos listo; 10 viable; 50/100 requiere orquestacion central.
103. No 99.9% hoy; es sistema personal local. HA requiere servicios redundantes.
104. En transito por HTTPS/SSH cuando aplica; reposo local depende de Windows/Docker.
105. Si: auditoria por TEAM_TRACE y exportacion futura a ClickHouse/CSV.

## 9. Pendientes Reales

1. Instalar Docker Desktop si se quiere sandbox, ChromaDB, Redis, ClickHouse, Prometheus y Grafana en compose.
2. Arrancar stack:

```powershell
docker compose -f .opencode\monitoring\docker-compose.yml up -d
```

3. Reejecutar readiness y esperar que desaparezcan warnings de ChromaDB/Redis/Docker.
4. Revisar Flutter/Dart en esta maquina: `dart --version` y `flutter --version` se quedaron colgados durante las pruebas.
5. Ejecutar los 10 tests end-to-end obligatorios con OpenCode interactivo. Hoy hay microtests y readiness; no todos los escenarios de Telegram/DB2/debate han sido ejecutados de extremo a extremo.
