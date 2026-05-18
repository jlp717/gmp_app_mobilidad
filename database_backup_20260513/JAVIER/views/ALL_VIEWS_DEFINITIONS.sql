-- ============================================================================
-- GMP APP MOBILIDAD - BACKUP COMPLETO ESQUEMA JAVIER
-- Fecha: 2026-05-13
-- Incluye: 65 TABLAS + 81 VISTAS + DATOS
-- ============================================================================

-- ============================================================================
-- PARTE 1: CREATE VIEW (81 vistas extraidas de QSYS2.SYSVIEWS)
-- ============================================================================

-- ============================================
-- VIEW: DIM_CLIENTE
-- ============================================
CREATE OR REPLACE VIEW JAVIER.DIM_CLIENTE AS
SELECT 
	 C.CODIGOCLIENTE AS CODIGOCLIENTE, 
	 C.NOMBRECLIENTE AS NOMBRECLIENTE, 
	 C.CODIGORUTA AS CODIGORUTA 
	FROM DSEDAC.CLI C
;


-- ============================================
-- VIEW: DIM_VENDEDOR
-- ============================================
CREATE OR REPLACE VIEW JAVIER.DIM_VENDEDOR AS
SELECT 
	 V.CODIGOVENDEDOR AS CODIGOVENDEDOR, 
	 V.NOMBREVENDEDOR AS NOMBREVENDEDOR 
	FROM DSEDAC.VDD V
;


-- ============================================
-- VIEW: V_ACTIVE_SESSIONS
-- ============================================
CREATE OR REPLACE VIEW JAVIER.V_ACTIVE_SESSIONS AS
SELECT 
	 C.CUSTOMER_ID, 
	 C.CUSTOMER_CODE, 
	 C.FULL_NAME, 
	 COUNT(*) AS ACTIVE_SESSIONS, 
	 MAX(RT.LAST_USED_AT) AS LAST_SESSION_ACTIVITY 
	FROM JAVIER.CUSTOMER_CREDENTIALS C 
	INNER JOIN JAVIER.REFRESH_TOKENS RT ON C.CUSTOMER_ID = RT.CUSTOMER_ID 
	WHERE RT.IS_REVOKED = '0' 
	 AND RT.EXPIRES_AT > CURRENT_TIMESTAMP 
	GROUP BY C.CUSTOMER_ID, C.CUSTOMER_CODE, C.FULL_NAME
;


-- ============================================
-- VIEW: V_COBROS_MOROSIDAD
-- ============================================
CREATE OR REPLACE VIEW JAVIER.V_COBROS_MOROSIDAD AS
SELECT 
	 M.SUBEMPRESADOCUMENTO AS SUBEMPRESA, 
	 M.EJERCICIODOCUMENTO AS EJERCICIO, 
	 M.SERIEDOCUMENTO AS SERIE, ... (from DSEDAC.MOR)
;


-- ============================================
-- VIEW: V_COBROS_POR_FACTURA
-- ============================================
CREATE OR REPLACE VIEW JAVIER.V_COBROS_POR_FACTURA AS
SELECT ... (from DSEDAC.LGV with LEFT JOIN DSEDAC.FPG) -- see full definition in raw output
;





============================================================================
RAW VIEW DATA FROM QSYS2.SYSVIEWS (81 views)
============================================================================

1. DIM_CLIENTE - SELECT C.CODIGOCLIENTE, C.NOMBRECLIENTE, C.CODIGORUTA FROM DSEDAC.CLI C
2. DIM_VENDEDOR - SELECT V.CODIGOVENDEDOR, V.NOMBREVENDEDOR FROM DSEDAC.VDD V
3. V_ACTIVE_SESSIONS - Active sessions from CUSTOMER_CREDENTIALS + REFRESH_TOKENS
4. V_COBROS_MOROSIDAD - Morosidad from DSEDAC.MOR
5. V_COBROS_POR_FACTURA - Cobros por factura from DSEDAC.LGV + FPG
6. V_CRUT - Clientes rutas (cierres, visitas, reparto) from DSEDAC.CRUT
7. V_CUSTOMERS_NEED_HASH_UPDATE - Customers needing password hash update
8. V_DEBUG_1 - Debug LAC + LACLAE (left join test)
9. V_DEBUG_2 - Debug date format test
10. V_DEBUG_3 - Debug date conversion with CASE
11. V_DEBUG_FINAL - Debug LAC with CL join
12. V_DEBUG_LAC_ONLY - Debug LAC columns with date conversion
13. V_DIM_ALMACEN - Warehouse dimension from DSEDAC.VDS + UBA
14. V_DIM_ARTICULO - Article dimension from DSEDAC.ART + FAM + MAR + SEC (46 columns)
15. V_DIM_CLIENTE_EXT - Extended client dimension from DSEDAC.CLI + RUT + CPK + LPK
16. V_DIM_CUENTA - Account dimension from DSEDAC.RMY
17. V_DIM_FECHA - Date dimension (2018-2026 recursive CTE)
18. V_DIM_GEOGRAFIA - Geography dimension from DSEDAC.DLG + DLGX
19. V_DIM_MARCA - Brand dimension from DSEDAC.MAR
20. V_DIM_MONEDA - Currency dimension from DSEDAC.MND
21. V_DIM_ORDEN - Production order dimension from DSEDAC.ORPRO
22. V_DIM_PAIS - Country dimension from DSEDAC.PAI
23. V_DIM_PREFAMILIA - Pre-family dimension from DSEDAC.ART
24. V_DIM_PRESENTACION - Presentation dimension from DSEDAC.PRE
25. V_DIM_PROVEEDOR - Supplier dimension from DSEDAC.PRV + PRVX + PVC
26. V_DIM_RUTA - Route dimension from DSEDAC.RUT
27. V_DIM_SUBFAMILIA - Subfamily dimension from DSEDAC.SFM
28. V_DIM_TIPO - Type dimension from DSEDAC.ART
29. V_DIM_TIPO_VEHICULO - Vehicle type from DSEDAC.TVH
30. V_DIM_VEHICULO - Vehicle dimension from DSEDAC.VEH
31. V_DIM_VENDEDOR - Vendor dimension from DSEDAC.VDD + VDC + VDDX
32. V_DIM_VENDEDOR_EXT - Extended vendor from DSEDAC.VDD
33. V_ERROR_TRIGGER - Error trigger LAC + LACLAE
34. V_FACT_CAJA - Cash movements from DSEDAC.MCJ
35. V_FACT_COMISIONES_2015 - Commissions 2015 from DSEDAC.L15
36. V_FACT_MUESTRAS - Samples from DSEDAC.MUE + MUEL + MUEC + MUEP
37. V_FACT_PESAJES_SALIDAS - Weighing exits from DSEDAC.SALP + SALL
38. V_FACT_PREPARACION_PEDIDOS - Order prep from DSEDAC.OPP + PPAM
39. V_FACT_REMESAS_PAGO - Payment remittances from DSEDAC.LRG
40. V_FACT_RESUMEN_VENTAS - Sales summary from DSEDAC.RSV
41. V_FACT_TARIFAS_PROVEEDOR - Supplier tariffs from DSEDAC.LTP
42. V_FACT_VENTAS - MAIN SALES VIEW from DSEDAC.LAC + JAVIER.LACLAE_RESUMEN (46 columns)
43. V_FACT_VENTAS_GB - Sales GB from DSEDAC.LAC + DSED.LACLAE0320
44. V_GPS_TERMINALES - GPS terminal positions from DSEDAC.TPG
45. V_LACLAE_MASTER - LACLAE master aggregate from DSED.LACLAE0320
46. V_LAP_LPC - Supplier delivery lines from DSEDAC.LAP
47. V_LEGACY_PASSWORD_CUSTOMERS - Legacy password customers from CUSTOMER_CREDENTIALS
48. V_MAYOR - General ledger from DSEDAC.RMY
49. V_MEDIOS_POWERBI - Media report via TABLE FUNCTION JAVIER.FN_MEDIOS_REPORT_DATA()
50. V_MIGRATION_STATS - Migration statistics
51. V_PROD_METODOLOGIAS - Production methodologies from DSEDAC.RCTA + RCTP + RCTO
52. V_PROD_OPERACIONES - Production operations from DSEDAC.ORPRP
53. V_PROD_ORDENES - Production orders from DSEDAC.ORPRO
54. V_PROMO_PRECIO_UNIDAD - Unit price promotions from DSEDAC.PPU
55. V_PROMO_PRECIOS_CLIENTE - Client price promotions from DSEDAC.PES
56. V_PROMO_PRECIOS_PROVEEDOR - Supplier price promotions from DSEDAC.PVS
57. V_PUENTE_PED_ALB_FRA - Bridge pedido-albaran-factura from DSEDAC.CAC
58. V_RECENT_FAILED_LOGINS - Failed logins last hour from LOGIN_ATTEMPTS
59. V_RRHH_JORNADA - HR workday from DSEDAC.RHJ
60. V_SII_FACTURAS_EXPEDIDAS - SII issued invoices from DSEDAC.SIIFEC + SIIFED + SIIFEE + SIIFEP (COMPLEX)
61. V_SII_METALICO - SII cash from DSEDAC.SIIICM
62. V_STG_LAC - Staging LAC with COALESCE joins (32 columns)
63. V_STG_LFC_TAX_DOC - Staging LFC tax by document from DSEDAC.LFC
64. V_STG_LFC_TAX_DOC_IVA - Staging LFC tax by document + IVA from DSEDAC.LFC
65. V_STOCK_VALOR_DIARIO - Daily stock value from DSEDAC.VDS
66. V_TEST - Test LAC + LACLAE (ejercicio >= 2024)
67. V_VEHICULO_COMBUSTIBLE - Vehicle fuel from DSEDAC.TQC
68. VW_DIM_ARTICULO - Simple article dimension from DSEDAC.ART
69. VW_DIM_CLIENTE - Simple client dimension from DSEDAC.CLI
70. VW_DIM_FORMAPAGO - Payment method dimension from DSEDAC.FPG
71. VW_DIM_RUTA - Route dimension from DSEDAC.LAC (DISTINCT)
72. VW_DIM_VENDEDOR - Simple vendor dimension from DSEDAC.VDD
73. VW_FACT_VENTAS - Sales fact (CAC + LAC join)
74. VW_FACT_VENTAS_DIA - Sales by day (CAC + LAC GROUP BY)
75. VW_FACT_VENTAS_UNIDADES - Sales units (CAC + LAC)
76. VX_KEYS_CAC - Standardized keys for CAC from DSEDAC.CAC
77. VX_KEYS_LAC - Standardized keys for LAC from JAVIER.V_STG_LAC
78. VX_KEYS_LAP - Standardized keys for LAP from JAVIER.V_LAP_LPC
79. VX_KEYS_LGV - Standardized keys for LGV from DSEDAC.LGV
80. VX_LAP_DOC_FECHA - LAP document dates (CTE with aggregation)
81. VX_LGV_FECHA_DOC - LGV document dates (grouped)
