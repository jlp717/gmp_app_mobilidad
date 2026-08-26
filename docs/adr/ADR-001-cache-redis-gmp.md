# ADR-001 — Estrategia de caché Redis GMP

- Estado: accepted
- Fecha: 2026-08-26
- Alcance: backend GMP
- Relación: refina ADR 0003 con comportamiento L1/L2 observado

## Context

Agregados DB2 de dashboard, analytics, rutero y cobros son costosos y se sirven desde múltiples workers PM2. Backend ya implementa caché multinivel en `backend/services/redis-cache.js`, cache-aside y protección contra stampede en `backend/services/query-optimizer.js`, más caché HTTP privada por worker en `backend/middleware/http-cache.js`. Esta ADR formaliza implementación existente; no introduce otra caché.

## Decision

### Capas y patrón

1. **L1 de proceso:** `Map` con límite de 10.000 entradas, LRU simple y stale-while-revalidate de hasta 1 hora.
2. **L2 compartida:** Redis, timeout de comando de 1 segundo y degradación a L1/DB2 cuando no está disponible.
3. **Cache-aside:** lectura L1 → L2 → DB2; resultado fresco se guarda en L1 y L2.
4. **Stampede:** `query-optimizer.js` hace coalescing local mediante promesa/lock y usa lock Redis distribuido; ante reconstrucción fallida puede servir stale local.
5. **Invalidación:** `redis-cache.js::invalidatePattern()` borra L1 local, publica en `cache:invalidate` para otros workers y elimina claves L2 por `SCAN` en lotes.
6. Sesiones, tokens, login, escrituras e información sensible de reparto no son cacheables como respuestas HTTP.

### TTL observados y política

| Tipo de dato | Redis/query actual | HTTP L1 actual | Justificación y decisión |
|---|---:|---:|---|
| Tiempo real | `REALTIME` 60 s; query SHORT 60 s | métricas 60 s | Balance entre frescura y descarga DB2. |
| Deuda/cobros | pending-summary `SHORT` 300 s; pendientes/histórico `MEDIUM` 1.800 s | sin regla específica | Mantener 300 s para resumen. **Recomendado:** llevar pendientes/histórico a 60–300 s tras baseline por sensibilidad comercial. |
| Dashboard/agregados | `MEDIUM` 1.800 s; defaults internos 300 s | métricas 60 s; evolución/matriz 300 s | L1 corto amortigua repetición; Redis evita recomputación entre workers. Validar stale de 1.800 s. |
| Analytics | `MEDIUM` 1.800 s o `LONG` 86.400 s | 300 s | Separar histórico cerrado de periodo corriente en futura revisión. |
| Clientes | `MEDIUM` 1.800 s o `LONG` 86.400 s | 300 s | Catálogo frecuente, cambio infrecuente. |
| Productos/catálogos/configuración | `LONG` 86.400 s; query 1.800–3.600 s | productos 600 s | TTL largo solo con invalidación de escrituras. |
| Rutero | combinaciones `SHORT`/`LONG` | 300 s | Orden/config cambia poco; progreso de hoy requiere invalidación o TTL corto. |
| Comisiones/objetivos | `SHORT`/`MEDIUM` según ruta | 900 s / 180 s | Comisiones toleran más stale; objetivos menos. |
| Sesión/auth | no cacheable | no cacheable | Evita mezclar identidad y respuestas de autenticación. |

`redis-cache.js::set()` aplica mismo TTL a L1 y L2. Cuando hit L2 se promociona a L1, usa `L1_CACHE_TTL_MS` (60 s por defecto), no TTL restante de Redis. `query-optimizer.js` define SHORT/MEDIUM/LONG/STATIC como 60/300/1.800/3.600 s, mientras `redis-cache.js` exporta 300/1.800/86.400 s. **Acción recomendada:** una taxonomía única con nombres no ambiguos y TTL por dominio; migrarla con baseline y tests, no por reemplazo global.

### Invalidaciones actuales verificadas

- Registro de cobro legacy: `invalidateCobrosCache()` invalida pendientes CVC del cliente, histórico, todos los pending-summary y collections de repartidor.
- Pedidos legacy: mutaciones invalidan listas/stock mediante `invalidatePedidosStockCache()` y cachés por pedido.
- Adaptadores DDD de pedidos: invalidan listas, historial, estadísticas y cachés de cobros relacionadas.
- Adaptadores DDD de reparto: invalidan albarán y resumen del repartidor.
- Middleware HTTP: mutaciones de clients, products, dashboard, commissions, objectives y rutero invalidan prefijos L1 locales.
- KPI ETL: invalida caché KPI al completar carga.

### Invalidaciones faltantes — acciones recomendadas

No se implementan aquí porque cruzan escrituras críticas:

- **Registrar cobro:** invalidar caché de deuda/estado de cliente y agregados dashboard que incorporen pendiente o cobrado; confirmar claves DDD y legacy.
- **Confirmar/cancelar pedido:** invalidar rutero semanal/día, dashboard y deuda del cliente cuando dependan del pedido; legacy hoy se centra en pedidos/stock.
- **Confirmar entrega o cobro de repartidor:** invalidar pending-summary, estado/deuda, collections y progreso de rutero en ambos modos.
- **Cambios ERP externos:** TTL es defensa principal. Publicar invalidación por dominio tras import/export confirmado cuando exista señal fiable.
- **Caché HTTP multinodo:** `invalidationMiddleware` solo borra worker receptor; no ampliar cobertura hasta conectar pub/sub o demostrar que TTL corto basta.

## Consequences

### Positivas

- Menos consultas DB2 repetidas y coherencia L2 entre workers.
- Locks existentes limitan reconstrucciones simultáneas.
- Redis fallido degrada sin bloqueo indefinido.

### Negativas y riesgos

- Tres taxonomías TTL pueden producir stale desigual.
- L1 HTTP e invalidación por path son locales al worker.
- TTL largo sin invalidación puede mostrar datos obsoletos.
- Stale-while-revalidate requiere métricas de edad/hit rate para no ocultar fallos DB2.
