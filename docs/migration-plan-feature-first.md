# Plan de migración feature-first

## Orden

1. Features acopladas a `main_shell.dart`, empezando por las de mayor tamaño.
2. Features grandes con providers o servicios mezclados.
3. Features pequeñas y aisladas.

## Regla operativa

Una feature por PR. Desarrollo funcional continúa; cada migración mantiene contratos públicos y comportamiento observable.

## Checklist por feature

- Mapear imports desde `main_shell.dart` y consumidores.
- Mantener modelos puros en domain.
- Extraer interfaz de repositorio y casos de uso sin Flutter/Riverpod.
- Encapsular servicio existente en implementación data con errores tipados.
- Mover providers y ViewModels a presentation.
- Actualizar importadores y ejecutar análisis y tests de feature.
