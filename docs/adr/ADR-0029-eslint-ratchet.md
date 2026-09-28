# ADR-0029 — ESLint ratchet (strict regulada + legacy warn)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

8311 errores con exit distinto de cero bloqueaban cualquier gate honesto.

## Decisión

Ratchet: 31 ficheros regulados a 0/0 estrictos; legacy pasa a warn. Raíz en exit 0 con 0 errores y 7323 warnings. Conversión incremental (nº1: repartidor-history-routes 91, routes/objectives 83, services/pedidos/index 79) → B-P1-4.

## Consecuencias

Positivas: gate verde real sin amnistía total.
Negativas: 7323 warnings vivos; prohibido subir warnings en ficheros regulados.
