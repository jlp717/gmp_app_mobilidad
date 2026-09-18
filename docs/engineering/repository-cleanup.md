# Limpieza de copias locales de recuperación

Fecha: 2026-09-18. Alcance: REP-01A.

Se retiraron sólo del índice de Git las siguientes copias locales de recuperación:

- `backend/repositories/reparto-finance-db2-repository.js.fromgit`
- `backend/repositories/reparto-finance-db2-repository.js.repaired`
- `backend/routes/repartidor-finanzas.js.tmp2`

Los archivos no se borraron ni movieron. Se verificó antes y después de la retirada que cada ruta conserva el mismo tamaño y el mismo SHA-256 local. Las rutas canónicas que siguen versionadas son `backend/repositories/reparto-finance-db2-repository.js` y `backend/routes/repartidor-finanzas.js`.

Las tres reglas exactas de `.gitignore` evitan que estas copias vuelvan a añadirse de forma accidental. Las auditorías, inventarios, baselines y backlog fechados no se reescribieron: sus referencias describen el snapshot histórico en que se recogieron.

La retirada no afirma que las copias sean equivalentes a los canónicos ni recupera espacio físico. Cualquier borrado o archivado físico requiere una decisión posterior y explícita.
