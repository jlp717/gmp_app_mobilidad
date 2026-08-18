---
type: concept
status: active
summary: Analisis y parche de vulnerabilidades. AppSec no escribe el fix que audita.
tags: [security, owasp, appsec]
---

# Vuln analysis

Playbook **SECURE**. Explore primero si solo hay que mapear. Si hay parche: maker escribe, `appsec-engineer` audita el diff, Check-Reviewer confirma, `code-quality-contract` cierra.

Orden:

1. Amenaza concreta (XSS, SQLi, auth bypass, secreto, path traversal). Evidencia file:line.
2. Maker parchea con el menor diff correcto. SQL parametrizado. Auth en routes. Allowlist de URLs.
3. AppSec no implementa el parche. Relee el diff en contexto limpio.
4. No hay PASS sin test del vector o prueba negativa equivalente.

Prohibido: dumps de `.env`, PoC ofensivos contra sistemas ajenos, SQL concat, `eval`/`innerHTML` con input de usuario.

Related: [[code-quality-contract]] [[db2-access]] [[deploy-policy]]
