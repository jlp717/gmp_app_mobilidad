---
name: product-design-docs
description: Documentacion de diseno y producto para tareas de interfaz. Genera los artefactos MINIMOS necesarios (design.md, funcionalidades.md, contenido.md como referencia, NO rigido: mas o menos segun alcance) en docs/design/<feature>/.
---
# Product Design Docs

## Principio
Los artefactos son ORIENTATIVOS y se calibran al tamano real de la tarea: una pantalla simple puede necesitar solo design.md; un modulo completo genera los tres y quizas mas (arquitectura de componentes, accesibilidad, i18n). Nunca generar archivos por rellenar.

## Referencia de artefactos (adaptar)
- design.md: sistema visual de la feature (layout, jerarquia, estados, responsive, paleta, no-loop-AI).
- funcionalidades.md: comportamiento, flujos, reglas de negocio visibles, criterios.
- contenido.md: copy real en ES (labels, botones, errores, toasts, empty states).

## Flujo
1. product-ux interpreta (intencion, flujos, criterios).
2. Visual-Design-Specialist disena el sistema visual.
3. Generar/actualizar docs con el minimo suficiente.
4. Implementar contra ellos (Flutter-UI/NextJS).
5. ux-writing afina microcopy.
6. Validar visual (screenshots/estados).

## Reglas
- Integrar con living-spec y el flujo del pilar correspondiente (task-flows).
- Romper loop AI; estados loading/empty/error/offline; accesibilidad.
