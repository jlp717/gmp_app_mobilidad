# Contrato de entrada del chatbot

La ruta `POST /api/chatbot/message` valida la forma del body antes de llamar al orquestador. El mensaje es texto con un máximo de 2.000 caracteres. El historial es opcional (o `null`), contiene hasta doce entradas strict y sólo admite roles `user` y `assistant`; sus límites son 2.000 y 3.000 caracteres, respectivamente.

`clientCode` y `repartidorId` son opcionales o `null`; cuando se incluyen son textos no vacíos de hasta 64 caracteres. El usuario, rol y scopes proceden exclusivamente de `req.user`: esas propiedades no forman parte del body permitido.

Un body inválido devuelve HTTP 400 con `{success:false,error:'INVALID_CHATBOT_PAYLOAD',code:'INVALID_CHATBOT_PAYLOAD'}`. No devuelve detalles de Zod, no registra el contenido y no invoca el orquestador. Las respuestas statusCode del orquestador y el error 500 fijo se mantienen.

Este contrato limita estructura y tamaño. La moderación de prompt/inyección y la autorización de clientes, vendedores y reparto siguen en sus módulos respectivos; no afirma cobertura BOLA integral.
