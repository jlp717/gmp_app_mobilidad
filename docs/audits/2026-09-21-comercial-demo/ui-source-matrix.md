# Matriz Flutter: presencia en fuente, no validación visual

Sesión 21/09/2026. Todas las filas: **PARCIAL UI**. El AVD abortó con SIGSEGV/Impeller; los intentos con software rendering y sin Impeller tampoco permitieron completar un flujo. La APK se instaló; eso no prueba navegación ni comportamiento.

Leyenda: L=carga, E=error, V=vacío, O=offline, T=AppColors/AppTheme, S=Semantics, R=Riverpod select. «Sin evidencia» significa que la inspección acotada no encontró prueba suficiente; no demuestra ausencia en widgets hijos.

| Pestaña | Widget | Presencia observada | Sin evidencia suficiente | Referencia |
|---|---|---|---|---|
| Panel (98 JEFE) | dashboard_content.dart | L/E/T | V/O/S/R | 142–143,251 |
| Clientes + historial | simple_client_list_page.dart | L/E/V/T | O/S/R | 56–57,225–309 |
| Ruta | rutero_page.dart | L/E/O/T | V/S/R | 57–63,417–480 |
| Objetivos | objectives_page.dart | L/E/V/T | O/S/R | 50–51,200–322 |
| Comisiones | commissions_page.dart | L/E/T | V/O/S/R | 77–78,162–207 |
| Facturas | facturas_page.dart | L/E/V/T | O/S/R | 62–63,140–183,250–261 |
| Pedidos | pedidos_page.dart | V/O/T | L/E/S/R | 24,37,109,298–317 |
| Alertas/KPI | kpi_dashboard_page.dart | L/E/T | V/O/S/R | 38–39,94–126,157–160 |
| Cobros | cobros_page.dart | L/E/T | V/O/S/R | 11–13,56–57,173,187–192 |
| Liquidación | comercial_liquidacion_diaria_page.dart | L/E/T/S | V/O/R | 71–72,117–138,209–215,261 |
| Bolsa | bolsa_page.dart | L/E/T/S/R | V/O | 177–178,193–226 |
| Evolución | client_evolution_page.dart | L/E/T | V/O/S/R | 75–77,163–188,202 |
| Asistente | chatbot_page.dart | T/R | L/E/V/O/S | 35–42,130–137 |
| Ver como | main_shell.dart / selectedVendorProvider | Cableado de selector | Ejecución UI y estados | 2219–2233,2244–2247 |
| switch-role | main_shell.dart / authProvider.switchRole | Cableado de modo | Ejecución UI y estados | 1118–1309 |

Panel sólo se ofrece a JEFE_VENTAS: es conforme al alcance. El comercial 80 continúa siendo líder, no JEFE.

La protección nueva de cobros no verificables tiene texto explícito «Deuda pendiente de revisión» y «Documento ERP no verificable. Cobro no disponible», AppColors y Semantics en cobro_detail_screen.dart. Los tests Flutter de cobros ejecutados pasan 25/25. El análisis de archivos modificados finaliza con exit 0, cero errores y 275 avisos/informaciones; no se declara lint limpio global.
