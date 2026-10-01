# Hallazgos fuera de la ruta de este cambio

Fecha: 2026-10-01. Auditoría de usabilidad para comerciales y repartidores mayores. Estos cambios no se han aplicado porque el fichero lo tiene otro agente o está fuera de la ruta de escritura.

## `lib/features/dashboard/presentation/pages/main_shell.dart`

Leído: navegación inferior (aprox. líneas 771-809) y rail (aprox. 1560-1584). No editado.

- La etiqueta de la barra inferior está a 9 px (`fontSize: 9` en el `AnimatedDefaultTextStyle` del ítem seleccionado).
- La etiqueta del rail está a 8 px en móvil y 10 px en grande.
- Cambio exacto: subir esas etiquetas a 16 y envolver el ítem en `Semantics(button: true, selected: isSelected, label: item.label)`. Si no cabe en 360 dp, mostrar icono + una sola palabra y el nombre completo en el `tooltip` / semántica, sin recortar el `TextScaler`.

## `lib/core/widgets/accessibility_widgets.dart`

Leído: `TextScalingHelper.getScaledFontSize` recorta el escalado a 1.3. No editado (no está en la ruta permitida).

- Cambio exacto: quitar el `clamp(..., 1.3)` y dejar el `TextScaler` del sistema, como mínimo hasta 2.0. Hoy ningún feature de esta ruta llama a ese helper.

## `lib/core/widgets/error_state_widget.dart` y `empty_state_widget.dart`

Leídos. Texto a 13-14 px y el botón no garantiza 48 dp. No editados.

- Las pantallas de esta ruta ya no los usan para el error principal: usan `GmpErrorPanel` / `GmpEmptyPanel` en `lib/core/design/gmp_feedback.dart`.
- Pedidos, repartidor y almacén siguen con el widget compartido. El cambio allí es sustituir la llamada por `GmpErrorPanel(whatHappened: gmpWhatHappened(mensaje), whatToDo: gmpWhatToDo(mensaje), onRetry: ...)`.

## No abierto en esta pasada

No se han leído las pantallas de `lib/features/pedidos/**` ni `lib/features/repartidor/**` (rutero, entregas, histórico de reparto). No se afirma nada de su usabilidad.
