import http from 'k6/http';
import { check, sleep } from 'k6';

const VUS = 30;
const DURATION = '3m';
const BASE_URL = String(__ENV.BASE_URL || '').replace(/\/$/, '');
// ponytail: allowlist exacta + regex JAVIER/staging; ampliar si aparecen entornos de prueba nuevos.
if (
  BASE_URL &&
  !['http://localhost:3335', 'http://127.0.0.1:3335'].includes(BASE_URL) &&
  !/(JAVIER|staging)/i.test(BASE_URL)
) {
  throw new Error('carga solo contra entorno de pruebas JAVIER; produccion prohibida');
}
const TOKEN = __ENV.TOKEN || '';
const VENDEDOR_CODE = __ENV.VENDEDOR_CODE || 'ALL';

const ENDPOINTS = [
  { ceiling: 20, name: '/api/rutero/week', path: `/api/rutero/week?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}` },
  { ceiling: 38, name: '/api/dashboard/metrics', path: `/api/dashboard/metrics?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}` },
  { ceiling: 52, name: '/api/dashboard/sales-evolution', path: `/api/dashboard/sales-evolution?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}` },
  { ceiling: 62, name: '/api/analytics/trends', path: `/api/analytics/trends?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}` },
  { ceiling: 70, name: '/api/analytics/top-clients', path: `/api/analytics/top-clients?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}&limit=10` },
  { ceiling: 85, name: '/api/cobros/pending-summary/:vendedorCode', path: `/api/cobros/pending-summary/${encodeURIComponent(VENDEDOR_CODE)}?page=1&limit=100` },
  { ceiling: 100, name: '/api/pedidos', path: `/api/pedidos?vendedorCodes=${encodeURIComponent(VENDEDOR_CODE)}&page=1&limit=20` },
];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)'],
  scenarios: {
    mobile_mix: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    // Objetivos p95 por endpoint: docs/perf/latency-budgets.md (PENDIENTE_VALIDAR_CON_BASELINE).
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:/api/auth/login}': ['p(95)<800'],
    'http_req_duration{endpoint:/api/rutero/week}': ['p(95)<500'],
    'http_req_duration{endpoint:/api/dashboard/metrics}': ['p(95)<500'],
    'http_req_duration{endpoint:/api/dashboard/sales-evolution}': ['p(95)<1500'],
    'http_req_duration{endpoint:/api/analytics/trends}': ['p(95)<1500'],
    'http_req_duration{endpoint:/api/analytics/top-clients}': ['p(95)<1500'],
    'http_req_duration{endpoint:/api/cobros/pending-summary/:vendedorCode}': ['p(95)<500'],
    'http_req_duration{endpoint:/api/pedidos}': ['p(95)<500'],
  },
};

export function setup() {
  if (!BASE_URL || !TOKEN) throw new Error('BASE_URL and TOKEN are required');
  const loginUser = __ENV.LOGIN_USERNAME;
  const loginPassword = __ENV.LOGIN_PASSWORD;
  if (!loginUser || !loginPassword) return;
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: loginUser, password: loginPassword }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: '/api/auth/login', phase: 'warmup' } },
  );
  check(response, { 'login warmup returned 2xx': (res) => res.status >= 200 && res.status < 300 });
}

export default function () {
  const roll = Math.random() * 100;
  const endpoint = ENDPOINTS.find((candidate) => roll < candidate.ceiling);
  const response = http.get(`${BASE_URL}${endpoint.path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags: { endpoint: endpoint.name, phase: 'load' },
  });
  check(response, { [`${endpoint.name} returned 2xx`]: (res) => res.status >= 200 && res.status < 300 });
  sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  const destination = __ENV.SUMMARY_EXPORT || 'stdout';
  return { [destination]: `${JSON.stringify(data, null, 2)}\n` };
}
