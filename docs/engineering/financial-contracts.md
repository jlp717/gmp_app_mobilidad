# Contratos financieros en la lane aislada

La lane Jest aislada incorpora cinco suites revisadas con dobles locales: confirmación de reparto, cierre de liquidación, entradas estructuradas, outbox y repositorio de confirmación DB2. Cubren replay e incompatibilidad de identidad, cantidades e importes acotados, preflight de capacidades, rollback simulado, outbox durable, requeue y redacción de errores.

Las pruebas de repositorio usan conexiones fake y el DDL de test como texto. Acreditan la secuencia y los parámetros esperados, no una transacción real en DB2 for i, el commit del driver ni DDL ejecutado.
