# Invalidación de caché autenticada

`invalidationMiddleware` conserva la invalidación anticipada de mutaciones autenticadas. No se usa el código HTTP final para inferir si hubo escritura: una transacción puede confirmar antes de que un error o una desconexión impida la respuesta correcta.

La composición activa monta el middleware global `/api` después de `verifyToken` y antes de `cacheMiddleware`. El router canónico `/api/repartidor-finanzas`, que se resuelve antes del montaje global, lo instala después de su autenticación y guarda de escritura. Así una petición anónima, un token sin verificar o un objeto `user` enviado en el body no pueden invalidar caché L1 ni publicar patrones Redis.

Esto reduce churn originado por tráfico no autenticado. No evita invalidaciones de mutaciones autenticadas que finalmente fallen, ni sustituye la invalidación post-commit específica del dominio financiero. No modifica TTL, claves, alcance de usuario/rol, GET ni las respuestas financieras `no-store`.