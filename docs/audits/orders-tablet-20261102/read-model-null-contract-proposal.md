# READ_MODEL — excepción propuesta para contrato nullable

Estado: BLOCKED tras la tercera reparación. No se ha aplicado una cuarta intervención.

La revisión independiente ejecutó 143 pruebas en seis suites con exit code 0, pero reprodujo un defecto adicional: los campos `timeline.snapshot` y `snapshot.payload` usan `nullable: true` junto a `$ref`. AJV6 ignora ese sibling. El runtime devuelve legítimamente `snapshot: null` cuando no encuentra el evento y `payload: null` cuando falta el snapshot o está corrupto. Esas respuestas incumplen el contrato publicado aunque las pruebas anteriores pasen.

Se propone una única reparación sobre dos archivos:

- `docs/openapi/openapi.yaml`: en ambos nodos usar `anyOf` con el `$ref` original y una segunda rama `type: object`, `nullable: true`, `enum: [null]`. Conservar las allowlists y el rechazo de propiedades adicionales; no introducir `type: null`, que no corresponde a OpenAPI 3.0.
- `backend/__tests__/openapi-contract.test.js`: probar las respuestas `snapshot: null`/not_found, `payload: null`/missing y corrupt, los objetos válidos y el rechazo de primitivas y extras anidados.

El verificador ya evaluó la propuesta sobre una copia en memoria del YAML real y el AJV6 instalado: 7/7 casos correctos, exit code 0, cero archivos editados y cero consultas DB. La reparación requiere conservar esa prueba como regresión ejecutable, ejecutar las seis suites y una revisión independiente. Si esta intervención excepcional falla, el contrato vuelve a BLOCKED sin otro intento.

La revisión de seguridad separada pasó 128 pruebas en cuatro suites y no encontró exposición de datos ni elevación de permisos. Ese PASS acotado no anula el veto del contrato nullable.

Origen de la petición de excepción: [loop-engineering/SKILL.md](C:/Users/Javier/.codex/skills/loop-engineering/SKILL.md) exige «Stop after three iterations, two consecutive no-progress rounds, a timeout, a budget limit, a security block, or unresolved ambiguity.» AGENTS.md también limita las reparaciones a tres. La autorización previa de OFF06 sólo cubría la cola offline y no se extiende a este contrato.

La propuesta no modifica reglas de negocio, DB2, credenciales, autenticación ni producción. El escritor actual de cobros debe entregar HOLD antes de aplicarla.

Javier autorizó expresamente «Autorizar esta reparación adicional de dos archivos» el 03/11/2026 a las 06:33 Europe/Madrid. El ledger registra `orders_read_model_exception=PASS`. La autorización se limita a una intervención en los dos archivos enumerados y exige detener el intento ante otro veto independiente.
