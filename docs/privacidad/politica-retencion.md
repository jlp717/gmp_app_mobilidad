# Política de retención — GMP App Movilidad

- Estado: **PROPUESTA pendiente de validación legal por Javier**. No es asesoramiento jurídico.
- Fecha: 2026-09-28. Auditoría Tier-1 P11/P12.
- Detalle de categorías: `docs/privacidad/registro-tratamiento.md`.

## Tabla

| Categoría | Retención propuesta | Purga | Responsable propuesto |
|---|---|---|---|
| DNI/firma receptor + documento fiscal (albarán/factura/recibo) | Vida del documento + 6 años (art. 30 Código de Comercio) | Manual hasta job; borrar evidencias al purgar documento | Backend/SRE ejecuta; Javier valida plazo |
| Foto evidencia entrega | 1 año desde entrega (propuesta) | Manual (pendiente job) | SRE |
| Tracking GPS reparto (sesiones + samples) | 90 días (propuesta) | Job automático **propuesto, no existe** → backlog L10 | SRE (job) + backend (criterio) |
| Logs técnicos/app | 30 días (propuesta) | Rotación manual/configurada | SRE |
| Email/teléfono cliente (maestro B2B) | Mientras dure relación comercial + plazos fiscales para documentos ya emitidos | Manual (baja cliente) | Operaciones + backend |
| Personal interno (vendedores) | Mientras dure relación + plazo laboral aplicable (pendiente legal) | Manual (baja) | Operaciones |
| Recibos/PDFs enviados | Igual que documento fiscal que soportan | Manual | Operaciones |

## Purga automática

- No existe ningún job de purga hoy. Toda purga automática es **propuesta**.
- Acción: crear backlog L10 — job por categoría (GPS primero, volumen mayor), con dry-run + log + confirmación antes del primer borrado real.
- Prohibido borrar en producción sin confirmación explícita de Javier (regla PROD).

## Pendiente de Javier

1. Validar cada plazo con asesoría legal antes de borrar nada.
2. Priorizar job GPS-90d en L10/backlog (sí/no).
3. Confirmar responsable final por categoría (tabla trae propuesta).
