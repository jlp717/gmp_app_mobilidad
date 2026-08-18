---
name: living-spec
description: Fuente de verdad viva del proyecto. Mantiene docs/spec/<app>.md con PRD, arquitectura, contratos, estado de fases y decisiones. Consultar y actualizar en cada tarea del proyecto.
---
# Living Spec

## Contenido de docs/spec/<app>.md
- Vision y objetivos.
- Historias de usuario y criterios de aceptacion.
- Arquitectura (capas, modulos, fronteras).
- Contratos API (OpenAPI) y modelo de datos.
- Estado de fases (pendiente/en curso/hecho).
- Decisiones (ADRs) y riesgos.

## Reglas
- La spec es la unica fuente de verdad: el equipo la consulta en step context de toda tarea.
- Toda decision de arquitectura se refleja en la spec ANTES de codificar.
- Al cerrar una fase, actualizar estado con evidencia (ruta, test, log).
- Comando /spec abre o actualiza la spec del proyecto activo.

## Flujo
1. Chief lee docs/spec/<app>.md en context.
2. Tareas nuevas se registran contra la spec.
3. Al entregar, actualizar estado y evidencia.
