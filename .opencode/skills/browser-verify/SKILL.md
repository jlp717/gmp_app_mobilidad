---
name: browser-verify
description: Verificacion interactiva en navegador real (playwright/chrome-devtools), NO solo screenshots. Navega, interactua, verifica consola, network, responsive y estados.
---
# Browser Verify

## Flujo (siempre que haya UI)
1. Navegar a la pantalla/pagina.
2. Interactuar: click, scroll, formularios, hover.
3. Consola: sin errores (list_console_messages).
4. Network: requests correctos, sin 404/500.
5. Responsive: viewport movil y desktop.
6. Estados: loading, empty, error, offline.
7. Screenshot SOLO como evidencia final.

## Reglas
- NUNCA declarar UI completa solo con captura estatica.
- Interactuar de verdad antes de verificar.
- Reportar errores de consola/network con evidencia.
