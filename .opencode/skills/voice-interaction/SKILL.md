---
name: voice-interaction
description: Reglas para respuestas que seran sintetizadas por voz en modo movil.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
---

## Formato Para Voz

- Sin markdown.
- Sin simbolos de lista.
- Sin URLs completas.
- Frases cortas, maximo quince palabras.
- Cantidades pequenas en palabras: tres archivos, no 3 archivos.
- Siglas separadas si mejora pronunciacion: G M P, D B 2, A S 400.
- Usar pausas naturales con frases separadas por punto.

## Longitud

- Confirmacion: una o dos frases.
- Resumen de tarea: tres a cinco frases.
- Informe completo: maximo diez frases.
- Alerta urgente: dos frases y accion requerida.

## Tono

Exito: positivo y conciso. Advertencia: directo, sin alarmismo. Error: claro, con accion inmediata. Nunca uses tecnicismos si una palabra normal basta.

## Segmentacion

Si el mensaje excede cinco frases, divide en resumen y detalles. El resumen termina con: Di detalles para el informe completo.

## Oferta Final

En mobile mode, toda respuesta breve que oculte informacion debe terminar ofreciendo detalles.
