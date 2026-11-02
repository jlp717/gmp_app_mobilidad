# Plan de ejecución de pedidos — 02/11/2026

Fuente: `docs/orders-audit.md`. Run `orders-tablet-20261102`; grafo validado en `docs/audits/orders-tablet-20261102/graph.json`. Nueve especialistas; máximo ocho agentes activos incluido coordinador. Descubrimiento paralelo en dos tandas, reducción determinista, un escritor de código secuencial, QA independiente. Máximo tres reparaciones y parada tras dos rondas sin progreso.

| Orden | Unidad / responsable experto | Dependencias | Aceptación mínima |
|---|---|---|---|
| 1 | Bolsa + Inventario: integridad de confirmación local | BAG-01, INV-01; esquema existente, pool real | Misma conexión para confirmación/reserva/movimientos, rollback en cualquier fallo, reintento sin duplicar, transacción no disponible → error explícito. Pruebas de fallos y concurrencia. |
| 2 | Offline / sistemas distribuidos | Cola actual; no depende del DDL | FIFO por vendedor, un drenaje activo, backoff durable, reintento manual limpio, fallos parciales; pruebas de reloj/cola tras reapertura. Mantener borradores editables separados. |
| 3 | DevOps / configuración | Rutas de tablas auditadas | APP_ENV determinista, contradicciones fallan antes de tareas, env:verify sólo SELECT, plantillas sin secretos, indicador de entorno. Production no habilita escrituras ERP por sí solo. |
| 4 | UX / diseñador sénior | Modelos actuales; widgets reales | Controles pedidos ≥56 dp, etiquetas/selección explícitas, texto escalable; pruebas en cuatro tamaños × dos orientaciones × tres escalas para los widgets modificados. Capturas reales si hay renderer disponible. |
| 5 | Finanzas comercial | Resumen servidor actual | Guardado rechaza periodo sin cobros y no acepta totales manipulados; tests de efectivo/tarjeta/transferencia y replay. No modificar reparto. |
| 6 | Precios / reglas | QSYS2 y fuente ERP acreditada | Conectar competitivo con ausencia explícita, preservar prioridad acreditada; no resolver contradicción de reglas mediante una suposición. |
| 7 | Estados/cancelación y reconciliación | Integridad bolsa/stock, catálogo QSYS2, auditoría durable | Cancelación conserva pedido y movimientos inversos sólo para pedido local no exportado. Si no hay esquema comprobable, dejar migración/procedimiento revisable y marcar bloqueo, sin SQL inventado ejecutado. |
| 8 | Performance | Servidor/dispositivo y datos reales accesibles | Antes/después por la misma sonda, API/ODBC/frames separados, sin atribuir medición de mocks al servidor. |
| 9 | QA independiente / cierre | Diffs completos y resultados ejecutados | Suites completas antes/después, analyze, lint, loop_gate, demo y evidencia DB real cuando accesible; veto ante fallos críticos. |

## Gates y límites

La autorización de implementación proviene del mandato explícito de Javier; la especificación EARS reproduce sus requisitos y limita cada slice a comportamiento comprobable. El gate spec_approved no sustituye validación DB2 ni autoriza producción. Un test de unidad con mocks prueba el contrato de código, no el DDL desplegado ni la ausencia de sobreventa en DB2 real.

Los fallos previos se conservan visibles. No se corrigen reglas de autenticación, secretos, infraestructura o reparto ajenos al alcance para maquillar el resultado. El informe final debe marcar cada gap DONE/PARTIAL/BLOCKED y no declarar la demo aprobada mientras fallen sus condiciones.
