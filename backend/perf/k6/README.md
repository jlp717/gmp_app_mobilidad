# k6 GMP API

**PROHIBIDO ejecutar carga contra producción.** Solo entorno de pruebas JAVIER / `localhost:3335` (`http://localhost:3335`, `http://127.0.0.1:3335`, o URL que contenga `JAVIER`/`staging`). El script lanza error si `BASE_URL` no cumple.

Perfil: 30 VU constantes durante 3 minutos, con mezcla ponderada de lecturas móviles. `setup()` ejecuta `/api/auth/login` una vez como warmup solo cuando recibe `LOGIN_USERNAME` y `LOGIN_PASSWORD`. `BASE_URL` y `TOKEN` son obligatorias. `VENDEDOR_CODE` es ajustable; `ALL` requiere token de jefe de ventas.

Parámetros mínimos verificados: `vendedorCodes`; `page`/`limit` en pedidos y resumen de cobros; `limit` en top clientes. Ajustarlos al scope real sin añadir filtros no verificados.

## Instalar en Debian/Ubuntu

```bash
curl -fsSL https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Baseline y post-cambio

Definir antes `BASE_URL`, `TOKEN` y `VENDEDOR_CODE` en shell. Credenciales de login son opcionales y solo sirven al warmup; nunca guardarlas en Git.

```bash
mkdir -p backend/perf/k6/results
SUMMARY_EXPORT='backend/perf/k6/results/baseline.json' k6 run backend/perf/k6/load-test.js
SUMMARY_EXPORT='backend/perf/k6/results/after.json' k6 run backend/perf/k6/load-test.js
```

Thresholds por endpoint alineados con `docs/perf/latency-budgets.md` (p95 500 ms interacción, 800 ms login, 1.500 ms analítica pesada). JSON incluye submétricas por endpoint y `p(50)`, `p(95)`, `p(99)`.

## 429 del rate limiter de cobros

El limiter de cobros (`backend/middleware/security.js`) permite **240 req/min/usuario**. Con 30 VU y la mezcla actual (cobros ~23% del tráfico), el volumen hacia `/api/cobros/pending-summary/:vendedorCode` ronda el límite: los HTTP 429 en ese endpoint son **esperados** y no indican degradación real.

Excluirlos del análisis:
- En `baseline.json`/`after.json`, descartar muestras con `status=429` antes de calcular p95 por endpoint.
- El check `returned 2xx` fallará para 429; ignorar esos fallos de `checks` al evaluar cobros, o filtrarlos con jq: `jq '.metrics | with_entries(select(.key | test("cobros"))) ...'` excluyendo status 429.

**Nota:** si aparecen 429 masivos en cobros (gran parte de iteraciones bloqueadas), bajar su peso en la mezcla `ENDPOINTS` de `load-test.js` (techo 85→menor) para no distorsionar el baseline.
