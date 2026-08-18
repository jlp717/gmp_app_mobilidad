---
name: rag-retrieval
description: Uso eficaz del RAG V4 antes de disenar, implementar o responder sobre el codebase.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
---

## Cuando Usar RAG

Usar RAG antes de implementar, antes de disenar, ante preguntas sobre el codebase, ante bugs similares, incidentes, decisiones previas o correcciones de Javier.

## Queries Efectivas

Combinar dominio, accion y tecnologia. Ejemplos:
- `validacion stock pedidos express db2`
- `pantalla reparto modal rutero flutter`
- `error ODBC connection failed gmp-api`

## Colecciones

- Existe ya esto: `codebase`.
- Que corrigio Javier: `user_corrections`, prioridad maxima.
- Como funciona: `documentation` y `codebase`.
- Bug similar: `github_issues` y `lessons`.
- Incidente: `lessons` y `anti_patterns`.
- Seguridad: `security_findings`.

## Distancias

- Menor de 0.5: muy similar, leer archivo completo antes de actuar.
- 0.5 a 1.2: relevante, usar como contexto y verificar.
- Mayor de 1.2: no confiar salvo que no haya otra fuente.

## Actualizar Indice

Cuando aparezca una decision, correccion o patron nuevo, llamar `memory-save` con la coleccion correcta. Despues de cambios de codigo, ejecutar o programar `rag-indexer.py`.

## Fallos ChromaDB

Declarar modo degradado. Usar fallback por keywords y lectura directa de archivos. No fingir que RAG funciono.

## Limites

RAG no sustituye leer el archivo completo. RAG no prueba runtime. RAG puede estar obsoleto si el indexer no corrio.

## Anti-Patrones

No lanzar diez queries paralelas sin objetivo. No confiar en un unico resultado. No reutilizar codigo sin entender el dominio.
