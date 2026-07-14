## Context

El repositorio es una aplicación Flutter comercial/logística con backend Node/Express. No existe un módulo de inversión: `lib/features/bolsa` y `/api/bolsa` implementan crédito y margen comercial GMP y quedan fuera de este cambio. Sí existen piezas reutilizables: `ApiClient` con auth, cancelación, deduplicación y errores tipados; cache/offline local; middleware backend de auth, request-id, timeout, rate-limit, Prometheus y cache; y un orquestador de notificaciones con preferencias, quiet hours, snooze y dedupe.

El estado de un mercado no es un booleano. Depende del MIC y segmento, producto, zona IANA, fecha efectiva, festivos y medias jornadas, fase de sesión, incidencias del venue, suspensiones del instrumento, frescura/licencia del feed y reglas del bróker. Los fondos tradicionales tampoco siguen el cierre de una bolsa: tienen dealing calendar, valuation point, NAV y cutoffs propios. Por ello, el sistema debe representar incertidumbre y procedencia antes de generar contexto o alertas.

Los puntos de composición `backend/server.js`, `lib/core/services/navigation_config_service.dart` y `lib/features/dashboard/presentation/pages/main_shell.dart` contienen cambios locales ajenos. `main_shell.dart` supera aproximadamente 1.800 líneas. Solo se permiten parches mínimos y coordinados; una ampliación sustancial exige un cambio separado de división del archivo.

Stakeholders: Javier como usuario/decisor, usuarios autenticados que reciban acceso al módulo, equipo backend/Flutter, QA/AppSec/SRE, y proveedor(es) de calendario/datos sujeto(s) a licencia.

## Goals / Non-Goals

**Goals:**

- Crear una frontera de dominio independiente, extensible y verificable para contexto de mercados e inversiones.
- Dar una respuesta segura a “¿está abierto, qué fase es y cuándo cambia?” con MIC, UTC, zona IANA, fuente y frescura.
- Diferenciar acciones/ETF, fondos tradicionales y, en fases posteriores, derivados, FX, bonos/OTC y cripto.
- Reutilizar API, cache, offline y notificaciones sin introducir lógica financiera en widgets ni rutas Express.
- Soportar fallos, datos stale y conflictos mediante `DEGRADED`/`UNKNOWN`, sin inventar disponibilidad.
- Preparar cartera, eventos, riesgo y explicaciones bajo una barrera técnica frente a ejecución.
- Entregar y verificar primero un vertical slice XMAD antes de ampliar cobertura.

**Non-Goals:**

- No ejecutar, preparar ni enviar órdenes reales o de paper trading.
- No garantizar rentabilidad, predecir el mercado ni presentar scores como certeza.
- No modificar Bolsa Comercial, pedidos, DB2, PM2, staging o producción.
- No persistir perfil financiero sensible en backend durante la primera tranche.
- No prometer precisión exacta de notificaciones en segundo plano en Android/iOS.
- No cubrir todos los venues/productos en el primer incremento.

## Decisions

### 1. Dominio separado y arquitectura por capas

Backend usará `backend/src/modules/market-intelligence/{domain,application,infrastructure}` y una route fina `backend/routes/market-intelligence.js`. Flutter usará `lib/features/market_intelligence/{domain,data,providers,presentation}`. Los servicios serán wrappers stateless; el repository será la fuente de verdad; el provider/view-model expondrá estado inmutable y la UI será una función de ese estado.

Se descarta reutilizar `bolsa` por coincidencia nominal y se descarta colocar llamadas al proveedor en route/widgets porque mezclaría contratos externos, seguridad y reglas temporales con presentación.

### 2. Modelo canónico temporal e identidad

Las claves de venue serán MIC operativo más segmento/producto cuando aplique. `Instrument`, `Listing` y `Venue` serán entidades distintas; ticker será un alias con vigencia, nunca la clave global. Cada sesión conservará `calendarDate`, `tradeDate`, zona IANA e instantes UTC. El dominio incluirá fases como `PRE_OPEN`, `OPEN`, `AUCTION`, `BREAK`, `POST_CLOSE`, `PAUSED` y `CLOSED`, más estados de datos `FRESH`, `DEGRADED`, `CONFLICT` y `UNKNOWN`.

Se descartan offsets fijos (`CET`, `ET`, `+01:00`) porque no resuelven DST ni cambios normativos. Las conversiones se hacen en backend con zona IANA y se entregan como ISO-8601 UTC más el identificador de zona.

### 3. Estado multidimensional, no booleano

`MarketContext` combinará fase programada, salud operativa del venue, estado del instrumento, estado del dato y, cuando exista integración futura, operabilidad del bróker. Una suspensión o incidente autoritativo prevalece sobre un calendario que diga abierto. Una discrepancia material o falta de evidencia produce `UNKNOWN`; una observación stale todavía válida dentro de su ventana produce `DEGRADED` y advertencias visibles.

Se descarta convertir cualquier error de proveedor en `CLOSED`, porque podría inducir una decisión falsa.

### 4. Adaptadores de proveedor y jerarquía de fuentes

`MarketCalendarProvider` será un puerto de dominio. El primer adaptador real se seleccionará tras revisar licencia, cobertura XMAD, atribución, SLA, rate limits y credenciales; TradingHours es el candidato normalizador inicial, con fuentes oficiales del venue como validación/override y un segundo adaptador para evitar lock-in. Tests usarán `FakeMarketCalendarProvider` determinista.

Cada `Observation` incluirá proveedor, URL/record ID cuando proceda, `observedAt`, `retrievedAt`, `asOf`, `validUntil`, versión de calendario/parser, licencia/atribución, hash y confianza. Ningún secreto o payload licenciado se devuelve innecesariamente a Flutter.

Se descartan horarios estáticos como fuente de verdad. Fixtures oficiales solo se usan como casos dorados de prueba o fallback explícitamente limitado por fecha.

### 5. Contrato API seguro y versionable

Primera operación:

`GET /api/market-intelligence/markets/:mic/state`

Respuesta normalizada:

```json
{
  "success": true,
  "data": {
    "mic": "XMAD",
    "ianaTimezone": "Europe/Madrid",
    "state": "OPEN",
    "scheduledPhase": "CONTINUOUS",
    "sessionDate": "2026-07-13",
    "asOf": "2026-07-13T14:10:00Z",
    "nextTransition": { "type": "CLOSE", "at": "2026-07-13T15:30:00Z" },
    "source": { "provider": "configured-provider", "validUntil": "...", "attribution": "..." },
    "freshnessSeconds": 15,
    "warnings": []
  },
  "request_id": "..."
}
```

MIC inválido devuelve `400 INVALID_MIC`; MIC válido no soportado, `404 UNSUPPORTED_MIC`. La falta de evidencia para un MIC soportado es un resultado de dominio `200 UNKNOWN` con warning tipado. Errores de programación/autorización conservan códigos HTTP adecuados. Inputs se validan y limitan; futuras operaciones batch tendrán máximo explícito y una única llamada bulk/prefetch, nunca N+1.

### 6. Cache condicionada por transición y single-flight

Clave base: proveedor + MIC + fecha de sesión + versión de calendario. El TTL será el mínimo entre `validUntil`, próxima transición y máximo por tipo de dato. Peticiones simultáneas para una clave comparten una promesa. Stale solo puede servirse dentro de una ventana acotada y nunca atravesar silenciosamente una transición conocida: en ese caso pasa a `UNKNOWN` o exige refresh.

Flutter puede conservar el último contexto cifrado y scopeado a sesión, pero `asOf`, `validUntil` y `freshnessSeconds` del backend mandan. La UI muestra offline/stale; no recalcula calendarios complejos por su cuenta.

### 7. Alertas como transiciones revalidables

Se añade categoría `markets` separada de `bolsa`. Dedupe: `scopeKey:market:<MIC>:<transitionAt>:<calendarVersion>`. El backend calcula la transición; Flutter programa el instante UTC, lo presenta en zona local y revalida en foreground/background. Si cambia el calendario, se cancela/reemplaza la alerta anterior. Quiet hours, snooze, mute y límites diarios se reutilizan.

Workmanager cada 30 minutos es revalidación best-effort, no reloj exacto. La UI comunica tolerancia. Los mensajes describen qué cambia, fuente, edad e incertidumbre; evitan FOMO y llamadas urgentes a comprar.

### 8. Fondos mediante contrato distinto

`FundValuationContext` tendrá dealing calendar, zona, frecuencia, cutoff de gestora/distribuidor, valuation point, próxima fecha de valoración, `navAsOf`, publication time, settlement lag y posibles gates/suspensions. Una orden conceptual recibida después del cutoff apunta al siguiente dealing day. Falta de folleto/KID vigente produce `UNKNOWN`.

ETF conserva contexto de sesión, pero precio, NAV/iNAV, prima/descuento y sus respectivas frescuras no se mezclan.

### 9. Barrera entre hechos, soporte de decisión y ejecución

Flujo obligatorio: hechos/procedencia → análisis contextual → restricciones/idoneidad → explicación. No existe dependencia desde estas capas hacia un broker. Toda idea futura debe mostrar tesis, datos usados y edad, supuestos, downside, escenarios, costes, conflictos, alternativas y condiciones de invalidez. Si se personaliza, requiere conocimientos/experiencia, horizonte, situación financiera, capacidad de pérdida y tolerancia al riesgo vigentes.

La ejecución queda fuera incluso si existe un deep-link externo. Una integración futura requerirá un cambio independiente, revisión legal, AppSec, QA, confirmación humana e idempotencia.

### 10. Entrega incremental y coordinación con el worktree

Fase 0 decide proveedor/licencia, universo, política regulatoria y tolerancia. Fase 1 implementa XMAD end-to-end. Fase 2 añade múltiples MIC, watchlist e incidencias/halts. Fase 3 añade fondos NAV/cutoff. Fase 4 incorpora eventos y alertas avanzadas. Fase 5 incorpora riesgo/escenarios/explicabilidad.

Los archivos nuevos se crean primero. Los mounts de `server.js`, `navigation_config_service.dart` y los dos switches obligatorios de `main_shell.dart` se aplican al final como parches mínimos después de releer el diff local. No se reordena ni formatea código ajeno.

## Risks / Trade-offs

- [Proveedor/licencia aún no elegidos] → Mantener puerto/adaptadores, fake determinista y spike contractual antes del adaptador vivo.
- [Un calendario programado no detecta halt/incidente] → Superponer fuentes operativas y devolver `UNKNOWN` ante conflicto.
- [DST, medias jornadas y sesiones nocturnas] → IANA + instantes UTC + fixtures dorados por fecha efectiva.
- [Datos stale aparentan certeza] → Metadatos obligatorios, TTL por dato, estados visibles y bloqueo al cruzar transiciones.
- [Doble cache backend/Flutter] → Backend conserva autoridad sobre frescura; Flutter no promociona stale a fresh.
- [Fatiga/FOMO por alertas] → Dedupe, cooldown, presupuesto diario, quiet hours, digest y copy neutral.
- [Recomendación personalizada regulada] → Mantener fase inicial informativa; gate legal/idoneidad/registro antes de personalizar.
- [Privacidad de cartera/perfil] → Primera fase sin cantidades ni perfil backend; storage local cifrado y minimización posterior.
- [Archivos de composición sucios] → Parches mínimos, diff previo/posterior y rollback por archivo, sin sobrescribir cambios.
- [Tarea muy amplia] → Vertical slices con gates verificables; ninguna fase se declara completa por existir un scaffold.

## Migration Plan

1. Crear dominios, contratos y tests sin montar rutas ni navegación.
2. Implementar fake/adaptador y caso de uso XMAD; validar unit y contract tests.
3. Montar endpoint local autenticado mediante parche mínimo y ejecutar Jest dirigido.
4. Crear feature Flutter por capas, cache/offline y widgets; ejecutar build_runner si aplica, analyze y tests dirigidos.
5. Añadir categoría/reglas de alerta y tests de dedupe/DST/reprogramación.
6. Releer y reconciliar archivos sucios; añadir navegación actualizando `_getNavItems` y `_buildCurrentPage` conjuntamente.
7. Ejecutar Politec, elite-quality-gate, AppSec y revisión cruzada. Staging/producción quedan fuera de este cambio local.

Rollback local: retirar mounts/navegación/notificación y borrar únicamente los nuevos módulos; no existe migración DB ni dato productivo que revertir. Un fallo de proveedor se resuelve deshabilitando el adaptador y devolviendo `UNKNOWN`, no cambiando reglas de mercado.

## Open Questions

- ¿Confirma Javier que este dominio financiero pertenece a la aplicación GMP comercial/logística y a qué roles será visible?
- ¿Qué proveedor y licencia se aprueban para calendario/status XMAD y cuál será el fallback contractual?
- ¿La primera cobertura viva será solo XMAD o también XNYS/XNAS desde fase 1?
- ¿Qué anticipación y tolerancia acepta Javier para avisos de cierre en móvil?
- ¿El producto se mantendrá como información general o se pretende recomendación personalizada regulada?
- ¿Dónde persistir watchlist/cartera y perfil sensible cuando se requiera sincronización multidispositivo?
