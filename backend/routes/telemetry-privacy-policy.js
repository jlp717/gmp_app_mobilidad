'use strict';

const { randomUUID } = require('crypto');
const groups = new Set([
  'auth',
  'dashboard',
  'analytics',
  'clients',
  'router',
  'rutero',
  'objectives',
  'products',
  'vendedores',
  'pedidos',
  'commissions',
  'kpi',
  'facturas',
  'export',
  'health',
  'bolsa',
  'cobros',
  'chatbot',
  'repartidor',
  'entregas',
  'logs',
]);
const screens = new Set([
  'login',
  'dashboard',
  'pedidos',
  'clientes',
  'rutero',
  'reparto',
  'cobros',
  'facturas',
  'commissions',
  'warehouse',
  'chatbot',
]);
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UI']);
const nets = new Set(['wifi', 'mobile', 'none']);

function endpoint(value) {
  if (value === 'render') return 'render';
  if (typeof value !== 'string' || /^https?:/i.test(value)) return 'other';
  const parts = value.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  return parts.length && groups.has(parts[0]) ? `/${parts[0]}` : 'other';
}
function screen(value) {
  return typeof value === 'string' && screens.has(value) ? value : 'unknown';
}
function method(value) {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  return methods.has(normalized) ? normalized : 'OTHER';
}
function net(value) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return nets.has(normalized) ? normalized : 'unknown';
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function status(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function bytes(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}
function normalize(event) {
  const normalized = {
    screen: screen(event.screen),
    endpoint: endpoint(event.endpoint),
    method: method(event.method),
    status: status(event.status),
    t_req: finite(event.t_req),
    bytes: bytes(event.bytes),
    net: net(event.net),
  };
  for (const key of ['t_resp', 't_parsed', 't_render']) {
    const value = finite(event[key]);
    if (value !== null) normalized[key] = value;
  }
  return normalized;
}
module.exports = { randomUUID, normalize };
