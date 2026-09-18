# Evidencia de autorización en lane aislada

Las suites `reparto-confirmation-actor-privilege`, `chatbot_authorization` y `chatbot_reparto_scope` caracterizan permisos de actor, propiedad de cliente y selección de reparto con dobles herméticos. Las comprobaciones incluyen scope propio, selector requerido, flotas autorizadas y rechazo de códigos ajenos antes de abrir una conexión.

Esta evidencia no sustituye pruebas HTTP de extremo a extremo ni afirma que BOLA esté cubierto en todos los endpoints. La autorización real sigue dependiendo de los claims y middleware de producción.
