# OFF06 — reparación propuesta tras bloqueo

Estado: BLOCKED. No se ha aplicado una cuarta reparación.

El verificador independiente ejecutó 16 pruebas con exit code 0 y después encontró un P1 por inspección reproducible: la migración de `queuedAt` recorre también `kind=autoSyncThreshold`, añade estado `failed` a la configuración y permite que aparezca/reintente como pedido. Las pruebas actuales no comprueban esa separación.

La reparación propuesta es una única intervención sobre `lib/features/pedidos/data/pedidos_offline_service.dart` y su suite de drenaje:

1. Identificar expresamente los registros de pedido y conservar compatibilidad con pedidos antiguos sin `kind`.
2. Aplicar esa identificación antes de migrar fechas, listar estados, reintentar y preparar un envío. La configuración nunca puede alcanzar la red como pedido.
3. Conservar los valores de umbral y ámbito; eliminar únicamente la contaminación de campos de cola acreditada en una configuración reconocida. Conservar cualquier otro campo desconocido.
4. Reproducir el caso umbral + drenaje y exigir cero pedidos pendientes/fallidos artificiales y configuración intacta; probar configuración ya contaminada sin envío; conservar la migración de un pedido antiguo y el timestamp original durante reintento/reapertura.
5. Ejecutar la suite ampliada y revisión independiente de las cuatro entradas. Si falla esta intervención excepcional, detener este contrato sin otro intento.

Origen del límite: AGENTS.md del repositorio y `C:/Users/Javier/.codex/skills/loop-engineering/SKILL.md`: “Stop after three iterations, two consecutive no-progress rounds, a timeout, a budget limit, a security block, or unresolved ambiguity.” La excepción requiere una nueva instrucción expresa de Javier; el mandato general de autonomía no se usa para eludir el límite.

No afecta a DB2, autenticación, secretos, producción, despliegue ni eliminación de archivos. El backend STATE tiene su revisión independiente separada: 14 suites, 350 pruebas aprobadas; ello no concede PASS a OFF06.

## Autorización recibida

Javier respondió expresamente «Autorizar una reparación adicional acotada» el 02/11/2026 a las 22:00 Europe/Madrid. Gate `orders_off06_exception=PASS`; se mantiene exactamente una intervención y parada si falla. Se ejecutará tras el handoff del escritor actual COLL, sin dos escritores concurrentes. La autorización no implica PASS del resultado.
