# ADR: Runtime toolchain canónico

## Estado

Propuesto localmente; pendiente de CI foundations y revisión independiente.

## Decisión

`.nvmrc` es la fuente de verdad de Node y debe contener un semver exacto de la rama 24. Los manifiestos y lockfiles derivan su rango como `>=<.nvmrc> <25`. `.fvmrc` es la fuente de verdad de Flutter y debe contener un semver exacto.

Todo workflow que configure Node usa `actions/setup-node` con `node-version-file: .nvmrc`. Todo workflow que configure Flutter usa `subosito/flutter-action@1a449444c387b1966244ae4d4f8c696479add0b2` y `flutter-version-file: .fvmrc`. No se permiten variables o literales duplicados para estas versiones.

`node scripts/quality/toolchain.cjs` valida los manifiestos y todos los YAML de workflows con `js-yaml`. Sus pruebas construyen fixtures temporales con pines correctos e incorrectos.

## Consecuencias y límites

El gate comprueba coherencia estática y que el runtime que lo ejecuta coincide con `.nvmrc`; no certifica que cada dependencia nativa compile con todos los runners. Foundations prueba `bcrypt` y `odbc` sin abrir una conexión. La instalación Linux verificada con `npm ci --offline --ignore-scripts` no construye `odbc`; la carga del driver DB2 real y una conexión IBM i permanecen pendientes de infraestructura autorizada.
