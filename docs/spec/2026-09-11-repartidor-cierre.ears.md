# EARS — Cierre perfil REPARTIDOR (2026-09-11)

WHEN el repartidor elige forma de cobro THE system SHALL mostrar «Talón» (nunca «Transferencia») y, si elige talón, exigir número de talón, fecha de vencimiento y banco validado antes de persistir.

WHEN el repartidor entrega más o menos unidades que las previstas THE system SHALL recalcular importe de línea (unitario × entregado) y total del albarán, persistirlo en la confirmación y mostrarlo en GET, UI y liquidación diaria.

WHEN el repartidor va a enviar PDF, modificar cantidades, enviar email, enviar liquidación o completar un albarán THE system SHALL pedir confirmación «¿Estás seguro…?» con Semantics.

WHEN se construye un aviso de reparto THE system SHALL resolver TO/CC de producto con Carlos Corbalán + Javier Lacal + el repartidor actor; isolated_test SHALL construir la lista completa y redirigir SMTP al sink/allowlist sin recortarla.

WHEN se muestra un albarán o factura THE system SHALL usar el identificador completo `serie-terminal-numero` (p.ej. P-15-2296) en PDFs, previews, emails y listados.

WHEN el cobro es obligatorio THE system SHALL marcar «Voy a cobrarlo» por defecto y no permitir desmarcarlo; WHEN es opcional THE system SHALL dejarlo desmarcado hasta que el repartidor lo active.

WHEN se completa una entrega THE system SHALL persistir en JAVIER.TEST_* / JAVIER.REPARTO_* (nunca DSEDAC) y, al recargar GET/app, seguir mostrando el estado terminal.

WHEN se reabre un albarán ya completado THE system SHALL mostrar las tres pestañas Productos / Cobro / Finalizar en solo lectura, salvo cobro parcial pendiente.

Gate: spec_approved conceptual 2026-09-11. Playbook BUILD. Perfil: jefe de ventas en modo reparto + repartidor raso.
