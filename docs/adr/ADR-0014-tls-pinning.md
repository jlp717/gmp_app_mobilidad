# ADR-0014 — Pinning TLS: no activar hasta tener kill switch

- Estado: Propuesta (recomendación a Javier)
- Fecha: 2026-09-15
- Decisores: pendiente de Javier (@jlp717)
- Etiquetas: seguridad, red, flutter

## Contexto

`ApiClient` evalúa pins solo en `HttpClient.badCertificateCallback`. Dart invoca ese callback cuando la cadena PKI ya falló, no en cada handshake válido. `GMP_TLS_PINS` está vacío por defecto (`TlsPinningConfig`), así que hoy no hay pinning efectivo. El coste extra de verificar un pin local es ~0 ms; el riesgo real es bloquear toda la flota si rota la hoja de Cloudflare.

## Opciones

1. **(a) Confiar en PKI pública + Cloudflare.** Eliminar o dejar inerte el código de pinning. La confianza es la CA del certificado servido por Cloudflare. Sin kill switch no hay forma de desactivar un pin mal puesto en clientes ya instalados.
2. **(b) Pinning real de CA raíz/intermedia de Cloudflare (SPKI), no de hoja.** Validar la cadena con `SecurityContext` y comparar SPKI. Exige kill switch remoto (`/health/version-check` o equivalente) antes de pinnear, para no ladrillar la flota en una rotación.

## Decisión recomendada

Opción **(a)** hasta existir kill switch remoto y un procedimiento de rotación ensayado. El código actual (pins vacíos, fail-closed solo si alguien define `GMP_TLS_PINS`) se mantiene inerte; no se pinnea en builds de producto.

Opción (b) queda aplazada: no se activa pinning de hoja ni de CA en release sin kill switch.

## Consecuencias

**Positivas**
- Un certificado Cloudflare rotado no deja fuera a los móviles.
- MitM en red hostil sigue dependiendo de la PKI del dispositivo y de HTTPS.

**Negativas / riesgos**
- Un atacante con CA maliciosa instalada en el dispositivo no queda bloqueado por pin.
- Comentarios antiguos en `api_client.dart` que afirman pinning siempre-on son inexactos; este ADR es la fuente.

## Rollback

Ninguno: no cambia el comportamiento de red. Si más adelante se elige (b), revertir este ADR y exigir gate `prod_approved` + kill switch antes del primer pin en release.
