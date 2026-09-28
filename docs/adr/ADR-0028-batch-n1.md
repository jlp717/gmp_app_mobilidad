# ADR-0028 — Batch N+1 rutero (chunks 100)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Writes del rutero fila a fila: N+1 con ventana de fallo parcial a mitad de lote.

## Decisión

Batch en chunks de 100 con rollback all-or-nothing preservado.

## Consecuencias

Positivas: elimina N+1 sin cambiar semántica de atomicidad.
Negativas: lote grande sigue atado a una transacción; si crece, partir en sublotes con idempotencia.
