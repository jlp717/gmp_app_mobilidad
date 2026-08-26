# Evaluación de cursor pagination

## `/api/analytics/sales-history`

### Estado actual

`backend/routes/analytics.js` usa `offset`/`limit` interpolados tras `parseInt`, ordenando solo por año, mes y día descendentes. Flutter (`lib/features/sales_history/data/sales_history_service.dart`) envía `limit` y `offset`, construye cache key con ambos y espera `{rows, count, limit, offset}`; service expone `{items, count}`.

Problemas:

- OFFSET obliga a DB2 a recorrer/descartar filas crecientes en páginas profundas.
- Orden por fecha sin desempate estable puede duplicar u omitir filas entre páginas.
- `limit` y `offset` necesitan límites explícitos aunque sean numéricos.

### Recomendación

**Implementar cursor keyset para sales-history**, solo después de verificar en QSYS2 una columna/tupla única y estable. Cursor: fecha descendente + identificador estable descendente, por ejemplo `(ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO, <ID_VERIFICADO>)`; no usar `NUMERODOCUMENTO` como único desempate sin confirmar unicidad de línea.

Migración segura:

1. Añadir `cursor` opcional y respuesta `nextCursor`/`hasMore`, manteniendo `offset` durante transición.
2. Ordenar por tupla completa y codificar cursor opaco.
3. Adaptar Flutter para almacenar `nextCursor`; mantener parseo anterior hasta retirar compatibilidad.
4. Probar fechas repetidas, inserciones concurrentes y fin de lista.
5. Retirar offset tras telemetría y versión móvil mínima.

Costo: **medio-alto**. Toca SQL/índices DB2, contrato backend, cache keys, provider/pantalla Flutter y clientes instalados. Beneficio esperado alto en páginas profundas; medir offsets 0/500/2.000 antes de priorizar.

## `/api/rutero/week`

Respuesta contiene siete agregados por día, total de clientes y progreso de hoy; no es lista abierta. Paginación añadiría round trips y complicaría consistencia sin reducir volumen útil.

### Recomendación

**Mantener sin paginación.** Optimizar consultas/agregados y caché. Si contrato incorpora clientes detallados, mover detalle a endpoint paginado separado.
