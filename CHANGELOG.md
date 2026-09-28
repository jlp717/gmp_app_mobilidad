# Changelog

Formato Keep a Changelog. Rama de trabajo: `test`.

## [Unreleased]

- L1 tooling: CI honesta (jest sin `passWithNoTests`), Flutter 3.35.6 único, rollback seguro.
- L2 seguridad: frontera zod, SQL con binds, whitelist de identificadores, TLS fail-closed.
- L3 errores: shape API canónico + `requestId` único + sanitize recursivo.
- L4 dinero: outbox variance con lease claim+token y contrato de caché documentado.
- L5 estructura: esquema único ADR-0001..0019 + índice; purga `src` zombie y residuales; `console` a winston.
- L6 rendimiento: rebuilds con `select`, batch anti N+1, retry con backoff, cero errores en analyze.
- L7 UX: Semantics en cobros/commissions + estado offline en cobros.
- L8 dominio: Money en céntimos + split de pedidos + routes que delegan en services.

Histórico previo en tags del repo.
