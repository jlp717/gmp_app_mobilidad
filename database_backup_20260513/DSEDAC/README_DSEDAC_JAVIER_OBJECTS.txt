================================================================================
OBJETOS CREADOS POR JAVIER EN ESQUEMA DSEDAC
================================================================================
ENCONTRADOS: 4 TABLAS (0 vistas)

1. DSEDAC.COMM_CONFIG (TABLE)
   - Columnas: ID, YEAR, IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT, TIER3_MAX, TIER3_PCT, TIER4_PCT
   - Filas: 1
   - Uso: Configuración de comisiones anual (misma que JAVIER.COMM_CONFIG)

2. DSEDAC.CLI_AUTH (TABLE)
   - Columnas: CODIGOCLIENTE(CHAR10), PASSWORD_HASH(VARCHAR255), CREATED_AT(TIMESTAMP), UPDATED_AT(TIMESTAMP), LAST_LOGIN(TIMESTAMP), LOGIN_ATTEMPTS(INT), LOCKED_UNTIL(TIMESTAMP)
   - Filas: 2
   - Uso: Autenticación de clientes (passwords hasheados)

3. DSEDAC.CLI_TOKENS (TABLE)
   - Columnas: TOKEN_ID(INT), CODIGOCLIENTE(CHAR10), REFRESH_TOKEN(VARCHAR500), DEVICE_INFO(VARCHAR500), IP_ADDRESS(VARCHAR45), CREATED_AT(TIMESTAMP), EXPIRES_AT(TIMESTAMP), REVOKED(CHAR1), REVOKED_AT(TIMESTAMP)
   - Filas: ~190
   - Uso: Refresh tokens JWT para autenticación de clientes

4. DSEDAC.CLI_LOGIN_HISTORY (TABLE)
   - Columnas: HISTORY_ID(INT), CODIGOCLIENTE(CHAR10), LOGIN_TIME(TIMESTAMP), IP_ADDRESS(VARCHAR45), USER_AGENT(VARCHAR500), SUCCESS(CHAR1), FAILURE_REASON(VARCHAR200)
   - Filas: ~246
   - Uso: Historial de intentos de login de clientes

NOTA: También existe DSEDAC.COMM_CONFIG con la misma estructura que JAVIER.COMM_CONFIG
      (probablemente duplicada o migrada)
================================================================================
