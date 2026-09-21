# Matriz API comercial — ejecutada el 21/09/2026

Backend probado: `93fd9f8`. Todas las duraciones son ms de HTTP local en el servidor vía SSH; no son medidas de móvil. Cada celda lista acción, HTTP y ms. Las denegaciones 403 indicadas son esperadas y pasan el assert de autorización. UI: PARCIAL en todas las filas.

| Pestaña / flujo | 35 | 80 | 98 JEFE |
|---|---|---|---|
| Panel | No aplica: Panel sólo JEFE | No aplica: Panel sólo JEFE | GET /dashboard/metrics: **200 / 5**<br>GET /dashboard/matrix-data: **200 / 22345**<br>GET /dashboard/recent-sales: **200 / 10**<br>GET /dashboard/sales-evolution: **200 / 13197**<br>GET /analytics/yoy-comparison: **200 / 10** |
| Clientes | GET /clients lista: **200 / 428**<br>GET /clients/:code detalle: **200 / 1035**<br>GET sales-history: **200 / 945** | GET /clients lista: **200 / 2032**<br>GET /clients/:code detalle: **200 / 1973**<br>GET sales-history: **200 / 1440** | GET /clients lista: **200 / 3**<br>GET /clients/:code detalle: **200 / 1082**<br>GET sales-history: **200 / 1079** |
| Ruta | GET /rutero/week: **200 / 698**<br>GET /rutero/day/lunes: **200 / 1411** | GET /rutero/week: **200 / 724**<br>GET /rutero/day/lunes: **200 / 1464** | GET /rutero/week: **200 / 4**<br>GET /rutero/day/lunes: **200 / 5** |
| Objetivos | GET /objectives/evolution: **200 / 15765**<br>GET /objectives/by-client: **200 / 3557**<br>GET /objectives/populations: **200 / 43** | GET /objectives/evolution: **200 / 7**<br>GET /objectives/by-client: **200 / 2229**<br>GET /objectives/populations: **200 / 32**<br>80 personal ≠ suma equipo ALL: **200 / 19210** | GET /objectives/evolution: **200 / 4**<br>GET /objectives/by-client: **200 / 1208**<br>GET /objectives/populations: **200 / 14** |
| Comisiones | GET /commissions/summary: **200 / 4033** | GET /commissions/summary: **200 / 30**<br>GET /commissions/team/80: **200 / 181** | GET /commissions/summary: **200 / 10** |
| Alertas | GET /kpi/dashboard: **200 / 2919**<br>GET /kpi/alerts/summary: **200 / 65**<br>GET /kpi/alerts/clients: **200 / 69**<br>GET /kpi/health: **200 / 36** | GET /kpi/dashboard: **200 / 1431**<br>GET /kpi/alerts/summary: **200 / 34**<br>GET /kpi/alerts/clients: **200 / 28**<br>GET /kpi/health: **200 / 21** | GET /kpi/dashboard: **200 / 446**<br>GET /kpi/alerts/summary: **200 / 16**<br>GET /kpi/alerts/clients: **200 / 17**<br>GET /kpi/health: **200 / 14** |
| Bolsa | GET /bolsa/:vd/status: **200 / 14**<br>GET /bolsa/:vd/movements: **200 / 98**<br>GET /bolsa/:vd/history: **200 / 51** | GET /bolsa/:vd/status: **200 / 18**<br>GET /bolsa/:vd/movements: **200 / 47**<br>GET /bolsa/:vd/history: **200 / 25** | GET /bolsa/:vd/status: **200 / 17**<br>GET /bolsa/:vd/movements: **200 / 19**<br>GET /bolsa/:vd/history: **200 / 13**<br>GET /bolsa/grouped: **200 / 11** |
| Evolución | GET /pedidos/client-evolution/:code: **200 / 3563**<br>GET /evolution/monthly: **200 / 2697** | GET /pedidos/client-evolution/:code: **200 / 1734**<br>GET /evolution/monthly: **200 / 1625** | GET /pedidos/client-evolution/:code: **200 / 921**<br>GET /evolution/monthly: **200 / 9** |
| Asistente | GET /chatbot/health: **200 / 3**<br>POST /chatbot/message: **200 / 45** | GET /chatbot/health: **200 / 4**<br>POST /chatbot/message: **200 / 47** | GET /chatbot/health: **200 / 4**<br>POST /chatbot/message: **200 / 18** |
| Cobros — muestras individuales | GET pendientes primera muestra: **200 / 1311**<br>GET pending-summary: **200 / 14236** | GET pendientes primera muestra: **200 / 322**<br>GET pending-summary: **200 / 3257** | GET pendientes primera muestra: **200 / 5474**<br>GET pending-summary: **200 / 1544** |
| Ver como | GET /rutero/vendedores: **200 / 5**<br>GET /clients vendedor=80 denied: **403 / 9** | GET /rutero/vendedores: **200 / 3**<br>GET /clients vendedor=72 (equipo): **200 / 787**<br>GET /clients vendedor=01 fuera equipo: **403 / 4** | GET /rutero/vendedores: **200 / 8**<br>GET /clients vendedor=35: **200 / 1** |
| switch-role | POST stay COMERCIAL: **200 / 50**<br>POST JEFE_VENTAS denied: **403 / 22**<br>sesión viva tras deny: **200 / 7** | POST stay COMERCIAL: **200 / 8**<br>POST JEFE_VENTAS denied: **403 / 8**<br>sesión viva tras deny: **200 / 3** | POST stay JEFE_VENTAS: **200 / 20**<br>POST JEFE_VENTAS modo comercial: **200 / 19**<br>GET metrics after switch: **200 / 10** |
| Facturas lista | 200 / 423 | 200 / 253 | 200 / 183 |
| Facturas totales | 200 / 233 | 200 / 202 | 200 / 192 |
| Pedidos lista | 200 / 82 | 200 / 22 | 200 / 19 |
| Liquidación resumen | 200 / 926 | 200 / 712 | 200 / 725 |

La etiqueta histórica del runner «Cobros p95» contiene muestras individuales: **no son p95**. Los percentiles de series están debajo. La matriz base tiene 97/97 asserts HTTP; el suplemento de Facturas/Pedidos/Liquidación añade 20/20.

Ver como adicional con token 98:

| Scope | Facturas | Totales factura | Pedidos | Liquidación |
|---|---:|---:|---:|---:|
| 98 ver como 35 | 200 / 10 | 200 / 8 | 200 / 6 | 200 / 711 |
| 98 ver como 80 | 200 / 8 | 200 / 6 | 200 / 4 | 200 / 710 |

## Rendimiento observado

n=5 secuencial por endpoint; p50 mediana, p95 nearest-rank (máximo con n=5). No se vació caché. Primera muestra no significa frío controlado. El servidor había recibido las consultas de la matriz y pruebas concurrentes.

| Endpoint | Rol | Muestras ms | p50 | p95 |
|---|---|---|---:|---:|
| objectives/evolution | 80 | [2, 1, 1, 1, 1] | 1 | 2 |
| cobros/pending-summary/80 | 80 | [2, 2, 1, 1, 0] | 1 | 2 |
| clients/:code/sales-history | 80 | [801, 1, 1, 2, 1] | 1 | 801 |
| pedidos/products | 80 | [3959, 4, 3, 2, 2] | 3 | 3959 |
| pedidos/purchase-history-global | 80 | [7973, 2, 6, 3, 3] | 3 | 7973 |
| dashboard/metrics | 98 | [4, 2, 1, 0, 1] | 1 | 4 |
| entregas/pendientes | 98 modo reparto | [334, 5, 4, 4, 4] | 4 | 334 |

La serie de entregas devolvió lista vacía: prueba autorización, endpoint y estado vacío; no representa un rutero cargado. El flujo funcional con pedido asignado devolvió overlay PEDIDO (795 ms), y cobrar mantuvo la entrega pendiente (92 ms).

Primeras solicitudes costosas de la matriz: objetivos35 15.765 ms, resumen cobros35 14.236 ms, comparación objetivo80/equipo 19.210 ms, matriz Panel98 22.345 ms, evolución Panel98 13.197 ms. Son muestras individuales bajo auditoría concurrente, no p95 ni frío aislado. **SLA frío <3 s no superado.**

Asistente80: respuesta 200/21 ms, vendido118446,91 y objetivo185172,19; evolución septiembre200/6 ms devuelve los mismos importes. Objetivo personal80 no es suma de equipo.

Fuentes: `matrix-tabs-final.jsonl`, `matrix-final.jsonl`, `postdeploy-clients-readonly-v2.jsonl`, `scenario-evidence.json`. La matriz de97 se recuperó íntegramente del output de herramientas de esta misma sesión después de que el suplemento sobrescribiera accidentalmente el archivo; se conserva separada para no perder trazabilidad.
