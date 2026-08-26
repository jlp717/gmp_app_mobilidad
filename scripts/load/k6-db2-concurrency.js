import http from 'k6/http';
import { check, sleep } from 'k6';

// Verified: backend/server.js mounts backend/routes/clients.js at /api/clients.
// forceRefresh bypasses route cache so each iteration reaches central DB2 executor.
// Example: set BASE_URL and K6_JWT securely, then run this file with k6.
// Never target production without PROD gate.
export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
  if (!__ENV.K6_JWT) throw new Error('K6_JWT is required');
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:3335').replace(/\/$/, '');
  const response = http.get(
    `${baseUrl}/api/clients?limit=100&offset=0&forceRefresh=1`,
    { headers: { Authorization: `Bearer ${__ENV.K6_JWT}` } },
  );
  check(response, {
    'clients status 200': (res) => res.status === 200,
    'clients payload returned': (res) => Boolean(res.body),
  });
  sleep(1);
}
