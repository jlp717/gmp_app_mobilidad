# Registro de actividades de tratamiento — GMP App Movilidad

- Estado: **PROPUESTA pendiente de validación legal por Javier**. No es asesoramiento jurídico.
- Fecha: 2026-09-28. Rama: test. Auditoría Tier-1 P11/P12.
- Estilo: frases cortas. Tablas para inventario. Cero secretos.
- Fuentes verificadas esta sesión (código real, no memoria):
  - `backend/routes/entregas.js` líneas 1870–2000, 2000–2095 (receptor, firma, email, recibo PDF).
  - `backend/routes/repartidor.js` líneas 507–579 (tracking GPS por sesión).
  - `backend/routes/clients.js` (teléfonos maestro), `backend/routes/facturas.js` 708–741 (WhatsApp),
    `backend/routes/repartidor-finanzas.js` 1051–1118 (WhatsApp), `backend/routes/warehouse.js` 773–844 (personal interno).
  - `docs/adr/ADR-0016-vendor-scope.md` (alcance por vendedor, roles financieros).

## Inventario

| # | Categoría | Dato | Origen en código | Finalidad operativa | Base propuesta | Ubicación | Accesos (roles) |
|---|---|---|---|---|---|---|---|
| 1 | Receptor entrega | Nombre, apellidos, DNI | `entregas.js:1997-1998` (`RECEPTOR_*` en `JAVIER.TEST_REPARTO_CONFIRMACIONES`); sugerencia `1939-1942`; proyección recibo `2051-2053` | Prueba de entrega ligada a albarán/factura | Ejecución contrato B2B / interés legítimo + obligación fiscal | DB2 for i + PDF recibo | repartidor (solo sus entregas, `1981-1987`), operaciones, jefe_ventas, comercial (alcance vendor ADR-0016) |
| 2 | Firma digital receptor | `FIRMA_EVIDENCE_ID` + BLOB (`EVIDENCE_KIND='FIRMA'`) | `entregas.js:2014-2022` (`JAVIER.TEST_REPARTO_EVIDENCIAS`); subida canónica `/uploads/signature` (`1977-1979` → 410 a `repartidor-finanzas/.../evidence/signature`) | Conformidad fehaciente del receptor | Igual que #1 | DB2 for i (BLOB) + PDF recibo | Igual que #1 |
| 3 | Foto evidencia | Foto entrega | `entregas.js:1974-1976` (`/uploads/photo` → 410 a `evidence/photo`) | Prueba visual de entrega/estado | Interés legítimo; minimización: evitar personas/matrículas si no aportan | DB2 for i / storage evidencias (verificar ruta exacta pendiente) | Igual que #1 |
| 4 | Geolocalización reparto | Sesiones tracking: start/samples/stop/latest, owner-scoped | `repartidor.js:509-579` (`trackingRepo`, `authorizeSingleRepartidorId`) | Operativa de ruta, prueba de visita, último posicionamiento | Interés legítimo + ejecución contrato laboral/de servicio | DB2 for i (tablas tracking — nombre exacto pendiente de verificar en QSYS2) | repartidor (propias), jefe_ventas, operaciones |
| 5 | Email cliente | Email comercial / BBDD / indicado | `entregas.js:1921-1927` (`resolveClientEmail`, `emailCliente`) | Envío de documentos a operaciones + repartidor (email BBDD/indicado o WhatsApp) | Ejecución contrato B2B | DB2 for i (maestro clientes) + PDFs enviados | operaciones, repartidor, comercial |
| 6 | Teléfono cliente | TELEFONO1/2 maestro; teléfono indicado para WhatsApp | `entregas.js:641-642`; `clients.js:318`; `facturas.js:734-741` (`wa.me`); `repartidor-finanzas.js:1063-1118` | Contacto de entrega + envío de documentos por WhatsApp | Ejecución contrato B2B | DB2 for i + enlaces `wa.me` (sin persistencia del mensaje en backend) | comercial, repartidor, operaciones |
| 7 | Documentos fiscales con datos receptor | PDF recibo/albarán (serie completa, receptor, firma) | `entregas.js:2072-2077` (`deliveryReceiptService.saveReceipt`) | Soporte fiscal y comercial del documento | Obligación legal fiscal | DB2 for i + PDFs | operaciones, jefe_ventas |
| 8 | Personal interno | Nombre, código vendedor, rol, teléfono, email | `warehouse.js:773-814` (`JAVIER.ALMACEN_PERSONAL`) | Gestión operativa y contacto interno | Ejecución relación laboral/de servicio | DB2 for i | jefe_ventas, operaciones |

## Notas

- `recipientSuggestion` (`entregas.js:1929-1946`) precarga nombre/apellidos/DNI del último receptor conocido. Revisar información al receptor.
- Teléfonos de cliente son dato de contacto B2B del maestro. Verificar titularidad antes de marketing.
- Tracking GPS es del repartidor en ruta, con ciclo de sesión explícito. No hay tracking de clientes.
- Vendor-scope (`ADR-0016`): `ALL` nunca es código real. Sin `WHERE VENDEDOR='ALL'`. Accesos ya acotados por alcance.

## Retención

Ver `docs/privacidad/politica-retencion.md`. Resumen: DNI/firma/documento = vida del documento + 6 años (art. 30 Código de Comercio, propuesta). GPS = 90 días (propuesta). Logs = 30 días (propuesta).

## Pendiente de Javier (validación legal)

1. Confirmar razón social responsable del tratamiento y datos de contacto/DPD.
2. Validar bases jurídicas y plazos de retención propuestos con asesoría legal.
3. Confirmar ubicación exacta de fotos/evidencias y tablas de tracking en QSYS2.
4. Decidir texto informativo a receptores (quién recoge DNI/firma, para qué, plazo).
5. Contratos de encargado si hay terceros (hosting, mensajería, email).
