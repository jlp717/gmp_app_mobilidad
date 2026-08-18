---
name: qa-e2e-patterns
description: Patrones QA para Playwright, k6, Pact y smoke tests post-deploy en GMP y Granja.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
---

## Playwright GMP

Usar page objects por flujo critico. Selectores preferidos:
1. `getByRole`.
2. `getByLabel`.
3. `getByTestId` si existe.
4. CSS solo si el componente no ofrece semantica.

Config base:
```ts
export default defineConfig({
  timeout: 30000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 720 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
})
```

## Tests Resilientes

Esperar estados visibles, no tiempos fijos. No depender de texto volatil si hay rol o label estable. Capturar screenshot y trace ante fallo.

## k6 Templates

CRUD:
```js
export const options = { thresholds: { http_req_duration: ["p(95)<500"], http_req_failed: ["rate<0.01"] } }
```

Busqueda: P95 menor de 800 ms. Auth: P95 menor de 400 ms. Operacion DB2 compleja: P95 menor de 1200 ms en staging.

## Pact y Alternativa Flutter

Si existe Pact, ejecutar consumer y provider verification. Si Flutter no tiene Pact estable, usar JSON schema tests en consumer y provider tests Express con fixtures equivalentes.

## NOT_TESTABLE

Solo QA Lead puede clasificar NOT_TESTABLE. Requiere razon, riesgo, verificacion manual alternativa y sign-off.

## Smoke Post-Deploy

1. `GET /health` HTTP 200.
2. Ruta principal HTTP 200.
3. Tiempo menor de 2000 ms.
4. Logs sin errores ultimos 30 s.
5. DB2 connectivity si health la expone.

## Reporte De Certificacion

Incluir alcance, comandos, resultado, evidencia, riesgos, cobertura de archivos modificados, URL staging y veredicto.
