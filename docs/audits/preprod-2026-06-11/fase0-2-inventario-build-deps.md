# Auditoría pre-producción 2026-06-11 — Fases 0-2: Inventario, Build/Estático y Dependencias

- **Fecha de ejecución inicial:** 2026-06-11, 23:21–23:59 (UTC+2)
- **Última actualización (re-verificación post-fixes):** 2026-06-12, ~12:00 (UTC+2)
- **Alcance:** pestañas **Pedidos**, **Cobros** y **Bolsa comercial** (frontend Flutter + backend Node.js)
- **Rol del agente:** solo lectura sobre código fuente; ningún archivo fuente editado, ningún commit realizado
- **Herramientas:** Flutter 3.35.6 (stable, rev 9f455d2486), Node v22.22.1, npm 10.9.4
- **Nota de concurrencia:** durante la auditoría inicial otros agentes trabajaban en paralelo (DB2, backend, lib/test). El Apéndice A conserva la instantánea del 2026-06-12 00:37; la re-verificación del 2026-06-12 actualiza Fases 1–2 sin regenerar el inventario completo (1.260 trackeados sin cambio; `git status --porcelain` pasó de 132 a **179** entradas por fixes y artefactos nuevos de otros agentes).

### Actualización 2026-06-12 — post-fixes de otros agentes

Re-ejecutados: `flutter pub get`, `flutter analyze`, `node --check` (206 JS), escaneo de marcadores TODO/FIXME/HACK y términos de riesgo, `flutter pub outdated`, `npm audit`.

| Métrica | 2026-06-11 (inicial) | 2026-06-12 (post-fixes) | Δ |
|---|---|---|---|
| `flutter analyze` errors | 0 | **0** | = |
| `flutter analyze` warnings | 2 | **2** (mismas líneas conflict_resolver.dart:185, :273) | = |
| `flutter analyze` infos | 7.110 | **7.108** | −2 |
| `node --check` | 206/0 fallos | **206/0 fallos** | = |
| Marcadores BLOQUEANTES | 0 | **0** | = |
| `npm audit` | 19 (9 mod, 10 high) | **19 (9 mod, 10 high)** | = |

**Conclusión post-fixes:** los cambios de otros agentes no introdujeron errores de analyze ni marcadores bloqueantes nuevos. Los 2 warnings de `conflict_resolver.dart` persisten sin cambio. Las vulnerabilidades npm siguen sin parche aplicado en el working tree.

---

## 1. Metodología y comandos ejecutados

| Fase | Comando | Resultado |
|---|---|---|
| 0 | `git ls-files` | 1.260 archivos trackeados |
| 0 | `git status --porcelain -uall` | 132 modificados + untracked (ver Apéndice A) |
| 1 | `flutter pub get` | `Got dependencies!` (exit 0, 15,5 s) |
| 1 | `flutter analyze` | **7.110 issues** en 110,4 s (re-run 2026-06-12): **0 errors, 2 warnings, 7.108 infos** (exit 1). Inicial 2026-06-11: 7.112 issues / 117,6 s |
| 1 | `node --check` sobre server.js + todos los `.js` de routes/, services/, middleware/, src/ | **206 archivos, 0 fallos de parseo** |
| 1 | `rg` case-insensitive de marcadores en lib/, backend/ (sin node_modules), test/ | Ver sección 5 |
| 2 | `flutter pub outdated` | Ver sección 6.1 |
| 2 | `npm ls --depth=0` (backend/) | exit 0, árbol coherente con lock, sin `UNMET`/`invalid` |
| 2 | `npm audit` (backend/) | **19 vulnerabilidades (9 moderate, 10 high)** — análisis de impacto en 6.2 |

---

## 2. Fase 0 — Inventario clasificado

El inventario completo, archivo por archivo con categoría y motivo, está en el **Apéndice A** (al final, generado por exclusión determinista para garantizar que cada archivo aparece exactamente en una categoría).

**Resumen:** 🔴 CRÍTICO: **95** archivos · 🟡 RELACIONADO: **240** · ⚪ FUERA DE SCOPE: **965** · Total: **1300** (1.259 trackeados + 41 untracked, instantánea de las 00:37 del 2026-06-12)

### 2.1 Directorios/elementos excluidos del inventario (justificación)

| Excluido | Existe | Justificación |
|---|---|---|
| `.git/` | Sí | Metadatos de git, no código fuente |
| `build/` | Sí | Artefactos de compilación Flutter, regenerables |
| `.dart_tool/` | Sí | Caché del toolchain Dart, regenerable |
| `backend/node_modules/` | Sí | Dependencias npm instaladas, regenerables desde `package-lock.json` |
| `android/.gradle/` | Sí | Caché de Gradle, regenerable |
| `ios/Pods/` | No existe | N/A (verificado con `Test-Path` → False) |
| `.beads/dolt/` | No existe | N/A (verificado con `Test-Path` → False); los exports `.beads/*.jsonl` sí se inventarían |
| `pixel-agents` | Sí (entrada git) | Gitlink/submódulo (modo 160000 en `git ls-files -s`), no archivo fuente del repo |

### 2.2 Hallazgos del inventario (residuos a limpiar, no bloqueantes)

| Archivo | Estado | Evidencia |
|---|---|---|
| `Driver` (raíz) | Untracked, 1.450 bytes | Volcado de `Get-OdbcDsn` de PowerShell (lista DSNs ODBC, incluye DSN GMP). Residuo de diagnóstico |
| `v` (raíz) | Untracked, 0 bytes | Archivo vacío. Residuo |
| `Simple` (raíz) | **Trackeado**, 53 bytes | Contenido: « Acceso desde VS Code: Ctrl+Shift+P - Browser: Show». Residuo trackeado |
| `lib/features/pedidos/presentation/pages/pedidos_page_first.txt` | Trackeado | `.txt` dentro de `lib/` (copia antigua de página); no se compila |
| `android/build_log.txt`, `android/build/reports/problems/problems-report.html` | Trackeados | Artefactos de build trackeados en git |
| `backend/kpi/tmp/sftp_*/` (14 CSVs) | Trackeados | Datos temporales de SFTP con datos reales de clientes trackeados en git |

---

## 3. Fase 1 — Build y análisis estático

### 3.1 `flutter pub get`

Exit 0, «Got dependencies!». Aviso del resolutor: «121 packages have newer versions incompatible with dependency constraints» (detalle en sección 6.1).

### 3.2 `flutter analyze` — 0 errors, 2 warnings, 7.108 infos (re-verificado 2026-06-12)

**Errores: 0.**

**Warnings (2) — listado completo:**

| Archivo:línea | Regla | Mensaje |
|---|---|---|
| `lib/core/offline/conflict_resolver.dart:185:30` | `invalid_return_type_for_catch_error` | A value of type 'Null' can't be returned by the 'onError' handler because it must be assignable to 'FutureOr<Map<String, dynamic>>' |
| `lib/core/offline/conflict_resolver.dart:273:30` | `invalid_return_type_for_catch_error` | (mismo mensaje) |

Evaluación: archivo 🟡 (infra offline compartida). El handler `catchError` devuelve `null` donde el tipo exige `Map<String, dynamic>`; si esa ruta de error se ejecuta, lanza `TypeError` en runtime. No pertenece al flujo principal de las 3 pestañas (resolución de conflictos offline). **NO BLOQUEANTE para la presentación; corrección recomendada esta semana.**

**Infos (7.108, re-run 2026-06-12; inicial 7.110) agrupados por regla — conteo de la ejecución inicial y 3 ejemplos por regla:**

| Regla | Nº | 3 ejemplos (archivo:línea:col) |
|---|---|---|
| `public_member_api_docs` | 3.161 | api_client.dart:409:23 · api_client.dart:413:23 · api_client.dart:417:23 |
| `lines_longer_than_80_chars` | 1.801 | api_client.dart:51:81 · api_client.dart:76:81 · api_client.dart:201:81 |
| `require_trailing_commas` | 1.052 | api_client.dart:914:56 · api_client_secure.dart:134:6 · connectivity_provider.dart:100:83 |
| `cascade_invocations` | 179 | api_client.dart:282:7 · api_client_secure.dart:88:7 · cache_service_optimized.dart:340:5 |
| `prefer_const_constructors` | 160 | conflict_resolver.dart:311:16 · conflict_resolver.dart:344:16 · data_preloader.dart:38:14 |
| `avoid_dynamic_calls` | 150 | api_client_secure.dart:241:35 · :243:24 · :244:26 |
| `unawaited_futures` | 78 | api_client.dart:577:26 · api_client.dart:655:26 · api_client_secure.dart:544:24 |
| `prefer_int_literals` | 73 | app_theme.dart:16:34 · :19:34 · :22:34 |
| `avoid_redundant_argument_values` | 70 | conflict_resolver.dart:285:23 · data_preloader.dart:181:27 · offline_aware_api.dart:62:51 |
| `always_put_required_named_parameters_first` | 55 | conflict_resolver.dart:63:19 · :64:19 · offline_aware_api.dart:51:21 |
| `omit_local_variable_types` | 36 | data_preloader.dart:231:5 · sync_queue_service.dart:117:5 · client_evolution_tab.dart:54:7 |
| `use_build_context_synchronously` | 34 | pdf_preview_screen.dart:122:25 · **bolsa_page.dart:295:30** · simple_client_list_page.dart:330:28 |
| `directives_ordering` | 31 | sync_queue_service.dart:4:1 · client_evolution_tab.dart:2:1 · :4:1 |
| `sort_constructors_first` | 31 | conflict_resolver.dart:54:9 · :82:11 · :109:11 |
| `curly_braces_in_flow_control_structures` | 30 | fi_filters_widget.dart:572:9 · client_detail_page.dart:758:19 · commissions_page.dart:1426:7 |
| `always_use_package_imports` | 12 | client_evolution_tab.dart:3:8 · :4:8 · :5:8 |
| `parameter_assignments` | 12 | **pedidos_provider.dart:493:30 · :696:9 · :697:42** |
| `avoid_positional_boolean_parameters` | 10 | theme_provider.dart:31:25 · pedidos_provider.dart:481:23 · pedidos_provider_v3.dart:351:23 |
| `avoid_multiple_declarations_per_line` | 10 | commissions_page.dart:2476:29 · client_map_view.dart:47:24 · warehouse_data_service.dart:167:19 |
| `eol_at_end_of_file` | 9 | conflict_resolver.dart:605:2 · pending_client_provider.dart:21:2 · currency_formatter.dart:49:2 |
| `unnecessary_raw_strings` | 9 | user_model.dart:33:57 · main_shell.dart:102:58 · :109:58 |
| `unnecessary_breaks` | 8 | sync_queue_service.dart:188:9 · :191:9 · :195:9 |
| `deprecated_member_use` | 8 | api_client_secure.dart:29:7 (`encryptedSharedPreferences`) · secure_storage.dart:9:7 (ídem) · client_evolution_page.dart:255:23 (`value`→`initialValue`); resto: client_evolution_page.dart:509:56 (`withOpacity`), projection_3d.dart:117-119 (`red`/`green`/`blue`), navigation_edge_cases_test.dart:82:27 (`value`) |
| `use_setters_to_change_properties` | 7 | api_config.dart:67:15 · :94:15 · agent_database.dart:239:8 |
| `use_if_null_to_convert_nulls_to_bools` | 7 | **bolsa_page.dart:69:21 · :95:15 · :282:9** |
| `flutter_style_todos` | 6 | api_client_secure.dart:101:9 · cache_service_optimized.dart:329:24 · :333:5 (los 6 TODO de la sección 5) |
| `avoid_equals_and_hash_code_on_mutable_classes` | 6 | auth_notifier.dart:81:3 · :95:3 · dashboard_notifier.dart:83:3 |
| `prefer_constructors_over_static_methods` | 6 | agent_database.dart:49:28 · unified_memory_layer.dart:34:33 · connectivity_provider.dart:41:34 |
| `noop_primitive_operations` | 5 | **bolsa_page.dart:291:42** · dashboard_header.dart:31:41 · objectives_page.dart:2347:52 |
| `use_late_for_private_fields_and_variables` | 5 | simple_client_list_page.dart:52:17 · advanced_sales_chart_v3.dart:388:30 · kpi_dashboard_page.dart:32:25 |
| `no_default_cases` | 4 | dashboard_chart_factory.dart:40:7 · repartidor_historico_page.dart:2017:7 · :2032:7 |
| `unnecessary_lambdas` | 4 | pdf_range_dialog.dart:58:14 · entregas_provider.dart:371:63 · enhanced_client_matrix_page.dart:233:14 |
| `unnecessary_parenthesis` | 4 | main_shell.dart:385:32 · pedidos_provider.dart:295:40 · repartidor_evolution_page.dart:85:23 |
| `use_super_parameters` | 4 | premium_route.dart:9:3 · :52:3 · :77:3 |
| `prefer_null_aware_method_calls` | 3 | matrix_data_table.dart:329:11 · signature_modal.dart:91:11 · client_map_view.dart:135:19 |
| `prefer_const_declarations` | 3 | **bolsa_page.dart:119:5 · cobros_page.dart:492:5** · facturas_page.dart:1361:5 |
| `unnecessary_overrides` | 2 | theme_provider.dart:39:8 · **cobros_provider.dart:473:8** |
| `sort_pub_dependencies` | 2 | pubspec.yaml:16:3 · :96:3 |
| `prefer_final_locals` | 2 | repartidor_evolution_page.dart:184:25 · accessibility_widgets_test.dart:89:7 |
| `comment_references` | 2 | **product_comparative_strip.dart:6:39 · unit_selector_modal.dart:163:8** |
| `avoid_bool_literals_in_conditional_expressions` | 2 | commissions_page.dart:1019:26 · summary_stats_widget.dart:40:23 |
| `missing_whitespace_between_adjacent_strings` | 2 | commissions_page.dart:206:19 · :207:23 |
| `cast_nullable_to_non_nullable` | 2 | **order_status_badge_test.dart:205:28 · :222:28** |
| `use_raw_strings` | 2 | string_utils_test.dart:97:56 · :97:63 |
| `use_key_in_widget_constructors` | 1 | rutero_kpi_dashboard.dart:9:9 |
| `prefer_null_aware_operators` | 1 | repartidor_finanzas_models.dart:684:25 |
| `avoid_slow_async_io` | 1 | commissions_pdf_service.dart:145:18 |
| `library_private_types_in_public_api` | 1 | rutero_page.dart:1478:3 |
| `prefer_function_declarations_over_variables` | 1 | **cobros_page.dart:351:11** |
| `avoid_print` | 1 | analytics_page.dart:108:7 |
| `prefer_const_literals_to_create_immutables` | 1 | commissions_page.dart:1936:46 |
| `leading_newlines_in_multiline_strings` | 1 | benchmark.dart:289:12 |
| `unnecessary_import` | 1 | rutero_detail_signature.dart:4:8 |
| `prefer_conditional_assignment` | 1 | api_client.dart:117:5 |
| `use_named_constants` | 1 | objectives_page.dart:1583:27 |

(En negrita los infos que tocan archivos 🔴 de Pedidos/Cobros/Bolsa.) Los infos relevantes para las 3 pestañas son de estilo/robustez (`use_build_context_synchronously` en bolsa_page.dart:295 es el más sensible: uso de `BuildContext` tras un `await`); ninguno es error de compilación.

### 3.3 `node --check` backend

Comando: `node --check` sobre `backend/server.js` + todos los `.js` de `backend/routes`, `backend/services`, `backend/middleware` y `backend/src` (excluyendo node_modules).

**Resultado: `TOTAL=206`, `FAILS=0`.** Cero errores de sintaxis/parseo.

### 3.4 Cableado de rutas verificado (contexto para clasificación)

- `backend/server.js:63` → `USE_DDD_ROUTES = process.env.USE_DDD_ROUTES !== 'false'` (**DDD activo por defecto**); server.js:481-482 monta `/api/pedidos` y `/api/cobros` sobre los módulos DDD (`src/modules/pedidos`, `src/modules/cobros`), con fallback a `routes/pedidos.js` y `routes/cobros.js` (server.js:498-499) si el arranque DDD falla (server.js:628).
- `backend/server.js:475` → `/api/bolsa` siempre sobre `routes/bolsa.js` (sin variante DDD).
- `backend/server.js:55` → `USE_TS_ROUTES = process.env.USE_TS_ROUTES === 'true'` (**default false**): el stack TypeScript `backend/src/routes|services|controllers/*.ts` **no se carga** con el arranque por defecto (`npm start` = `node server.js`).
- `backend/src/shared/routes/ddd-adapters.js:19-20` importa `Db2PedidosRepository` y `Db2CobrosRepository` → crítico para las 3 pestañas servidas por DDD.
- `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js:890` usa `services/dsedac-exports.service.js` → crítico para Cobros.
- `backend/services/pedidos.service.js:8-45` requiere `config/db`, `utils/db2-identifiers`, `middleware/logger`, `services/query-optimizer`, `services/redis-cache`, `utils/common`, `services/circuit-breaker`, `services/laclae` → base de la clasificación 🟡 de infraestructura.

---

## 4. Fase 1 — Escaneo de marcadores (evaluación completa)

Búsqueda case-insensitive de `TODO, FIXME, HACK, XXX, TEMP, temporal, provisional, arreglar, pendiente, hardcoded, hardcode` en `lib/`, `backend/` (sin node_modules) y `test/`. **No se ha arreglado nada; este es el listado evaluado.**

### 4.1 Marcadores reales de trabajo pendiente (TODO/FIXME/HACK)

**Total de marcadores reales encontrados: 9 TODO. FIXME: 0. HACK: 0 (como marcador).**

| # | Archivo:línea | Texto literal | ¿Afecta Pedidos/Cobros/Bolsa? | Clasificación |
|---|---|---|---|---|
| 1 | `lib/core/api/api_client_secure.dart:101` | `// TODO: Add actual production certificate SHA256 fingerprint` | No — archivo no importado por ningún fichero (`rg "import.*api_client_secure"` en lib/ → 0 resultados); el cliente activo es `api_client.dart` | **NO BLOQUEANTE** (código muerto; recomendación: eliminar archivo) |
| 2 | `lib/core/cache/cache_service_optimized.dart:329` | `return jsonString; // TODO: Implement actual compression` | No directamente — solo lo importan `pedidos_provider_v3.dart` (a su vez no referenciado por nadie: `rg "pedidos_provider_v3"` en lib/ → 0 imports) y `core/utils/stream_chain.dart`. Sin compresión funciona (devuelve el JSON tal cual) | **NO BLOQUEANTE** (degradación funcional nula; el caché activo es `cache_service.dart`) |
| 3 | `lib/core/cache/cache_service_optimized.dart:333` | `// TODO: Implement actual decompression` | Ídem #2 | **NO BLOQUEANTE** |
| 4 | `lib/features/dashboard/presentation/widgets/ultimas_ventas_widget.dart:105` | `// TODO: Navegar a historial completo` | No (dashboard) | **NO BLOQUEANTE** (navegación secundaria sin implementar; el botón no es parte de las 3 pestañas) |
| 5 | `lib/features/dashboard/presentation/widgets/client_conditions_widget.dart:102` | `// TODO: Navegar a detalle de medios` | No (dashboard) | **NO BLOQUEANTE** |
| 6 | `lib/features/dashboard/presentation/widgets/client_conditions_widget.dart:117` | `// TODO: Navegar a detalle de congeladores` | No (dashboard) | **NO BLOQUEANTE** |
| 7 | `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart:1123` | `// TODO(repartidor): usar subempresa del albaran cuando el modelo` | No (repartidor) | **NO BLOQUEANTE** |
| 8 | `backend/src/routes/pedidos.routes.ts:73` | `// TODO: En producción, guardar en base de datos` | **Tocaría Pedidos si el stack TS estuviera activo**, pero `USE_TS_ROUTES` default false (server.js:55,120) → ruta no cargada en producción | **NO BLOQUEANTE** (código inactivo; la ruta activa de Pedidos es DDD/`routes/pedidos.js`) |
| 9 | `backend/src/middleware/auth.middleware.ts:161` | `// TODO: Implementar verificación de roles cuando se agregue la tabla de roles` | No — middleware del stack TS inactivo; el middleware activo es `backend/middleware/auth.js` (requerido por bolsa.js:4, pedidos.js:45) | **NO BLOQUEANTE** |
| 10 | `backend/src/cron/transferencias.job.ts:191` | `// TODO: Aquí se podría integrar envío de email o notificación` | No — cron del stack TS (`src/index.ts`), no cargado por `server.js` | **NO BLOQUEANTE** |
| 11 | `backend/src/cron/transferencias.job.ts:234` | `// TODO: Implementar lógica de reposicionamiento según necesidades` | Ídem #10 | **NO BLOQUEANTE** |

(Los 6 `flutter_style_todos` de analyze coinciden exactamente con los TODO #1-#6 de lib/ — verificación cruzada correcta; el #7 usa formato `TODO(autor)` y por eso el linter no lo marca.)

**Marcadores BLOQUEANTES: 0.** Ningún TODO/FIXME/HACK afecta al flujo activo de Pedidos, Cobros o Bolsa.

### 4.2 `XXX` — todas las ocurrencias

| Archivo:línea | Texto literal | ¿Afecta? | Clasificación |
|---|---|---|---|
| `backend/routes/cobros.js:703` | `* de DSEDAC.CLI para que el frontend no tenga que mostrar "Cliente XXX".` | Cobros: sí (comentario en código activo) | **FALSO POSITIVO** — documentación de un fix ya aplicado («Cliente XXX» describe el placeholder que se evita), no marcador |
| `backend/routes/cobros.js:863` | `// FIX 2026-05-16: incluir nombres del ERP para que el frontend no muestre "Cliente XXX"` | Cobros: sí | **FALSO POSITIVO** — ídem |
| `backend/__tests__/repartidor-finanzas.test.js:628` | `subempresaDocumento: 'XXX',` | No | **FALSO POSITIVO** — fixture de test |
| `backend/src/chatbot/moderation.js:28` | regex `...hack|exploit|...xss...` | No | **FALSO POSITIVO** — patrón del filtro de moderación (también única coincidencia de «hack») |

### 4.3 `TEMP/temporal/provisional/arreglar/hardcoded/hardcode` — evaluación completa

**«arreglar»: 0 ocurrencias en lib/, backend/ y test/.**

Ocurrencias en `lib/` (todas):

| Archivo:línea | Texto/contexto | ¿Afecta? | Clasificación |
|---|---|---|---|
| `lib/core/api/api_config.dart:17` | `// CONFIGURACIÓN POR DEFECTO: PRODUCCIÓN (HARDCODED)` | Sí (las 3 pestañas usan esta URL base) | **FALSO POSITIVO** — diseño deliberado y documentado (api_config.dart:6-9): URL fija `https://api.mari-pepa.com/api` con override runtime (`setEnvironment`, :67). No es secreto ni trabajo pendiente |
| `lib/core/api/api_config.dart:59` | `// Producción: URL hardcoded (ya incluye /api)` | Sí | **FALSO POSITIVO** — ídem |
| `lib/features/pedidos/data/pedidos_service.dart:1226` | `/// Delivery date + provisional truck options before confirming an order.` | Pedidos: sí | **FALSO POSITIVO** — «camión provisional» es término de dominio (asignación provisional de reparto), no marcador |
| `lib/features/commissions/presentation/pages/commissions_page.dart` (16 ocurrencias: 908, 920-921, 925, 1042-1043, 1202, 1207, 1209, 1706, 1740, 2825-2826, 2956, 2958) | `provisionalCommission` / `COMISIÓN PROVISIONAL` | No (comisiones) | **FALSO POSITIVO** — término de negocio: comisión provisional del mes en curso |
| `lib/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart:547` | `// Si no, separar el mensaje original de forma provisional` | No (kpi_alerts) | **NO BLOQUEANTE** — describe un fallback de parsing ya implementado |
| `lib/features/repartidor/presentation/pages/repartidor_historico_page.dart:1791` | `// Save PDF to temp file` | No | **FALSO POSITIVO** — archivo temporal de PDF, uso legítimo |
| `lib/features/commissions/data/commissions_pdf_service.dart:135` | `// Save PDF to temp directory with unique filename` | No | **FALSO POSITIVO** — ídem |
| `lib/core/widgets/pdf_preview_screen.dart:65` | `// Clean up temp file async with delay...` | No | **FALSO POSITIVO** — ídem |
| `lib/core/memory/reasoning_bank.dart:249` | `// Aplicar decay temporal` | No | **FALSO POSITIVO** — término técnico (decaimiento temporal) |
| `lib/core/memory/agent_database.dart:135,389,422` | `estado temporal` / `Caché temporal` | No | **FALSO POSITIVO** — término técnico |
| `test/core/memory/agent_database_test.dart:82` | `metadata: {'temp': true},` | No | **FALSO POSITIVO** — fixture |

Ocurrencias en `backend/` (todas las de código; los archivos de resultados de auditorías previas `backend/scripts/results/*.{md,json}` y docs contienen la palabra «hardcoded» como *hallazgo documentado*, no como marcador — se listan al final):

| Archivo:línea | Texto/contexto | ¿Afecta? | Clasificación |
|---|---|---|---|
| `backend/routes/pedidos.js:854` | `* Delivery days + provisional truck for client/vendor.` | Pedidos: sí | **FALSO POSITIVO** — término de dominio |
| `backend/routes/pedidos.js:1635` | `CONFIRMANDO: 'Estado tecnico temporal mientras se valida stock...'` | Pedidos: sí | **FALSO POSITIVO** — descripción de estado de negocio mostrada al usuario |
| `backend/src/api-server.ts:5` | `// It contains insecure patterns (hardcoded credentials, SQL injection).` | No | **FALSO POSITIVO** — archivo neutralizado: leído completo (27 líneas), todas las rutas devuelven 501, **no contiene credenciales** (cabecera lines 1-7 lo declara DEPRECATED) |
| `backend/ecosystem.config.js:35` | `// JWT secrets loaded from .env — do NOT hardcode here` | No | **FALSO POSITIVO** — instrucción preventiva correcta |
| `backend/routes/commissions.js:53` | `// Merge unique with hardcoded safety list` | No (comisiones) | **NO BLOQUEANTE** — lista de seguridad embebida deliberada en feature fuera de alcance |
| `backend/routes/commissions.js` (96,108,153,1181-1224) | `provisionalCommission` | No | **FALSO POSITIVO** — término de negocio |
| `backend/src/services/commissions.service.ts` (60,406-421,502,576) | `provisionalCommission` | No | **FALSO POSITIVO** — término de negocio (stack TS inactivo) |
| `backend/src/services/commissions.service.ts:810` | `* Falls back to hardcoded defaults if no DB config exists.` | No | **NO BLOQUEANTE** — stack TS inactivo (server.js:55) |
| `backend/routes/planner.js:296` | `// SECURITY: Use parameterized query (hardcoded values but consistent pattern)` | No (planner) | **FALSO POSITIVO** — valores constantes del propio código, patrón seguro documentado |
| `backend/src/services/cobros.service.ts:226` | `// Generar número de pedido temporal` | Cobros: tocaría, pero stack TS inactivo | **NO BLOQUEANTE** (código inactivo) |
| `backend/src/routes/pedidos.routes.ts:60` | `// Generar número de pedido temporal` | Ídem | **NO BLOQUEANTE** (código inactivo) |
| `backend/src/services/entregas.service.ts:338` | `// Mover archivo desde ubicación temporal` | No | **FALSO POSITIVO** — término técnico |
| `backend/routes/auth.ts:182` | `Cuenta bloqueada temporalmente...` | No | **FALSO POSITIVO** — mensaje de negocio (lockout) |
| `backend/services/emailPdfService.js:125` | `* Almacenar PDF en caché temporal` | No | **FALSO POSITIVO** — término técnico |
| `backend/app/services/deliveryReceiptService.js:16` | `// Directorio para almacenar recibos temporales` | No | **FALSO POSITIVO** — término técnico |
| `backend/kpi/**` (sftp_client.js:33, etl_orchestrator.js:205,350,360,362, README.md:60) | `temporal`/`temp` | No (módulo KPI) | **FALSO POSITIVO** — directorios temporales del ETL |
| `backend/scripts/run-020-migration.js:126` | `// Replace hardcoded 'JAVIER' with ERP_FINANCE_SCHEMA if different` | No (script puntual) | **FALSO POSITIVO** — el código hace el reemplazo que describe |
| `backend/scripts/sql/027_team_commission_config.sql:38`, `025_pedidos_reparto_linkage.sql:2`, `backend/scripts/agent1-dsedac-discovery.js:171` | `hardcodeo`/`provisional`/`hardcoded` | No (scripts/SQL puntuales) | **FALSO POSITIVO** — documentación de scripts |
| `backend/scripts/results/*.{md,json}`, `backend/docs/VENTAS_B_documentacion.md`, `backend/kpi/README.md` | «hardcoded/hardcodeadas» (final-audit-report.md:51-53,117,144; agent2-code-audit.json; agent4-doc-analysis.md:168-188; synthesis-mapping-report.md:13-15,160; VENTAS_B:24-26) | Indirecto | **FALSO POSITIVO como marcador** — son hallazgos de auditorías anteriores ya registrados (p. ej. esquema JAVIER hardcodeado en repartidor-finance-service: feature repartidor, fuera de las 3 pestañas; las credenciales de api-server.ts ya eliminadas — verificado en este informe) |

### 4.4 «pendiente» — término de negocio dominante

Conteo: **lib/ 254 ocurrencias en 42 archivos; backend/ ~640 en 95 archivos; test/ 13 en 4 archivos** (`rg -i pendiente --count`). En esta aplicación «pendiente» es vocabulario central del dominio: cobros pendientes, saldo pendiente, albaranes pendientes de entrega, estados `PENDIENTE`/`PEND_APROB`, columnas `IMPORTEPENDIENTE` del ERP.

Para separar dominio de trabajo-pendiente se escanearon **todas las ocurrencias en contexto de comentario** (`rg -i "(//|--|#|/\*|\* ).*pendiente"`): 20 resultados en lib/ y ~60 en backend/, **todos** describen entidades de negocio o documentación de endpoints (p. ej. cobros_provider.dart:82 «Numero de clientes con cualquier importe pendiente (>0)», cobros.js:220 «GET /api/cobros/:codigoCliente/pendientes», pedidos.service.js:222 mapeo de estado legacy `PENDIENTE`). Excepciones que no son dominio puro, evaluadas:

| Archivo:línea | Texto | Clasificación |
|---|---|---|
| `backend/scripts/generate_align_migration.js:285` | `-- Pendiente: definir SQL de cada vista (depende del modelo final` | **NO BLOQUEANTE** — script generador de migraciones (herramienta interna), no producto |
| `backend/scripts/pilar2-build-report.js:217,308,352,358` | `BLOQUEOS PENDIENTES` (secciones del informe del agente DB2, generado hoy en paralelo) | **FALSO POSITIVO aquí** — es el entregable de otra fase de esta misma auditoría; sus bloqueos B1-B7 se gestionan en ese informe |
| Resto (todas las demás ocurrencias de los 141 archivos) | Strings de UI, estados, columnas SQL, nombres de variables (`totalPendiente`, `saldoPendiente`, `getPendientes`) | **FALSO POSITIVO** — estado de negocio real |

### 4.5 «todo» (español) — falso positivo masivo de TODO

La búsqueda case-insensitive de `TODO` coincide con la palabra española «todo/todos». Ocurrencias verificadas y descartadas como **FALSO POSITIVO** (texto UI o comentarios en español): orders_panel_v2.dart:270,285,559 · load_planner_panel.dart:140,144,219,645 · articles_page.dart:109,129 · warehouse_data_service.dart:547,750 · pdf_export_service.dart:222 · rutero_client_detail_page.dart:485,498 · rutero_detail_products.dart:266 · stock_alternatives_sheet.dart:309,538 (texto UI de Pedidos: «Buscar en todo el catálogo» — legítimo) · objectives_page.dart:844,928 (botón «TODO» = «todos los meses») · enhanced_client_matrix_page.dart:2154 · cobros_page.dart:658 («Todo al dia» — texto UI de Cobros, legítimo) · client_detail_page.dart:575-576 · analytics_page.dart:24,248,349 · vector_store_hnsw.dart:274 · network_settings_page.dart:271 · rutero_dialogs.dart:37 · rutero_page.dart:294 · vencimientos_page.dart:51,61,136,588 · auth.controller.ts:59 · etl_orchestrator.js:66 · warehouse.js:590,1032 · planner.js:471 · loadPlanner.js:870 · emailService.js:626,640 · VENTAS_B_documentacion.md:26,48,283,285 · final-audit-report.md:29,157 · CSVs de `backend/kpi/tmp/` (nombres de comercios «TODO A 1», «TODO MARKET» — verificado en Medios_Clientes.csv:269,389,528,802).

**Observación de calidad detectada durante el escaneo (no marcador):** mojibake/encoding roto en `lib/features/clients/presentation/pages/client_detail_page.dart:575-576` («Me gustar­a saber c³mo va todo») y en `backend/services/pedidos.service.js:3278` (comentario con secuencia UTF-8 corrupta «AprobaciÃƒÆ'Ã¢â‚¬...»). El segundo está en archivo 🔴 de Pedidos pero es un comentario; no afecta ejecución. Recomendación: corregir encoding.

---

## 5. Fase 2 — Dependencias

### 5.1 Flutter (`pubspec.yaml` + `pubspec.lock`)

- **`pubspec.lock` existe y está versionado:** sí — `git ls-files` lo lista (entrada `pubspec.lock`). `package-lock.json` de backend ídem (entrada `backend/package-lock.json`).
- **Dependencias con rango sin fijar:** exactamente **una**: `intl: any` (pubspec.yaml:63). Resuelta en lock a `intl 0.20.2` (pubspec.lock, bloque `intl`, version "0.20.2"). Riesgo: un `pub upgrade` futuro puede saltar de major sin aviso. Recomendación: fijar `intl: ^0.20.2`. El resto de dependencias usan caret (`^x.y.z`).
- **Paquetes discontinued** (salida de `flutter pub outdated`): `build_resolvers` (transitiva dev), `build_runner_core` (transitiva dev), `js 0.6.7` (transitiva dev). Los tres son **dev/transitivas**: no se empaquetan en la app; afectan solo a `build_runner`. Sin impacto en producción.
- **`flutter pub outdated`:** 121 paquetes con versión mayor disponible incompatible con constraints actuales. Los saltos de major pendientes más relevantes (columna Latest): `flutter_riverpod 2.6.1→3.3.2`, `go_router 13.2.5→17.3.0`, `fl_chart 0.66.2→1.2.0`, `syncfusion_* 28.2.12→33.2.12`, `sentry_flutter 8.14.2→9.22.0`, `geolocator 11→14`, `share_plus 7→13`, `freezed 2.5.2→3.2.5`. **Ninguno es bloqueante hoy** (el lock congela versiones funcionales y `pub get` resuelve limpio); es deuda de actualización planificable. Tabla completa de `flutter pub outdated` archivada en la salida del comando (resumen: 47 upgradables bloqueados por lock, 22 limitados por constraints).

### 5.2 Backend (`package.json` + `package-lock.json`)

- **Rangos:** todas las dependencias usan caret estándar; **no hay `*`, `latest` ni `any`** (package.json:42-103).
- **`npm ls --depth=0`:** exit 0; árbol completo sin `UNMET DEPENDENCY`, `missing` ni `invalid` → instalación coherente con `package-lock.json`.
- **`npm audit`: 19 vulnerabilidades (9 moderate, 10 high).** Análisis de impacto real:

| Paquete | Severidad | Advisory | ¿Impacto real en runtime de producción? |
|---|---|---|---|
| `qs` (vía `express@4.22.1` y `body-parser`) | moderate | GHSA-q8mj-m7cp-5q26 (DoS en qs.stringify) | **Sí — runtime**: express está en el path de cada request. Fix no-breaking: `npm audit fix` |
| `ws@8.19.0` | moderate | GHSA-58qx-3vcg-4xpx (exposición de memoria no inicializada) | **Sí — runtime**: `ws` es dependencia directa (websocket-cache-manager). Fix no-breaking: `npm audit fix` |
| `nodemailer@7.0.13` | moderate | GHSA-c7w3-x93f-qmm8 / GHSA-vvjj-xcjg-gr5g (inyección de comandos SMTP vía CRLF) | **Sí — runtime** si se envían emails con datos externos en transport/envelope. Fix marcado breaking (`nodemailer@8`) — planificar |
| `joi@17.13.3` | moderate | GHSA-q7cg-457f-vx79 (RangeError con input anidado profundo) | **Sí — runtime** (joi valida input de usuario). Fix breaking (`joi@18`) — planificar; mitigable con límites de tamaño de body ya existentes |
| `tar` (vía `@tensorflow/tfjs-node` y `bcrypt`→`node-pre-gyp`) | high | 6 advisories (path traversal en extracción) | **No en runtime de requests** — `tar` se usa en instalación de binarios nativos (`npm install`), no procesa archivos de usuarios. Riesgo limitado a cadena de suministro en builds |
| `minimatch` (vía `@typescript-eslint/*`) | high | 3 advisories ReDoS | **No** — devDependencies (lint), no se despliega |
| `uuid@9.0.1` (directa) y vía `jest-junit` | moderate | GHSA-w5hq-g745-h8pq (bounds check en v3/v5/v6 con `buf`) | **Bajo** — el código usa `uuidv4()` (p. ej. cobros.js:12 `const { v4: uuidv4 }`); la vulnerabilidad afecta a v3/v5/v6 con parámetro buf |
| `brace-expansion` (vía `@fastify/otel`, dep de Sentry) | moderate | GHSA-jxxr-4gwj-5jf2 (DoS) | **Bajo** — path de instrumentación, no input de usuario. Fix no-breaking: `npm audit fix` |

  Acción recomendada hoy (no rompe nada según npm): **`npm audit fix`** (sin `--force`) en backend/ → corrige qs/express, ws, minimatch y brace-expansion. `nodemailer@8` y `joi@18` son breaking: programar para después de la presentación.
- **Nota:** `xss-clean@0.1.4` (package.json:77) es un paquete archivado/sin mantenimiento desde hace años (deprecation conocida del ecosistema); npm audit no reporta CVE pero conviene sustituirlo a medio plazo.

---

## 6. BLOQUEANTES (debe resolverse hoy)

**Resultado de Fases 0-2: CERO bloqueantes técnicos duros** (confirmado en re-verificación 2026-06-12 tras fixes de otros agentes).

- `flutter analyze`: **0 errores**. 2 warnings (conflict_resolver.dart:185, :273 — infra offline 🟡) — sin cambio respecto a la ejecución inicial; no bloquean las 3 pestañas.
- `node --check`: **0 fallos** en 206 archivos (re-run 2026-06-12).
- Marcadores: **0 BLOQUEANTES** — re-escaneo 2026-06-12 confirma los mismos 11 TODO/FIXME/HACK (7 lib, 4 backend TS inactivo); ninguno en código activo de Pedidos/Cobros/Bolsa.
- Locks: ambos existen y están versionados.
- `npm audit`: **19 vulnerabilidades** sin cambio; **`npm audit fix` aún no aplicado** en el working tree.

**Acciones recomendadas HOY (bajo riesgo, alto valor antes de la presentación):**

| # | Acción | Motivo | Riesgo de aplicar |
|---|---|---|---|
| 1 | `cd backend && npm audit fix` (sin `--force`) + `npx jest` de verificación | Elimina las vulnerabilidades runtime no-breaking (qs/express DoS, ws memory disclosure) | Bajo (cambios semver-compatibles); verificar con suite de tests |
| 2 | Fijar `intl: ^0.20.2` en pubspec.yaml | Único rango sin fijar; evita saltos de major accidentales | Nulo (la versión instalada no cambia) |
| 3 | Limpiar residuos de raíz: borrar `Driver`, `v`; valorar `git rm` de `Simple` y `lib/features/pedidos/presentation/pages/pedidos_page_first.txt` | Higiene del repo antes de release; `Driver` expone el listado de DSNs de la máquina | Nulo |

**Para esta semana (no hoy):** corregir los 2 warnings de `conflict_resolver.dart`; eliminar código muerto `api_client_secure.dart` y `pedidos_provider_v3.dart` (+`cache_service_optimized.dart` si `stream_chain` se migra); migrar `nodemailer@8` y `joi@18`; corregir mojibake en client_detail_page.dart:575 y pedidos.service.js:3278; sacar de git los CSVs con datos de clientes de `backend/kpi/tmp/`.

---

## Apéndice A — Inventario completo clasificado

Generado por reglas deterministas de clasificación (prefijos + listas explícitas) sobre la instantánea final de `git ls-files` + untracked; cada archivo aparece exactamente en una categoría.

Instantánea tomada a las 00:37 del 2026-06-12 (hora local; la auditoría empezó el 2026-06-11 a las 23:21). Total inventariado: 1.300 archivos (1.259 trackeados + 41 untracked; gitlink `pixel-agents` excluido, ver 2.1). Entre la primera captura (23:22, 37 untracked) y esta, los agentes en paralelo crearon 4 archivos nuevos (`pilar2-*`).

### A.1 🔴 CRÍTICO (95 archivos)

| Archivo | Motivo |
|---|---|
| `backend/__tests__/bolsa_route_contracts.test.js` | Tests de contrato de la ruta de Bolsa (untracked, nuevo) |
| `backend/__tests__/bolsa-comercial.service.test.js` | Tests del servicio de Bolsa |
| `backend/__tests__/cobros_route_contracts.test.js` | Tests de contrato de rutas de Cobros (untracked, nuevo) |
| `backend/__tests__/cobros-commercial.test.js` | Tests de Cobros (comercial) |
| `backend/__tests__/cobros-legacy.test.js` | Tests de Cobros (ruta legacy) |
| `backend/__tests__/ddd_route_contracts.test.js` | Tests de contratos de rutas DDD (pedidos/cobros) |
| `backend/__tests__/dsedac-exports.service.test.js` | Tests del servicio dsedac-exports usado por Cobros (untracked, nuevo) |
| `backend/__tests__/pedidos.test.js` | Tests de Pedidos |
| `backend/__tests__/pedidos_contracts.test.js` | Tests de contrato de Pedidos |
| `backend/__tests__/pedidos_reparto_contracts.test.js` | Tests de contrato Pedidos-reparto |
| `backend/__tests__/pedidos_stock_route_contracts.test.js` | Tests de contrato de stock en Pedidos (untracked, nuevo) |
| `backend/routes/bolsa.js` | Ruta API /api/bolsa (server.js:475) |
| `backend/routes/cobros.js` | Ruta API legacy /api/cobros (fallback DDD, server.js:499) |
| `backend/routes/pedidos.js` | Ruta API legacy /api/pedidos (fallback DDD, server.js:498) |
| `backend/services/bolsa-comercial.service.js` | Servicio DB2 de Bolsa comercial (bolsa.js:6) |
| `backend/services/dsedac-exports.service.js` | Usado por el repositorio DDD de Cobros (db2-cobros-repository.js:890) |
| `backend/services/laclae.js` | getClientDays requerido por pedidos.service.js:45 (dias de visita) |
| `backend/services/pedidos.service.js` | Servicio DB2 de Pedidos (pedidos.js:36) |
| `backend/src/modules/cobros/application/get-pendientes-usecase.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/cobros/application/register-payment-usecase.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/cobros/domain/cobro.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/cobros/domain/cobros-repository.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/cobros/index.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` | Modulo DDD de Cobros (montado en /api/cobros, server.js:482) |
| `backend/src/modules/pedidos/application/confirm-order-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/application/get-order-history-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/application/get-order-stats-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/application/get-product-detail-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/application/get-promotions-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/application/search-products-usecase.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/domain/pedidos-repository.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/domain/product.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/index.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/modules/pedidos/infrastructure/db2-pedidos-repository.js` | Modulo DDD de Pedidos (montado en /api/pedidos, server.js:481) |
| `backend/src/shared/routes/ddd-adapters.js` | Adaptadores DDD: importa repos de Pedidos y Cobros (lineas 19-20) |
| `lib/features/bolsa/data/bolsa_models.dart` | Frontend de la pestana Bolsa comercial |
| `lib/features/bolsa/data/bolsa_service.dart` | Frontend de la pestana Bolsa comercial |
| `lib/features/bolsa/presentation/pages/bolsa_page.dart` | Frontend de la pestana Bolsa comercial |
| `lib/features/bolsa/presentation/widgets/bolsa_monthly_chart.dart` | Frontend de la pestana Bolsa comercial |
| `lib/features/bolsa/providers/bolsa_provider.dart` | Frontend de la pestana Bolsa comercial |
| `lib/features/cobros/data/models/cobros_models.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/pages/cobro_detail_screen.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/pages/cobros_page.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/widgets/albaran_card.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/widgets/cobros_filters.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/widgets/cobros_summary_card.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/presentation/widgets/entrega_detail_sheet.dart` | Frontend de la pestana Cobros |
| `lib/features/cobros/providers/cobros_provider.dart` | Frontend de la pestana Cobros |
| `lib/features/pedidos/data/pedidos_favorites_service.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/data/pedidos_offline_service.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/data/pedidos_order_api.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/data/pedidos_service.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/dialogs/client_search_dialog.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/dialogs/delete_line_dialog.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/dialogs/price_warning_dialog.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/pages/pedidos_page.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/pages/promotion_detail_page.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/pages/promotions_list_page.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/utils/pedidos_formatters.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/add_to_order_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/albaran_info_dialog.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/analytics_dashboard.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/client_balance_badge.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/complementary_products.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/drafts_bottom_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/mis_pedidos_yoy_bar.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_card.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_detail_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_empty_state.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_filters_bar.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_kpi_dashboard.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_line_tile.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_pdf_generator.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_preview_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_status_badge.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_summary_widget.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/order_trend_chart.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/product_card.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/product_comparative_strip.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/product_detail_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/product_history_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/product_search_widget.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/promotions_banner.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/recommendations_section.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/sale_type_selector.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/tarifa_selector_modal.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/presentation/widgets/unit_selector_modal.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/providers/pedidos_provider.dart` | Frontend de la pestana Pedidos |
| `lib/features/pedidos/providers/pedidos_provider_v3.dart` | Frontend de la pestana Pedidos |
| `test/features/bolsa/bolsa_models_test.dart` | Tests de logica de negocio de Pedidos/Cobros/Bolsa |
| `test/features/cobros/cobros_business_logic_test.dart` | Tests de logica de negocio de Pedidos/Cobros/Bolsa |
| `test/features/pedidos/pedidos_business_logic_test.dart` | Tests de logica de negocio de Pedidos/Cobros/Bolsa |
| `test/features/pedidos_order_api_test.dart` | Tests de logica de negocio de Pedidos/Cobros/Bolsa |
| `test/widgets/order_status_badge_test.dart` | Test del widget de estado de pedido (Pedidos) |

### A.2 🟡 RELACIONADO (240 archivos)

| Archivo | Motivo |
|---|---|
| `.github/ISSUE_TEMPLATE/ci-failure.md` | CI/CD (workflows y scripts) |
| `.github/scripts/auto-fix.sh` | CI/CD (workflows y scripts) |
| `.github/scripts/build-context.py` | CI/CD (workflows y scripts) |
| `.github/scripts/classify-failure.js` | CI/CD (workflows y scripts) |
| `.github/scripts/failure-report.js` | CI/CD (workflows y scripts) |
| `.github/scripts/print-classification.py` | CI/CD (workflows y scripts) |
| `.github/workflows/backend-ci.yml` | CI/CD (workflows y scripts) |
| `.github/workflows/ci-cd.yml` | CI/CD (workflows y scripts) |
| `.github/workflows/ci-self-heal.yml` | CI/CD (workflows y scripts) |
| `.github/workflows/flutter-ci.yml` | CI/CD (workflows y scripts) |
| `.github/workflows/opencode.yml` | CI/CD (workflows y scripts) |
| `.gitignore` | Configuracion de proyecto/build |
| `.metadata` | Configuracion de proyecto/build |
| `analysis_options.yaml` | Configuracion de proyecto/build |
| `android/.gitignore` | Plataforma Android: target de despliegue de la app |
| `android/.project` | Plataforma Android: target de despliegue de la app |
| `android/.settings/org.eclipse.buildship.core.prefs` | Plataforma Android: target de despliegue de la app |
| `android/app/.classpath` | Plataforma Android: target de despliegue de la app |
| `android/app/.project` | Plataforma Android: target de despliegue de la app |
| `android/app/.settings/org.eclipse.buildship.core.prefs` | Plataforma Android: target de despliegue de la app |
| `android/app/build.gradle.kts` | Plataforma Android: target de despliegue de la app |
| `android/app/proguard-rules.pro` | Plataforma Android: target de despliegue de la app |
| `android/app/src/debug/AndroidManifest.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/AndroidManifest.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/kotlin/com/maripepa/gmp_mobilidad/MainActivity.kt` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/play/release-notes/es-ES/default.txt` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/drawable/launch_background.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/drawable-v21/launch_background.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-hdpi/launcher_icon.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-mdpi/launcher_icon.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xhdpi/launcher_icon.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xxhdpi/launcher_icon.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/mipmap-xxxhdpi/launcher_icon.png` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/values/styles.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/main/res/values-night/styles.xml` | Plataforma Android: target de despliegue de la app |
| `android/app/src/profile/AndroidManifest.xml` | Plataforma Android: target de despliegue de la app |
| `android/build.gradle.kts` | Plataforma Android: target de despliegue de la app |
| `android/gradle.properties` | Plataforma Android: target de despliegue de la app |
| `android/gradle/wrapper/gradle-wrapper.properties` | Plataforma Android: target de despliegue de la app |
| `android/settings.gradle.kts` | Plataforma Android: target de despliegue de la app |
| `backend/.env.example` | Configuracion/build/deploy del backend |
| `backend/.gitignore` | Configuracion/build/deploy del backend |
| `backend/__tests__/audit-log.service.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/auth.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/cache_preloader_contracts.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/middleware/auth-middleware.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/query-optimizer-compat.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/routes-unit.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/security-middleware.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/__tests__/services-unit.test.js` | Tests de infraestructura compartida (auth/seguridad/cache/rutas) |
| `backend/config/db.js` | Configuracion DB2/entorno (db.js requerido por cobros.js:8 y pedidos.service.js:8) |
| `backend/config/env.js` | Configuracion DB2/entorno (db.js requerido por cobros.js:8 y pedidos.service.js:8) |
| `backend/config/feature-flags.js` | Configuracion DB2/entorno (db.js requerido por cobros.js:8 y pedidos.service.js:8) |
| `backend/Dockerfile` | Configuracion/build/deploy del backend |
| `backend/ecosystem.config.js` | Configuracion/build/deploy del backend |
| `backend/instrument.js` | Inicializacion Sentry del server |
| `backend/jest.config.js` | Configuracion/build/deploy del backend |
| `backend/middleware/audit.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/auth.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/auth.ts` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/auto-cache.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/compression.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/http-cache.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/logger.d.ts` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/logger.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/network-optimizer.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/prometheus-metrics.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/security.js` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/middleware/security.ts` | Middleware compartido del server (auth/logger/security/cache) |
| `backend/package.json` | Configuracion/build/deploy del backend |
| `backend/package-lock.json` | Configuracion/build/deploy del backend |
| `backend/server.js` | Servidor Express: monta /api/pedidos, /api/cobros y /api/bolsa (lineas 475-499) |
| `backend/services/audit-log.service.js` | Auditoria transversal de acciones |
| `backend/services/cache-preloader.js` | Precarga de cache compartida |
| `backend/services/circuit-breaker.js` | Circuit breaker requerido por pedidos.service.js:44 |
| `backend/services/circuit-breaker-monitor.js` | Monitorizacion del circuit breaker |
| `backend/services/metadataCache.js` | Infra de cache compartida |
| `backend/services/ml/predictive-cache.js` | Infra de cache predictiva compartida |
| `backend/services/pattern-learner.js` | Infra de cache predictiva compartida |
| `backend/services/query-optimizer.js` | cachedQuery usado por cobros.js:9 y pedidos.service.js:25 |
| `backend/services/redis-cache.js` | Cache Redis: TTL/invalidacion usados por pedidos/cobros/bolsa |
| `backend/services/request-coalescing.js` | Infra de cache compartida |
| `backend/services/websocket-cache-manager.js` | Infra de cache compartida (usa ws) |
| `backend/src/core/application/use-case.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/domain/entity.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/domain/repository.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/domain/value-object.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/cache/cache-preloader.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/cache/performance-cache.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/cache/performance-cache.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/cache/redis-cache.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/cache/response-cache.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/database/db2-connection-pool.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/database/db2-connection-pool.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/advanced-rate-limiter.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/advanced-rate-limiter.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/input-validator.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/path-sanitizer.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/refresh-token-manager.js` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/core/infrastructure/security/refresh-token-manager.ts` | Infraestructura DDD compartida (pool DB2/cache/seguridad) usada por modulos Pedidos/Cobros |
| `backend/src/modules/auth/application/login-usecase.js` | Modulo DDD de autenticacion (login previo, server.js:480) |
| `backend/src/modules/auth/domain/auth-repository.js` | Modulo DDD de autenticacion (login previo, server.js:480) |
| `backend/src/modules/auth/domain/user.js` | Modulo DDD de autenticacion (login previo, server.js:480) |
| `backend/src/modules/auth/index.js` | Modulo DDD de autenticacion (login previo, server.js:480) |
| `backend/src/modules/auth/infrastructure/db2-auth-repository.js` | Modulo DDD de autenticacion (login previo, server.js:480) |
| `backend/src/shared/middleware/index.js` | Middleware/utilidades compartidas DDD |
| `backend/tests/setup.js` | Setup de jest |
| `backend/tsconfig.json` | Configuracion/build/deploy del backend |
| `backend/utils/common.js` | Utilidades compartidas: LACLAE_SALES_FILTER usado por Pedidos (pedidos.js:42) |
| `backend/utils/db2-identifiers.js` | Helpers de identificadores DB2 (cobros.js:13, pedidos.service.js:9) |
| `backend/utils/salesQuery.js` | Consultas de ventas compartidas |
| `devtools_options.yaml` | Configuracion de proyecto/build |
| `docker-compose.yml` | Configuracion de proyecto/build |
| `lib/core/api/api_client.dart` | Cliente HTTP/config de API usados por los servicios de las 3 pestanas |
| `lib/core/api/api_client_secure.dart` | Cliente HTTP/config de API usados por los servicios de las 3 pestanas |
| `lib/core/api/api_config.dart` | Cliente HTTP/config de API usados por los servicios de las 3 pestanas |
| `lib/core/api/isolate_transformer.dart` | Cliente HTTP/config de API usados por los servicios de las 3 pestanas |
| `lib/core/cache/cache_keys.dart` | Cache local usada por los servicios |
| `lib/core/cache/cache_service.dart` | Cache local usada por los servicios |
| `lib/core/cache/cache_service_optimized.dart` | Cache local usada por los servicios |
| `lib/core/config/feature_flags.dart` | Feature flags compartidos |
| `lib/core/memory/agent_database.dart` | Capa de memoria/colas offline compartida |
| `lib/core/memory/data_migration.dart` | Capa de memoria/colas offline compartida |
| `lib/core/memory/memory.dart` | Capa de memoria/colas offline compartida |
| `lib/core/memory/reasoning_bank.dart` | Capa de memoria/colas offline compartida |
| `lib/core/memory/unified_memory_layer.dart` | Capa de memoria/colas offline compartida |
| `lib/core/memory/vector_store_hnsw.dart` | Capa de memoria/colas offline compartida |
| `lib/core/models/dashboard_models.dart` | Modelos compartidos |
| `lib/core/models/estado_entrega.dart` | Modelos compartidos |
| `lib/core/models/user_model.dart` | Modelos compartidos |
| `lib/core/navigation/navigation_service.dart` | Navegacion entre pestanas |
| `lib/core/navigation/tab_definition.dart` | Navegacion entre pestanas |
| `lib/core/offline/conflict_resolver.dart` | Infraestructura offline/precarga compartida |
| `lib/core/offline/connectivity_provider.dart` | Infraestructura offline/precarga compartida |
| `lib/core/offline/data_preloader.dart` | Infraestructura offline/precarga compartida |
| `lib/core/offline/offline_aware_api.dart` | Infraestructura offline/precarga compartida |
| `lib/core/offline/sync_queue_service.dart` | Infraestructura offline/precarga compartida |
| `lib/core/providers/auth_notifier.dart` | Providers core (auth/dashboard/filtros) usados por las paginas |
| `lib/core/providers/dashboard_notifier.dart` | Providers core (auth/dashboard/filtros) usados por las paginas |
| `lib/core/providers/filter_provider.dart` | Providers core (auth/dashboard/filtros) usados por las paginas |
| `lib/core/providers/pending_client_provider.dart` | Providers core (auth/dashboard/filtros) usados por las paginas |
| `lib/core/router/app_router.dart` | Router de la app |
| `lib/core/services/analytics_service.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/cache_prewarmer.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/device_fingerprint.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/isolate_pool_service.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/memoization_service.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/navigation_config_service.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/network_service.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/services/secure_storage.dart` | Servicios transversales (red, storage, navegacion) |
| `lib/core/theme/app_colors.dart` | Tema y colores centralizados |
| `lib/core/theme/app_theme.dart` | Tema y colores centralizados |
| `lib/core/theme/futuristic_theme.dart` | Tema y colores centralizados |
| `lib/core/theme/theme_provider.dart` | Tema y colores centralizados |
| `lib/core/utils/app_logger.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/benchmark.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/compute_helpers.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/currency_formatter.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/date_formatter.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/formatters.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/responsive.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/stream_chain.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/utils/vendor_scope.dart` | Utilidades compartidas (formato moneda/fecha, responsive) |
| `lib/core/widgets/accessibility_widgets.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/async_operation_modal.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/coming_soon_placeholder.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/email_form_modal.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/empty_state_widget.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/error_state_widget.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/fi_filters_widget.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/fullscreen_image_viewer.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/futuristic_widgets.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/global_vendor_selector.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/lazy_indexed_stack.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/modern_loading.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/multi_select_dialog.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/optimized_list.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/pdf_preview_screen.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/premium_card.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/premium_fab.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/premium_refresh.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/premium_route.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/safe_lazy_builder.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/shimmer_skeleton.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/smart_product_image.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/smart_sync_header.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/core/widgets/whatsapp_form_modal.dart` | Widgets compartidos usados por las paginas de las pestanas |
| `lib/features/dashboard/presentation/pages/main_shell.dart` | Shell de navegacion que aloja las pestanas Pedidos/Cobros/Bolsa |
| `lib/main.dart` | Bootstrap de la app: inicializa providers y API antes de las pestanas |
| `Makefile` | Configuracion de proyecto/build |
| `pubspec.lock` | Configuracion de proyecto/build |
| `pubspec.yaml` | Configuracion de proyecto/build |
| `scripts/build.ps1` | Scripts de build/desarrollo/deploy |
| `scripts/build.sh` | Scripts de build/desarrollo/deploy |
| `scripts/deploy.sh` | Scripts de build/desarrollo/deploy |
| `scripts/dev.ps1` | Scripts de build/desarrollo/deploy |
| `scripts/dev.sh` | Scripts de build/desarrollo/deploy |
| `scripts/security-setup.bat` | Scripts de build/desarrollo/deploy |
| `scripts/security-setup.sh` | Scripts de build/desarrollo/deploy |
| `scripts/verify.ps1` | Scripts de build/desarrollo/deploy |
| `test/api/api_config_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/app_logger_comprehensive_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/app_logger_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/memory/agent_database_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/memory/reasoning_bank_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/models_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/core/navigation_config_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/helpers/formatters_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/helpers/iva_calculator_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/integration/navigation_full_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/integration/navigation_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/models/albaran_entrega_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/models/dashboard_metrics_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/models/dashboard_models_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/navigation_edge_cases_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/providers/auth_state_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/providers/basic_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/providers/filter_provider_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/services/navigation_config_detailed_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/theme/app_colors_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/utils/responsive_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/utils/string_utils_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widget_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/accessibility_widgets_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/coming_soon_placeholder_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/core_widgets_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/email_form_modal_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/kpi_card_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/lazy_indexed_stack_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/multi_select_dialog_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/optimized_list_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/shimmer_skeleton_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/skeleton_widgets_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/smart_product_image_test.dart` | Tests de infra/navegacion/widgets compartidos |
| `test/widgets/smart_sync_header_test.dart` | Tests de infra/navegacion/widgets compartidos |

### A.3 ⚪ FUERA DE SCOPE (965 archivos)

| Archivo | Motivo de exclusion |
|---|---|
| `.agent/nhallucinate/lessons-learned.md` | Config de agentes IA/editores - no producto |
| `.agent/nhallucinate/memory.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/source-command-opsx-apply/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/source-command-opsx-archive/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/source-command-opsx-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.agents/skills/source-command-opsx-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.beads/.gitignore` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/config.yaml` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/post-checkout` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/post-merge` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/pre-commit` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/pre-commit.bak` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/prepare-commit-msg` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/hooks/pre-push` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/interactions.jsonl` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/issues.jsonl` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/metadata.json` | Issue tracker beads (exports/hooks) - no producto |
| `.beads/README.md` | Issue tracker beads (exports/hooks) - no producto |
| `.codex/config.toml` | Config de agentes IA/editores - no producto |
| `.codex/hooks.json` | Config de agentes IA/editores - no producto |
| `.continue/prompts/opsx-apply.prompt` | Config de agentes IA/editores - no producto |
| `.continue/prompts/opsx-archive.prompt` | Config de agentes IA/editores - no producto |
| `.continue/prompts/opsx-explore.prompt` | Config de agentes IA/editores - no producto |
| `.continue/prompts/opsx-propose.prompt` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.continue/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.cursor/settings.json` | Config de agentes IA/editores - no producto |
| `.husky/pre-commit` | Hooks git (tooling) |
| `.husky/pre-commit.bak` | Hooks git (tooling) |
| `.mcp.json` | Config de agentes IA/tooling - no producto |
| `.omo/run-continuation/ses_1965f189cffeMlRMQJbGkC8hr3.json` | Config de agentes IA/editores - no producto |
| `.omo/run-continuation/ses_19745179fffeNfsLLtK4XR6NvW.json` | Config de agentes IA/editores - no producto |
| `.omo/run-continuation/ses_1974a631effeY3XfXe1edf76mI.json` | Config de agentes IA/editores - no producto |
| `.openclawignore` | Config de agentes IA/tooling - no producto |
| `.qoder/commands/opsx/apply.md` | Config de agentes IA/editores - no producto |
| `.qoder/commands/opsx/archive.md` | Config de agentes IA/editores - no producto |
| `.qoder/commands/opsx/explore.md` | Config de agentes IA/editores - no producto |
| `.qoder/commands/opsx/propose.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qoder/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/commands/opsx-apply.toml` | Config de agentes IA/editores - no producto |
| `.qwen/commands/opsx-archive.toml` | Config de agentes IA/editores - no producto |
| `.qwen/commands/opsx-explore.toml` | Config de agentes IA/editores - no producto |
| `.qwen/commands/opsx-propose.toml` | Config de agentes IA/editores - no producto |
| `.qwen/settings.json` | Config de agentes IA/editores - no producto |
| `.qwen/settings.json.orig` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.qwen/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.trae/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.vscode/settings.json` | Config de editor - no producto |
| `.windsurf/skills/caveman/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-commit/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/README.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/__init__.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/__main__.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/benchmark.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/cli.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/compress.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/detect.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/scripts/validate.py` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/SECURITY.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-compress/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-help/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/caveman-review/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/openspec-apply-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/openspec-archive-change/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/openspec-explore/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/skills/openspec-propose/SKILL.md` | Config de agentes IA/editores - no producto |
| `.windsurf/workflows/opsx-apply.md` | Config de agentes IA/editores - no producto |
| `.windsurf/workflows/opsx-archive.md` | Config de agentes IA/editores - no producto |
| `.windsurf/workflows/opsx-explore.md` | Config de agentes IA/editores - no producto |
| `.windsurf/workflows/opsx-propose.md` | Config de agentes IA/editores - no producto |
| `AGENTS.md` | Documentacion de proyecto |
| `android/build/reports/problems/problems-report.html` | Artefacto de build trackeado (residuo) |
| `android/build_log.txt` | Artefacto de build trackeado (residuo) |
| `ARCHITECTURE.md` | Documentacion de proyecto |
| `ARQUITECTURA.md` | Documentacion de proyecto |
| `assets/icon/app_icon.png` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/index.html` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/CSS2DRenderer.global.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/CSS2DRenderer.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/OrbitControls.global.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/OrbitControls.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/three.global.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/lib/three.module.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/load_planner_3d.global.js` | Assets de la app (visor 3D load planner, icono) |
| `assets/load_planner/load_planner_3d.js` | Assets de la app (visor 3D load planner, icono) |
| `backend/__tests__/commission-snapshot.test.js` | Test de otra feature |
| `backend/__tests__/commissions-pdf-service.test.js` | Test de otra feature |
| `backend/__tests__/email-pdf-service.test.js` | Test de otra feature |
| `backend/__tests__/entregas-email-route.test.js` | Test de otra feature |
| `backend/__tests__/evolution.service.test.js` | Test de otra feature |
| `backend/__tests__/facturas-service.test.js` | Test de otra feature |
| `backend/__tests__/objectives_by_client_contracts.test.js` | Test de otra feature |
| `backend/__tests__/objectives-hybrid.test.js` | Test de otra feature |
| `backend/__tests__/planner-rutero-day.test.js` | Test de otra feature |
| `backend/__tests__/repartidor-finanzas.test.js` | Test de otra feature |
| `backend/__tests__/repartidor-route-params.test.js` | Test de otra feature |
| `backend/__tests__/team-commission.service.test.js` | Test de otra feature |
| `backend/__tests__/vendor-column-transition.test.js` | Test de otra feature |
| `backend/__tests__/ventas-b-helpers.test.js` | Test de otra feature |
| `backend/app/services/deliveryReceiptService.js` | Servicios legacy de entregas/email/pdf (otra feature) |
| `backend/app/services/emailService.js` | Servicios legacy de entregas/email/pdf (otra feature) |
| `backend/app/services/pdfService.js` | Servicios legacy de entregas/email/pdf (otra feature) |
| `backend/assets/header.png` | Assets backend (cabecera email) |
| `backend/audit/anomalies.csv` | Artefactos de auditorias anteriores |
| `backend/audit/fix_proposals.diff` | Artefactos de auditorias anteriores |
| `backend/audit/report.json` | Artefactos de auditorias anteriores |
| `backend/audit/runbook.md` | Artefactos de auditorias anteriores |
| `backend/audit/scripts/fix_anomalies.js` | Artefactos de auditorias anteriores |
| `backend/audit/scripts/investigate_f14678.js` | Artefactos de auditorias anteriores |
| `backend/audit/scripts/scan_anomalies.js` | Artefactos de auditorias anteriores |
| `backend/audit/scripts/verify_fixes.js` | Artefactos de auditorias anteriores |
| `backend/create_view.js` | Script puntual de creacion de vistas en raiz de backend |
| `backend/create_view_final.js` | Script puntual de creacion de vistas en raiz de backend |
| `backend/create_view_full.js` | Script puntual de creacion de vistas en raiz de backend |
| `backend/create_view_v2.js` | Script puntual de creacion de vistas en raiz de backend |
| `backend/docs/PRODUCTION_CHECKLIST.md` | Documentacion backend |
| `backend/docs/recommended-indices.sql` | Documentacion backend |
| `backend/docs/VENTAS_B_documentacion.md` | Documentacion backend |
| `backend/kpi/__tests__/alert_rules.test.js` | Modulo KPI/ETL independiente |
| `backend/kpi/__tests__/csv_parser.test.js` | Modulo KPI/ETL independiente |
| `backend/kpi/config/db.js` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Altas_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Clientes_ConCuotaSinCompra.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Desviacion_Referenciacion.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Desviacion_Ventas.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Medios_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Mensaje_Promociones.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/csv_samples/Mensajes_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/docker-compose.yml` | Modulo KPI/ETL independiente |
| `backend/kpi/Dockerfile` | Modulo KPI/ETL independiente |
| `backend/kpi/index.js` | Modulo KPI/ETL independiente |
| `backend/kpi/migrations/001_initial_schema.js` | Modulo KPI/ETL independiente |
| `backend/kpi/migrations/migrate.js` | Modulo KPI/ETL independiente |
| `backend/kpi/README.md` | Modulo KPI/ETL independiente |
| `backend/kpi/routes.js` | Modulo KPI/ETL independiente |
| `backend/kpi/sample_alerts.json` | Modulo KPI/ETL independiente |
| `backend/kpi/schema.sql` | Modulo KPI/ETL independiente |
| `backend/kpi/schema_db2.sql` | Modulo KPI/ETL independiente |
| `backend/kpi/services/alert_rules.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/alert_transformer.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/csv_parser.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/email_notification.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/etl_orchestrator.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/metrics.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/redis_cache.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/scheduler.js` | Modulo KPI/ETL independiente |
| `backend/kpi/services/sftp_client.js` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Altas_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Clientes_ConCuotaSinCompra.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Desviacion_Referenciacion.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Desviacion_Ventas.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Medios_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Mensaje_Promociones.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779180789582/Mensajes_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Altas_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Clientes_ConCuotaSinCompra.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Desviacion_Referenciacion.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Desviacion_Ventas.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Medios_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Mensaje_Promociones.csv` | Modulo KPI/ETL independiente |
| `backend/kpi/tmp/sftp_1779181271131/Mensajes_Clientes.csv` | Modulo KPI/ETL independiente |
| `backend/migrations/001_snapshot_jan_feb_2026.sql` | Migraciones puntuales |
| `backend/migrations/DEPLOYMENT_GUIDE.md` | Migraciones puntuales |
| `backend/migrations/init-tables.js` | Migraciones puntuales |
| `backend/migrations/schema-audit.js` | Migraciones puntuales |
| `backend/routes/analytics.js` | Ruta API de otra feature |
| `backend/routes/auth.js` | Ruta API de otra feature |
| `backend/routes/auth.ts` | Ruta API de otra feature |
| `backend/routes/chatbot.js` | Ruta API de otra feature |
| `backend/routes/clients.js` | Ruta API de otra feature |
| `backend/routes/commissions.js` | Ruta API de otra feature |
| `backend/routes/dashboard.js` | Ruta API de otra feature |
| `backend/routes/entregas.js` | Ruta API de otra feature |
| `backend/routes/evolution.js` | Ruta API de otra feature |
| `backend/routes/export.js` | Ruta API de otra feature |
| `backend/routes/facturas.js` | Ruta API de otra feature |
| `backend/routes/filters.js` | Ruta API de otra feature |
| `backend/routes/health.js` | Ruta API de otra feature |
| `backend/routes/master.js` | Ruta API de otra feature |
| `backend/routes/objectives.js` | Ruta API de otra feature |
| `backend/routes/objectives-hybrid-helpers.js` | Ruta API de otra feature |
| `backend/routes/planner.js` | Ruta API de otra feature |
| `backend/routes/products.js` | Ruta API de otra feature |
| `backend/routes/repartidor.js` | Ruta API de otra feature |
| `backend/routes/repartidor-finanzas.js` | Ruta API de otra feature |
| `backend/routes/user-actions.js` | Ruta API de otra feature |
| `backend/routes/warehouse.js` | Ruta API de otra feature |
| `backend/scripts/agent1-dsedac-discovery.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/agent3-column-mapping.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/align-javier-dsedac-additive.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/audit_server.bat` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/audit_server_linux.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/benchmark-endpoints.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/build.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/check_config_data.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/check-cpc-join.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/check-firmas-columns.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/check-vendor-05.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/cleanup-repartidor-finance-test-data.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/compare-javier-dsedac-alignment.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/compare-schemas.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/create_v_dim_cliente.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db_create_indexes.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db2_inventory.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db2_inventory2.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db2_inventory3.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db2_inventory4.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db2-connection.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/db-indices.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/diag_vendor05.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/diagnose-cpc-join.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/diagnose-ddl.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/diagnostic.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/discover-dsedac-columns.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/discover-vista-unificada.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/erp_cobros_inventory.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/erp_diff_condensed.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/execute-vista-unificada.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/explore_tables.ts` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/final-objectives.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/find_comerciales.ts` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/find_vendedores.ts` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/find-dsedac-equivalents.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/find-limite-riesgo.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/find-physical-files.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/fix_main_shell.py` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/full-schema-audit.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/generate_align_migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/generate-vista-deuda-completa.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/generate-vista-deuda-final.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/generate-vista-unificada-sql.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/install_server.bat` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/list-all-tables.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/log-rotation.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/migrate-pin-hashes.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/monitor-activity.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pedidos_system_inventory.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-align-defaults-additive.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-build-report.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-catalog-audit.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-crud-smoke.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-db-schema-verify.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-integrity-checks.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-perf-checks.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-render-comparison.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-render-pending-ddl.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-sql-runner.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/pilar2-views-smoke.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/powerbi_export.py` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/repartidor_finance_db_inventory.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/agent1-dsedac-mapping.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/agent2-code-audit.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/agent3-column-mapping.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/agent4-doc-analysis.md` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/dsedac-column-discovery.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/final-audit-report.md` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/pilar2-db-schema-report.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/synthesis-mapping-report.md` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/vista-unificada-discovery.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/results/vista-unificada-mapping.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/rollback.sh` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run_026_migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run_create_view.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run_scan_local.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run-020-migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run-024-migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/run-migration-027.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/scan_product_assets.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/setup_production.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/001_create_app_roles.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/001_create_app_users.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/002_create_repartidor_tables.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/020_repartidor_finance_tables.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/021_verify_repartidor_finance_schema.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/022_cleanup_repartidor_finance_test_template.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/023_repartidor_finance_db_exploration_acs.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/024_align_javier_to_dsedac.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/025_pedidos_reparto_linkage.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/026_align_javier_immediate_fixes.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/027_align_pedidos_to_cpc.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/027_team_commission_config.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/028_fix_team_commission_80.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/030_repartidor_finance_read_aliases.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T19-39-41-184Z_align_javier_to_dsedac_additive.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T19-39-41-184Z_align_javier_to_dsedac_additive.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T20-35-56-370Z_align_javier_to_dsedac_additive.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T20-35-56-370Z_align_javier_to_dsedac_additive.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T21-06-16-768Z_align_javier_to_dsedac_additive.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T21-06-16-768Z_align_javier_to_dsedac_additive.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T22-07-49-773Z_align_javier_to_dsedac_additive.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-07T22-07-49-773Z_align_javier_to_dsedac_additive.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/opencode.json` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/orchestrator.md` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/vista_clientes_unificada.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/sql/vista_deuda_completa.sql` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/test-app-view.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/test-view-syntax.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/truck_route_driver_inventory.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/validate_production_config.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/validation/validate_invoice_amounts.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-024-migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-migration.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-pf-columns.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-repartidor-finance-schema.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-team-80.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/scripts/verify-vista-final.js` | Scripts puntuales de investigacion/migracion DB2 (los audita el agente de DB2) |
| `backend/services/commissions-pdf.service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/emailPdfService.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/emailService.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/evolution.service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/facturas.service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/loadPlanner.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/pdf.service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/repartidor-finance-service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/smtpLogger.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/services/team-commission.service.js` | Servicio de otra feature (email/pdf/comisiones/repartidor/evolucion/facturas/almacen) |
| `backend/sql/db2_performance_indexes.sql` | SQL de indices/rendimiento puntual |
| `backend/sql/performance-indexes.sql` | SQL de indices/rendimiento puntual |
| `backend/src/__tests__/cobros.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/commissions.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/db-helpers.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/entregas.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/integration/endpoints.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/objectives.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/pagination.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/performance/latency.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/query-cache.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/query-optimization.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/repartidor.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/resilience/degradation.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/security/sql-injection.test.ts` | Tests del stack TS inactivo |
| `backend/src/__tests__/validators.test.ts` | Tests del stack TS inactivo |
| `backend/src/api-server.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/chatbot/chatbot_handler.js` | Chatbot - otra feature |
| `backend/src/chatbot/chatbot_tools.js` | Chatbot - otra feature |
| `backend/src/chatbot/llm-orchestrator.js` | Chatbot - otra feature |
| `backend/src/chatbot/moderation.js` | Chatbot - otra feature |
| `backend/src/config/database.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/config/env.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/config/swagger.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/controllers/auth.controller.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/controllers/cobros.controller.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/controllers/dashboard.controller.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/controllers/entregas.controller.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/controllers/products.controller.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/cron/index.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/cron/transferencias.job.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/index.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/audit.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/auth.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/cliente.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/error.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/security.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/middleware/validation.middleware.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/modules/analytics/application/get-analytics-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/application/get-forecast-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/application/get-kpi-dashboard-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/domain/analytics-metrics.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/domain/analytics-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/analytics/infrastructure/db2-analytics-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/chatbot/application/process-query-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/chatbot/domain/chatbot-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/chatbot/domain/chat-session.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/chatbot/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/chatbot/infrastructure/db2-chatbot-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/application/compare-clients-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/application/get-client-detail-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/application/get-clients-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/domain/client.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/domain/client-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/clients/infrastructure/db2-client-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/application/get-commission-summary-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/application/get-commissions-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/domain/commission.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/domain/commission-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/commissions/infrastructure/db2-commission-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-client-conditions-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-hierarchy-data-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-metrics-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-recent-sales-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-sales-evolution-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-top-clients-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-top-products-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/application/get-yoy-comparison-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/domain/dashboard-metrics.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/domain/dashboard-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/dashboard/infrastructure/db2-dashboard-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/application/get-albaranes-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/application/get-gamification-stats-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/application/mark-delivered-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/domain/albaran.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/domain/entregas-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/entregas/infrastructure/db2-entregas-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/application/create-export-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/application/get-export-data-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/domain/export-job.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/domain/export-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/export/infrastructure/db2-export-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/application/get-factura-detail-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/application/get-factura-summary-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/application/get-facturas-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/domain/factura.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/domain/facturas-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/facturas/infrastructure/db2-facturas-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/filters/application/get-filters-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/filters/domain/filter.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/filters/domain/filter-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/filters/infrastructure/db2-filter-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/application/check-kpi-alerts-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/application/get-active-alerts-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/domain/kpi-alert.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/domain/kpi-alert-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/kpi-alerts/infrastructure/db2-kpi-alert-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/master/application/get-master-data-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/master/domain/master-data.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/master/domain/master-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/master/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/master/infrastructure/db2-master-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/application/get-client-matrix-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/application/get-objective-progress-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/application/get-objectives-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/domain/objective.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/domain/objective-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/objectives/infrastructure/db2-objective-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/application/get-day-plan-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/application/save-plan-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/domain/load-plan.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/domain/planner-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/planner/infrastructure/db2-planner-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/application/get-commissions-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/application/get-delivery-detail-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/application/get-delivery-routes-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/application/get-historico-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/application/update-delivery-status-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/domain/delivery.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/domain/repartidor-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/repartidor/infrastructure/db2-repartidor-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/application/get-commissions-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/application/get-ruta-config-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/application/update-order-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/domain/ruta-config.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/domain/rutero-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/rutero/infrastructure/db2-rutero-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/application/get-low-stock-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/application/get-movements-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/application/get-stock-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/application/register-movement-usecase.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/domain/warehouse.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/domain/warehouse-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/index.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/modules/warehouse/infrastructure/db2-warehouse-repository.js` | Modulo DDD de otra feature - fuera de alcance |
| `backend/src/routes/analytics.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/auth.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/clientes.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/clients.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/cobros.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/commissions.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/dashboard.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/entregas.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/facturas.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/health.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/master.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/objectives.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/pedidos.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/products.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/promociones.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/repartidor.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/rutero.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/ventas.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/routes/warehouse.routes.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/scripts/db2-index-recommendations.sql` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/server.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/auth.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/cliente.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/cobros.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/commissions.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/dashboard.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/entregas.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/facturas.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/init.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/objectives.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/products.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/promociones.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/repartidor.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/roles.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/rutero.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/services/ventas.service.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/types/db.types.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/types/entities.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/types/env.d.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/types/roles.types.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/utils/db-helpers.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/utils/logger.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/utils/query-cache.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/utils/validators.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/src/utils/vendor-helpers.ts` | Stack TypeScript inactivo (USE_TS_ROUTES=false, server.js:55) |
| `backend/test-perf.js` | Script puntual de rendimiento en raiz de backend |
| `backend/tests/debug_schema.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/list_all_vendor_credentials.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/test_rutero_delivery.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/test_vendor_column_transition.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/trace_login.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/verify_check_variants.js` | Scripts de prueba manual/diagnostico |
| `backend/tests/verify_login_manual.js` | Scripts de prueba manual/diagnostico |
| `backend/utils/commission-snapshot.js` | Utilidad de comisiones (otra feature) |
| `backend/utils/delivery-status-check.js` | Utilidad de entregas (otra feature) |
| `CLAUDE.md` | Documentacion de proyecto |
| `database_backup_20260513/BACKUP_FINAL.txt` | Backup historico de BD |
| `database_backup_20260513/CHECKLIST_FINAL.txt` | Backup historico de BD |
| `database_backup_20260513/DSEDAC/data/CLI_LOGIN_HISTORY_data.txt` | Backup historico de BD |
| `database_backup_20260513/DSEDAC/data/CLI_TOKENS_data.txt` | Backup historico de BD |
| `database_backup_20260513/DSEDAC/README_DSEDAC_JAVIER_OBJECTS.txt` | Backup historico de BD |
| `database_backup_20260513/DSEDAC/tables/DSEDAC_TABLES_DDL.txt` | Backup historico de BD |
| `database_backup_20260513/INVENTARIO_FINAL.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/all_tables_listing.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/BACKUP_COMPLETO.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/data/big_tables_reference.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/data/DATA_SUMMARY.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/data/INDEXES_CREATE.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/FUNCTIONS.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/INDEXES.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/MASTER_RESTORE.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/SYSTEM_TABLE_NAMES_MAP.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/views/ALL_VIEWS_DEFINITIONS.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/views/views_raw_part1.txt` | Backup historico de BD |
| `database_backup_20260513/JAVIER/views/VISTA_DEUDA_BASE.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/views/VISTA_DEUDA_COMPLETA.sql` | Backup historico de BD |
| `database_backup_20260513/JAVIER/views/vx_views_extra.txt` | Backup historico de BD |
| `database_backup_20260513/README.txt` | Backup historico de BD |
| `database_backup_20260513/recreate_VISTA_DEUDA_BASE.sql` | Backup historico de BD |
| `database_backup_20260513/recreate_VISTA_DEUDA_BASE_COMPLETA.sql` | Backup historico de BD |
| `database_backup_20260513/RESTORE_INSTRUCTIONS.txt` | Backup historico de BD |
| `database_backup_20260513/VISTA_DEUDA_BASE_FINAL.sql` | Backup historico de BD |
| `database_backup_20260513/VISTA_DEUDA_BASE_FULL.sql` | Backup historico de BD |
| `database_backup_20260513/VISTA_DEUDA_COMPLETA.md` | Backup historico de BD |
| `docs/analysis_repartidor_amount_discrepancy.md` | Documentacion |
| `docs/ARCHITECTURE_DATA_FLOW.md` | Documentacion |
| `docs/archive/audits/anomalies.csv` | Documentacion |
| `docs/archive/audits/fix_proposals.diff` | Documentacion |
| `docs/archive/audits/report.json` | Documentacion |
| `docs/archive/audits/runbook.md` | Documentacion |
| `docs/archive/audits/scripts/fix_anomalies.js` | Documentacion |
| `docs/archive/audits/scripts/scan_anomalies.js` | Documentacion |
| `docs/archive/changelogs/CHANGELOG.md` | Documentacion |
| `docs/archive/README.md` | Documentacion |
| `docs/audits/preprod-2026-06-11/fase0-2-inventario-build-deps.md` | Documentacion |
| `docs/audits/preprod-2026-06-11/flutter-audit.md` | Documentacion |
| `docs/audits/preprod-2026-06-11/pilar2-db2.md` | Documentacion |
| `docs/deep-integration-plan.md` | Documentacion |
| `docs/DEPLOY_PASOS_PUTTY.md` | Documentacion |
| `docs/flutter-bug-patterns.md` | Documentacion |
| `docs/MAPEO_COLUMNAS_JAVIER_DSEDAC.md` | Documentacion |
| `docs/performance-baseline.md` | Documentacion |
| `docs/PRIVACY_POLICY.md` | Documentacion |
| `docs/privacy-policy.html` | Documentacion |
| `docs/repartidor-commission-review.md` | Documentacion |
| `docs/repartidor-finance-production-mapping.md` | Documentacion |
| `docs/route-dedup-analysis.md` | Documentacion |
| `docs/SESION_2026-05-15_RESUMEN.md` | Documentacion |
| `docs/storage-strategy.md` | Documentacion |
| `Driver` | Residuo untracked: volcado Get-OdbcDsn (ver seccion 2.2) |
| `ios/.gitignore` | Plataforma iOS no objetivo de esta release |
| `ios/Flutter/AppFrameworkInfo.plist` | Plataforma iOS no objetivo de esta release |
| `ios/Flutter/Debug.xcconfig` | Plataforma iOS no objetivo de esta release |
| `ios/Flutter/Release.xcconfig` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcodeproj/project.pbxproj` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcodeproj/project.xcworkspace/contents.xcworkspacedata` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcodeproj/project.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcworkspace/contents.xcworkspacedata` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist` | Plataforma iOS no objetivo de esta release |
| `ios/Runner.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/AppDelegate.swift` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@3x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@3x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@3x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-50x50@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-50x50@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-57x57@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-57x57@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-60x60@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-60x60@3x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-72x72@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-72x72@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-76x76@1x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-76x76@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-83.5x83.5@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/LaunchImage.imageset/Contents.json` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage@2x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage@3x.png` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Assets.xcassets/LaunchImage.imageset/README.md` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Base.lproj/LaunchScreen.storyboard` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Base.lproj/Main.storyboard` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Info.plist` | Plataforma iOS no objetivo de esta release |
| `ios/Runner/Runner-Bridging-Header.h` | Plataforma iOS no objetivo de esta release |
| `ios/RunnerTests/RunnerTests.swift` | Plataforma iOS no objetivo de esta release |
| `lib/features/analytics/data/analytics_repository.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/analytics/presentation/pages/analytics_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/auth/presentation/pages/login_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/auth/presentation/widgets/role_selection_dialog.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/authentication/domain/entities/user.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/chatbot/data/chatbot_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/chatbot/presentation/pages/chatbot_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/chatbot/presentation/widgets/chat_message_bubble.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/chatbot/providers/chatbot_provider.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/clients/data/clients_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/clients/presentation/pages/client_detail_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/clients/presentation/pages/simple_client_list_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/clients/presentation/widgets/client_evolution_tab.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/commissions/data/commissions_pdf_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/commissions/data/commissions_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/commissions/presentation/pages/commissions_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/commissions/presentation/widgets/pdf_range_dialog.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/domain/entities/dashboard_metrics.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/pages/dashboard_content.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/advanced_sales_chart.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/advanced_sales_chart_v3.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/client_conditions_widget.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/dashboard_chart_factory.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/dashboard_header.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/date_range_picker.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/filter_bar.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/hierarchy_section.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/hierarchy_selector.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/kpi_card.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/matrix_data_table.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/metrics_cards.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/revenue_chart.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/sales_chart_card.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/summary_stats_widget.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/ultimas_ventas_widget.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/dashboard/presentation/widgets/ventas_cards.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/entregas/presentation/pages/albaran_detail_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/entregas/presentation/widgets/entrega_card.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/entregas/presentation/widgets/entregas_header.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/entregas/presentation/widgets/signature_pad.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/entregas/providers/entregas_provider.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/facturas/data/facturas_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/facturas/presentation/pages/facturas_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/kpi_alerts/data/kpi_alerts_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/kpi_alerts/presentation/pages/kpi_dashboard_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/objectives/data/objectives_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/objectives/presentation/pages/client_evolution_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/objectives/presentation/pages/client_matrix_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/objectives/presentation/pages/enhanced_client_matrix_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/objectives/presentation/pages/objectives_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/pedidos/presentation/pages/pedidos_page_first.txt` | Residuo .txt no compilado dentro de lib/ (limpieza recomendada) |
| `lib/features/products_history/presentation/pages/products_history_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/products_history/presentation/widgets/products_history_tab.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/real_dashboard/real_dashboard_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/data/repartidor_data_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/data/zebra_print_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/pages/repartidor_clientes_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/pages/repartidor_historico_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/pages/repartidor_panel_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/pages/repartidor_rutero_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/delivery_item_list.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/futuristic_week_navigator.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/holographic_kpi_dashboard.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_completed.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_finalize.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_header.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_payment.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_products.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_signature.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_kpi_dashboard.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/rutero_printer_config.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/signature_modal.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/smart_delivery_card.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor/presentation/widgets/swipe_action_card.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/data/repartidor_finanzas_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/finance_error_message.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/pages/comisiones_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/pages/repartidor_evolution_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/repartidor_finanzas_presentation.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/repartidor_finanzas/presentation/widgets/repartidor_monthly_summary_bar.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/pages/rutero_client_detail_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/pages/rutero_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/client_map_view.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_client_list_item.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_dialogs.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_filter_bar.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_header.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_reorder_modal.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/rutero/presentation/widgets/rutero_week_summary.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/sales_history/data/sales_history_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/sales_history/domain/product_history_item.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/sales_history/presentation/pages/product_history_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/sales_history/presentation/widgets/sales_summary_header.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/sales_history/providers/sales_history_provider.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/settings/presentation/pages/network_settings_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/application/load_planner_provider.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/application/pdf_export_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/data/warehouse_data_service.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/domain/models/load_planner_models.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/articles_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/load_history_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/load_planner_3d_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/load_planner_v2_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/personnel_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/vehicles_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/warehouse_config_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/pages/warehouse_dashboard_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/painters/cargo_box_renderer.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/painters/projection_3d.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/painters/truck_3d_painter.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/painters/truck_body_renderer.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/warehouse_shell_page.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/box_info_overlay.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/load_canvas.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/load_canvas_v3.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/load_planner_panel.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/metrics_bar.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/orders_panel_v2.dart` | Otra feature - fuera de las 3 pestanas |
| `lib/features/warehouse/presentation/widgets/planner_toolbar.dart` | Otra feature - fuera de las 3 pestanas |
| `linux/.gitignore` | Plataforma Linux no objetivo |
| `linux/CMakeLists.txt` | Plataforma Linux no objetivo |
| `linux/flutter/CMakeLists.txt` | Plataforma Linux no objetivo |
| `linux/flutter/generated_plugin_registrant.cc` | Plataforma Linux no objetivo |
| `linux/flutter/generated_plugin_registrant.h` | Plataforma Linux no objetivo |
| `linux/flutter/generated_plugins.cmake` | Plataforma Linux no objetivo |
| `linux/runner/CMakeLists.txt` | Plataforma Linux no objetivo |
| `linux/runner/main.cc` | Plataforma Linux no objetivo |
| `linux/runner/my_application.cc` | Plataforma Linux no objetivo |
| `linux/runner/my_application.h` | Plataforma Linux no objetivo |
| `macos/.gitignore` | Plataforma macOS no objetivo |
| `macos/Flutter/Flutter-Debug.xcconfig` | Plataforma macOS no objetivo |
| `macos/Flutter/Flutter-Release.xcconfig` | Plataforma macOS no objetivo |
| `macos/Flutter/GeneratedPluginRegistrant.swift` | Plataforma macOS no objetivo |
| `macos/Runner.xcodeproj/project.pbxproj` | Plataforma macOS no objetivo |
| `macos/Runner.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist` | Plataforma macOS no objetivo |
| `macos/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme` | Plataforma macOS no objetivo |
| `macos/Runner.xcworkspace/contents.xcworkspacedata` | Plataforma macOS no objetivo |
| `macos/Runner.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist` | Plataforma macOS no objetivo |
| `macos/Runner/AppDelegate.swift` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_128.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_16.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_256.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_32.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_64.png` | Plataforma macOS no objetivo |
| `macos/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json` | Plataforma macOS no objetivo |
| `macos/Runner/Base.lproj/MainMenu.xib` | Plataforma macOS no objetivo |
| `macos/Runner/Configs/AppInfo.xcconfig` | Plataforma macOS no objetivo |
| `macos/Runner/Configs/Debug.xcconfig` | Plataforma macOS no objetivo |
| `macos/Runner/Configs/Release.xcconfig` | Plataforma macOS no objetivo |
| `macos/Runner/Configs/Warnings.xcconfig` | Plataforma macOS no objetivo |
| `macos/Runner/DebugProfile.entitlements` | Plataforma macOS no objetivo |
| `macos/Runner/Info.plist` | Plataforma macOS no objetivo |
| `macos/Runner/MainFlutterWindow.swift` | Plataforma macOS no objetivo |
| `macos/Runner/Release.entitlements` | Plataforma macOS no objetivo |
| `macos/RunnerTests/RunnerTests.swift` | Plataforma macOS no objetivo |
| `opencode.json` | Config de agentes IA/tooling - no producto |
| `PDF_FIX_SUMMARY.md` | Documentacion de proyecto |
| `PLAN.md` | Documentacion de proyecto |
| `PROJECT.md` | Documentacion de proyecto |
| `QUALITY_REPORT.md` | Documentacion de proyecto |
| `README.md` | Documentacion de proyecto |
| `REFACTORIZACION_COMPLETA.md` | Documentacion de proyecto |
| `scripts/opencode/apply-ecosystem-integration.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/apply-official-opencode-fix.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/apply-v2-system.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/deploy-v4-payload.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/ensure-gmp-odbc64.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/fix-mobile-startup.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/OPENCODE_SYSTEM_SPEC_V3.md` | Tooling OpenCode - no producto |
| `scripts/opencode/opencode-gmp.cmd` | Tooling OpenCode - no producto |
| `scripts/opencode/rebuild-multi-agent-system.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/remote-daily-digest-runner.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/repair-production-opencode.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/start-gmp-db2-tunnel.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/start-opencode-project.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/start-opencode-web-gmp.cmd` | Tooling OpenCode - no producto |
| `scripts/opencode/start-opencode-web-granja.cmd` | Tooling OpenCode - no producto |
| `scripts/opencode/test-opencode-readiness.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/test-opencode-v4-readiness.ps1` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/chromadb.service` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/gmp-daily-digest.service` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/gmp-daily-digest.timer` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/gmp-elevenlabs-bridge.service` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/gmp-rag-indexer.service` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/etc/systemd/system/gmp-rag-indexer.timer` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/auto-retrospective.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/daily-digest-runner.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/elevenlabs-bridge.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/rag-indexer.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/staging-manager.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/gmp-tools/tech-radar-fetcher.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/opt/monitoring/sre-alerting-rules.yml` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/payload/windows/start-chief-engineer.cmd` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-check-elevenlabs-env.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-check-health.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-check-rag.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-check-services.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-env-setup.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-merge-env.py` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/remote-read-health-source.sh` | Tooling OpenCode - no producto |
| `scripts/opencode/v4/test-production-safety-guard.mjs` | Tooling OpenCode - no producto |
| `scripts/opencode/write-simple-startup.ps1` | Tooling OpenCode - no producto |
| `Simple` | Residuo trackeado: nota suelta de VS Code (ver seccion 2.2) |
| `skills/caveman/SKILL.md` | Skills de agentes IA - no producto |
| `skills/caveman-commit/SKILL.md` | Skills de agentes IA - no producto |
| `skills/caveman-compress/README.md` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/__init__.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/__main__.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/benchmark.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/cli.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/compress.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/detect.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/scripts/validate.py` | Skills de agentes IA - no producto |
| `skills/caveman-compress/SECURITY.md` | Skills de agentes IA - no producto |
| `skills/caveman-compress/SKILL.md` | Skills de agentes IA - no producto |
| `skills/caveman-help/SKILL.md` | Skills de agentes IA - no producto |
| `skills/caveman-review/SKILL.md` | Skills de agentes IA - no producto |
| `skills-lock.json` | Config de agentes IA/tooling - no producto |
| `test/warehouse/load_planner_models_test.dart` | Tests de feature almacen (fuera de alcance) |
| `test/warehouse/load_planner_provider_test.dart` | Tests de feature almacen (fuera de alcance) |
| `test/widget/repartidor_finanzas_ui_test.dart` | Test de feature repartidor-finanzas (fuera de alcance) |
| `test/widgets/repartidor_evolution_page_test.dart` | Test de feature repartidor-finanzas (fuera de alcance) |
| `TODO.md` | Documentacion de proyecto |
| `v` | Residuo untracked: archivo vacio (ver seccion 2.2) |
| `VISTA_DEUDA_COMPLETA.md` | Documentacion de proyecto |
| `web/favicon.png` | Plataforma web no objetivo |
| `web/icons/Icon-192.png` | Plataforma web no objetivo |
| `web/icons/Icon-512.png` | Plataforma web no objetivo |
| `web/icons/Icon-maskable-192.png` | Plataforma web no objetivo |
| `web/icons/Icon-maskable-512.png` | Plataforma web no objetivo |
| `web/index.html` | Plataforma web no objetivo |
| `web/manifest.json` | Plataforma web no objetivo |
| `web/sw.js` | Plataforma web no objetivo |
| `windows/.gitignore` | Plataforma Windows no objetivo |
| `windows/CMakeLists.txt` | Plataforma Windows no objetivo |
| `windows/flutter/CMakeLists.txt` | Plataforma Windows no objetivo |
| `windows/flutter/generated_plugin_registrant.cc` | Plataforma Windows no objetivo |
| `windows/flutter/generated_plugin_registrant.h` | Plataforma Windows no objetivo |
| `windows/flutter/generated_plugins.cmake` | Plataforma Windows no objetivo |
| `windows/runner/CMakeLists.txt` | Plataforma Windows no objetivo |
| `windows/runner/flutter_window.cpp` | Plataforma Windows no objetivo |
| `windows/runner/flutter_window.h` | Plataforma Windows no objetivo |
| `windows/runner/main.cpp` | Plataforma Windows no objetivo |
| `windows/runner/resource.h` | Plataforma Windows no objetivo |
| `windows/runner/resources/app_icon.ico` | Plataforma Windows no objetivo |
| `windows/runner/runner.exe.manifest` | Plataforma Windows no objetivo |
| `windows/runner/Runner.rc` | Plataforma Windows no objetivo |
| `windows/runner/utils.cpp` | Plataforma Windows no objetivo |
| `windows/runner/utils.h` | Plataforma Windows no objetivo |
| `windows/runner/win32_window.cpp` | Plataforma Windows no objetivo |
| `windows/runner/win32_window.h` | Plataforma Windows no objetivo |

