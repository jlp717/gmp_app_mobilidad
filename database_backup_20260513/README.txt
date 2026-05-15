================================================================================
GMP APP MOBILIDAD - INVENTARIO COMPLETO DE BASE DE DATOS
================================================================================
Fecha de backup: 2026-05-13  (miércoles)
Realizado por: @orchestrator (actuando como agente experto completo)
Conexión: ODBC DSN='GMP', usuario JAVIER
Duración: ~25 minutos

================================================================================
RESUMEN - ESQUEMA JAVIER (nuestro esquema - 153 objetos)
================================================================================

TABLAS CON DATOS (65 tablas total, 12 con datos):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 1. RUTERO_CONFIG .............. 926 rows - Configuración de rutas comerciales
 2. COMM_CONFIG ................   1 row  - Configuración de comisiones (IPC/tiers)
 3. COMMISSION_EXCEPTIONS ......   4 rows - Vendedores con comisiones ocultas
 4. COMMERCIAL_TARGETS .........  82 rows - Objetivos mensuales por vendedor
 5. COMMERCIAL_TARGETS_HISTORY .   1 row  - Historial cambios en objetivos
 6. PAYMENT_CONDITIONS .........  23 rows - Formas de pago configuradas
 7. COMMISSION_PAYMENTS ........  26 rows - Pagos de comisiones realizados
 8. PEDIDOS_CAB ................  15 rows - Pedidos app móvil (cabecera)
 9. PEDIDOS_LIN ................  21 rows - Pedidos app móvil (líneas)
10. ALMACEN_PERSONAL ...........   5 rows - Personal almacén
11. LACLAE_RESUMEN ............. 500+rows - Resumen comercial por cliente
12. LOGIN_ATTEMPTS ............. BigInt  - Intentos de login

TABLAS VACÍAS (53 tablas):
- DELIVERY_STATUS, REPARTIDOR_ENTREGAS, REPARTIDOR_COBROS, COBROS
- CLIENT_SIGNERS (vacia porque se usa DSEDAC.CLI)
- REPARTIDOR_FIRMAS, REPARTIDOR_LIQUIDACION_OPS, LQD
- REPARTIDOR_OBJETIVOS, REPARTIDOR_COMMISSION_TIERS
- ALMACEN_ART_DIMENSIONES, ALMACEN_CAMIONES_CONFIG
- ALMACEN_CARGA_HISTORICO, ALMACEN_CARGA_MANUAL
- ALMACEN_CONFIG_GLOBAL, CART_CONTENT, CLIENT_NOTES
- KPI_ALERTS, KPI_FILE_AUDIT, KPI_LOADS, KPI_MIGRATIONS
- LQD_COMMISSION_TIERS, LQD_IDEMPOTENCY, LQD_LIQUIDACIONES
- MOVIMIENTOS_BOLSA, OBJ_CONFIG, OBJ_HISTORY
- PEDIDOS_SEQ, PEDIDOS_STOCK_RESERVE
- REPARTIDOR_FINANCIAL_BALANCES, REPARTIDOR_LIQUIDACION_EMAILS
- RUTERO_LOG, SECURITY_AUDIT, STG_LAC_FACTURAS
- VENDOR_PIN_HASHES, VENTAS_B
- CUSTOMER_CREDENTIALS, CUSTOMER_EMAILS, CUSTOMER_PASSWORDS
- PASSWORD_RESET_TOKENS, VERIFICATION_CODES, REFRESH_TOKENS
- COMMISSION_SNAPSHOT_2026_0102
- 8 BKP_* tablas (backup 20260427)

VISTAS (87 total, 81 propias + 6 de sistema):
- 6 vistas sistema: SYSCHKCST, SYSCST, SYSCSTCOL, SYSCSTDEP, SYSKEYCST, SYSREFCST
- 2 vistas DIM: DIM_CLIENTE, DIM_VENDEDOR
- 20 vistas V_DIM: V_DIM_ALMACEN, V_DIM_ARTICULO, V_DIM_CLIENTE_EXT,
  V_DIM_CUENTA, V_DIM_FECHA, V_DIM_GEOGRAFIA, V_DIM_MARCA, V_DIM_MONEDA,
  V_DIM_ORDEN, V_DIM_PAIS, V_DIM_PREFAMILIA, V_DIM_PRESENTACION,
  V_DIM_PROVEEDOR, V_DIM_RUTA, V_DIM_SUBFAMILIA, V_DIM_TIPO,
  V_DIM_TIPO_VEHICULO, V_DIM_VEHICULO, V_DIM_VENDEDOR, V_DIM_VENDEDOR_EXT
- 15 vistas V_FACT: V_FACT_CAJA, V_FACT_COMISIONES_2015, V_FACT_MUESTRAS,
  V_FACT_PESAJES_SALIDAS, V_FACT_PREPARACION_PEDIDOS, V_FACT_REMESAS_PAGO,
  V_FACT_RESUMEN_VENTAS, V_FACT_TARIFAS_PROVEEDOR, V_FACT_VENTAS, V_FACT_VENTAS_GB
- 9 vistas V_STG/LAC: V_STG_LAC, V_STG_LFC_TAX_DOC, V_STG_LFC_TAX_DOC_IVA,
  V_LACLAE_MASTER, V_LAP_LPC, V_PUENTE_PED_ALB_FRA
- 7 vistas VW: VW_DIM_ARTICULO, VW_DIM_CLIENTE, VW_DIM_FORMAPAGO,
  VW_DIM_RUTA, VW_DIM_VENDEDOR, VW_FACT_VENTAS, VW_FACT_VENTAS_DIA,
  VW_FACT_VENTAS_UNIDADES
- 6 vistas VX: VX_KEYS_CAC, VX_KEYS_LAC, VX_KEYS_LAP, VX_KEYS_LGV,
  VX_LAP_DOC_FECHA, VX_LGV_FECHA_DOC
- Otras: V_ACTIVE_SESSIONS, V_COBROS_MOROSIDAD, V_COBROS_POR_FACTURA,
  V_CRUT, V_CUSTOMERS_NEED_HASH_UPDATE, V_DEBUG_*, V_ERROR_TRIGGER,
  V_GPS_TERMINALES, V_LEGACY_PASSWORD_CUSTOMERS, V_MAYOR,
  V_MEDIOS_POWERBI, V_MIGRATION_STATS, V_PROD_*, V_PROMO_*,
  V_RECENT_FAILED_LOGINS, V_RRHH_JORNADA, V_SII_*,
  V_STOCK_VALOR_DIARIO, V_TEST, V_VEHICULO_COMBUSTIBLE

================================================================================
RESUMEN - ESQUEMA DSEDAC (ACISA - 500+ tablas)
================================================================================
ATENCIÓN: Este esquema es propiedad de ACISA. No hemos creado tablas aquí,
solo consultamos sus tablas desde nuestras vistas/app.

Tablas DSEDAC que usamos en vistas JAVIER:
- DSEDAC.CAC - Cabecera albaranes cliente
- DSEDAC.LAC - Líneas albaranes cliente  
- DSEDAC.ART - Artículos
- DSEDAC.ALM - Almacenes
- DSEDAC.FAM - Familias
- DSEDAC.CFC - Cabecera facturas cliente
- DSEDAC.LFC - Líneas facturas cliente (via V_STG_LFC_*)
- DSEDAC.TAB - Tipos albarán
- DSEDAC.AVR - Asignación Ruteros a Vendedores
- DSEDAC.CLI - Clientes
- DSEDAC.VEN - Vendedores
- DSEDAC.RUT - Rutas
- DSEDAC.SBE - Sub-empresa
- DSEDAC.LAP - Líneas albaranes proveedor

================================================================================
NOTAS IMPORTANTES
================================================================================
1. Las definiciones CREATE VIEW no se pudieron extraer del catálogo DB2
   (QSYS2.SYSVIEWS no devuelve datos). Las vistas están en el código fuente
   de la app (consultar backend y migraciones SQL).
2. Los datos exportados están en la carpeta /data como dumps JSON
3. Crear tablas: se puede regenerar desde INFORMATION_SCHEMA (columnas capturadas)
4. Tiempo restante: se pueden hacer más consultas si es necesario

================================================================================
ARCHIVOS GENERADOS:
================================================================================
C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad\database_backup_20260513/
├── README.txt                          - Este archivo (inventario completo)
├── JAVIER/
│   ├── all_tables_listing.txt          - Listado completo de 153 objetos
│   ├── BACKUP_COMPLETO.sql             - Script SQL con estructura y datos
│   ├── ddl/                            - Estructura de tablas
│   ├── views/                          - Listado de vistas
│   └── data/
│       ├── DATA_SUMMARY.txt            - Resumen de datos exportados
│       └── (datos crudos en archivos de tool-output)
└── DSEDAC/
    └── (listado de tablas ACISA)
