# 0006 — Cliente-servidor estricto: Flutter solo habla con la API; offline-first en cliente

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: arquitectura, flutter, offline

## Contexto

La app se usa en campo, con cobertura móvil irregular. El dato vive en DB2 detrás del ERP. Conectar Flutter directamente a DB2 o a servicios internos expondría credenciales, saltaría controles del ERP y haría imposible el modo avión. Los servidores internos (API 192.168.1.230:3335, imágenes 192.168.1.191) están en LAN del negocio.

## Decisión

1. **Frontera única de datos**: Flutter ↔ REST API (Express). Prohibido que el cliente hable con DB2 o con bases/servicios internos de datos. El backend delega routes → controllers/services → repositorios/adapters; sin SQL en routes nuevas.
2. **Excepción documentada**: assets estáticos (imágenes del gestor documental) se sirven por HTTP directo desde `http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo`. Son recursos públicos-internos, no transacciones.
3. **Offline-first en cliente**:
   - Lecturas: servir cache local primero (Hive), refrescar remoto después.
   - Escrituras críticas offline: borrador/cola pendiente local, sincronización solo con conexión, con idempotencia (o `no_retry_reason` documentado cuando no se reintenta).
4. Estados UI obligatorios: loading / empty / error / offline en toda pantalla que consuma red.

## Consecuencias

**Positivas**
- Superficie de ataque mínima: credenciales DB2 nunca salen del backend.
- UX usable sin cobertura; conflictos de sync explícitos en vez de writes ciegos.
- El backend puede evolucionar (cache, réplicas) sin tocar la app.

**Negativas / riesgos**
- Contratos API estables obligatorios (errores tipados, timeouts, paginación); romper contrato rompe flota desplegada.
- Complejidad de cola de sincronización: requiere tests de idempotencia (existen suites `pedidos_idempotency`, `pedidos_contracts`).

## Alternativas consideradas

1. **Online-only** — simplest, pero repartidores sin cobertura pierden jornada; inaceptable.
2. **Cliente con acceso DB2 directo (vía túnel/VPN)** — seguridad inviable: credenciales en miles de móviles.
3. **Sync bidireccional genérica (CRDT)** — potencia sin necesidad actual; YAGNI frente a cola pendiente idempotente.
