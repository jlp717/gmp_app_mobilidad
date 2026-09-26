# ADR-0017 — Cache TTL por dominio

- Estado: Aceptada
- Fecha: 2026-09-25
- Modelo: Muse Spark 1.3 (maximo)
- Decisor: Javier
- Etiquetas: cache, redis, http-cache, ETag, KPI

## Contexto

Un solo TTL para todo rompe dos extremos: dinero/cobros se quedan stale y
alertas KPI recalculan de mas. PM2 cluster exige capa compartida (ver ADR 0003).
Ademas, respuestas grandes no deben generar ETag caro y el dinero no debe
cachearse a nivel HTTP.

## Decision

TTL por dominio con constantes nombradas, no numeros magicos:

- `REALTIME = 60`: dinero y cobros (`MONEY`, `COBROS` en `TTL_BY_DOMAIN`).
- Alertas KPI 7 dias intactas: `ALERTS = 604800` (`backend/services/redis-cache.js`,
  `backend/kpi/services/redis_cache.js` con `KPI_CACHE_TTL = 604800`).
- ETag `md5` solo < 256KB: `ETAG_MAX_BYTES = 256*1024`
  (`backend/middleware/http-cache.js`, `backend/middleware/network-optimizer.js`
  con `HTTP_ETAG_MAX_BYTES`).
- KPI cross-invalidation por bus central: `onInvalidationPattern` en
  `backend/services/redis-cache.js`; `backend/kpi/services/redis_cache.js`
  (F5-01) y `backend/middleware/http-cache.js` reaccionan al patron,
  sin require cycles.
- Dinero no-store en http-cache: `isMoneyNoStorePath` (`/api/cobros*`,
  `repartidor-finanzas`, `liquidaciones`, `entregas/pendientes`) responde
  `Cache-Control: no-store` / `private, no-store`.

## Consecuencias

Positivas:
- Dinero fresco (60s) y KPI estable (7d) sin acoplarse.
- ETag barato: sin hash de payloads grandes.
- Invalidacion cruzada entre instancias sin acoplo directo.

Negativas / riesgos:
- Ventana stale 60s en dinero: lecturas consecutivas pueden diferir del ERP.
- `MAX_ENTRY_SIZE = 1MB`, `MAX_TOTAL_CACHE = 50MB` en http-cache: picos
  evictan entradas utiles; vigilar `getCacheStats` hitRate.

## Evidencias

Ficheros (verificados con Glob esta sesion):
- `backend/services/redis-cache.js` (`TTL.REALTIME = 60`, `TTL_BY_DOMAIN`,
  `onInvalidationPattern`, comentarios F5-02)
- `backend/kpi/services/redis_cache.js` (`ALERTS = 604800`, F5-01 cross-invalidation)
- `backend/middleware/http-cache.js` (`ETAG_MAX_BYTES = 256*1024`, `generateETag md5`,
  `isMoneyNoStorePath`, `MAX_ENTRY_SIZE`, `MAX_TOTAL_CACHE`)
- `backend/middleware/network-optimizer.js` (`MAX_ETAG_BYTES`, `setupETagSupport md5`,
  `no-store` dinero)
- `backend/kpi/README.md` (`KPI_CACHE_TTL = 604800`)

Gates:
- Gate dinero: `isMoneyNoStorePath` => `no-store`, sin entrada en cache.
- Gate ETag: `>256KB` no genera ETag.
- Gate KPI: `EX: 604800` en set de alertas; invalidacion por patron verificable.
