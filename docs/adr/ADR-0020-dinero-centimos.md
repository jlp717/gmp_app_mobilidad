# ADR-0020 — Dinero en céntimos (Money int64)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

90 hits de doubles para dinero en backend/Flutter. Riesgo de redondeo en liquidación, cobros, facturas y bolsa.

## Decisión

Núcleo Money aditivo en céntimos (int64) con serialización idéntica a la actual. Swap incremental por dominios, sin big-bang.

## Consecuencias

Positivas: elimina error de coma flotante en el núcleo nuevo; serialización idéntica evita ruptura de contrato.
Negativas: swap total pendiente (lista exacta L8a: ~45 campos models, 9 liquidación, consumidores presentation/data, validación rutero 17 hits, entregas/facturas/cobros/bolsa) → B-P1-1.
