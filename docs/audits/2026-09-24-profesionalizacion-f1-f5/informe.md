# Profesionalizacion F1-F5 — informe 2026-09-24

Modelo makers: Muse Spark 1.3 Contributor maximo. Solo escritura en docs/. Sin codigo ni prod.

## F0 — base
Knowledge vivo + snapshot + goal loop. Sin cambios de comportamiento.

## F1a — backend quick wins (jest 32 PASS)
- metadataCache: 6 queries FAM/FI1-FI5 en Promise.all. try/catch por tabla. Contrato intacto.
- Errores tipados: 9 rutas pasan extras.code a handleRouteError. Default INTERNAL_ERROR.
- Compresion: import muerto createCompressionMiddleware fuera. Solo lib compression.
- ETag md5 solo si payload < 256KB. Money paths no-store intactos.

## F1b — Flutter quick wins (analyze 0 errores)
- OptimizedListView en bolsa-pedidos (products_history, bolsa_page, pedidos_page, repartidor_panel).
- Imagenes con cacheWidth/cacheHeight patron smart_product_image (vehicles_page).
- select() fino en ticks ya-PASS (load_planner_v2, orders_panel_v2, load_canvas, main_shell).

## F1c — datos DB2 (jest 48 PASS)
- Variance CPC determinista: ORDER BY ID DESC + ROW_NUMBER RN=1.
- RUTERO_CONFIG filtra ORDEN>=0. Bloqueos -1 fuera.
- Finance vencimientos con columnas explicitas. Sin SELECT estrella.
- Chatbot rowLimit con boundLimit 1-30. Sin interpolacion.

## F2a — vendor-scope canonico (jest 55 PASS, 7 ficheros)
- Canon: backend/middleware/vendor-scope.js. literalAll solo catalogo VDC o set>=20.
- bolsa: manager sin visibles pasa a catalogo, no ok:true total.
- cobros: JEFE contra visibles/catalogo. ALMACEN/REPARTIDOR solo cliente asignado.
- liquidacion: ALL sin visibles da literalAll o 403, nunca codes vacio.
- clients + notifications usan resolveVendorScope/buildBound. Sin csv ALL.
- Filtros migran a buildBoundVendorFilter/buildBoundLaclaeVendorFilter.

## F2b — validacion-errores-sanitize (jest 156 evidenciado)
- validate fail-closed: sin zod da 500 VALIDATOR_UNAVAILABLE, nunca next.
- Zod en cobros codigoCliente y clients code-sales-history. Alfanumerico max 10. limit-offset clamped.
- sanitize global con allowlist. Notas legitimas con simbolos intactas.
- Errores publicos genericos via handleRouteError. Detalle solo en log.
- Clamps en facturas y liquidacion: texto max 64 allowlist, limit 1-500, offset desde 0.

## F3 — Flutter senior (build_runner exit 0)
- Widgets extraidos de god-file commissions a presentation-widgets. UI identica.
- Piloto freezed en bolsa_models y cobros_models. JSON identico. Generados presentes.
- PENDIENTE F3-01: deprecar albaran_detail_page (1184 lineas, UI muerta). Blocker guardrail.
  Requiere edicion manual de Javier. Cero cambios de logica cuando se haga.

## F4 — datos finales (jest 122)
- cvcDocumentJoins deprecado hacia cvcDocumentAmountJoins. Cero callers prod.
- Scripts legacy create_view* archivados a backend-scripts-legacy con README DSEDAC-CVC.
- SELECT estrella en repartidor-route y reparto-finance: columnas explicitas o comentario justificado.

## F5 — cache unico (jest 88)
- KPI invalidateKpiCache conectado a bus onInvalidationPattern. Alcance cluster.
- TTL por dominio con constantes nombradas. Dinero y cobros en REALTIME 60.
- Alertas KPI 7 dias sin cambio de comportamiento.

## gap2 — resto routes (jest 13)
21 codes explicitos en resto de routes. Respuesta incluye code.

## Review independiente — PASS scope F
Reviewer distinto de maker. Veredicto PASS en scope F.
Gaps ajenos fuera de scope documentados, no bloquean.
Commits: 66e321b y 9329ddb.

## Gates ledger
spec_approved, verify, verify_f1b, verify_f1c, verify_f2a, verify_f2b, verify_f3, verify_f4, verify_f5, verify_gap2, review_f_scope.

## Pendientes
- F3-01 deprecate albaran_detail_page: manual Javier por guardrail. Nada mas pendiente en scope F.

## Cierre
F1-F5 verificado con jest y analyze. F3-01 manual pendiente. Review PASS.
