'use strict';

const request = require('supertest');
const express = require('express');
const mockQuery = jest.fn(async () => []);
const mockAssigned = jest.fn();
let mockUser;
jest.mock('../config/db', () => ({ query: (...args) => mockQuery(...args), queryWithParams: (...args) => mockQuery(...args) }));
jest.mock('../middleware/auth', () => ({ verifyToken: (req, _res, next) => { req.user = mockUser; next(); } }));
jest.mock('../utils/common', () => ({ ...jest.requireActual('../utils/common'), lookupClientAssignedVendorCodes: (...args) => mockAssigned(...args) }));
const router = require('../routes/objectives');
const app = express();
app.use('/objectives', router);

beforeEach(() => {
  mockQuery.mockClear(); mockAssigned.mockReset();
  mockUser = { code: '35', role: 'COMERCIAL', vendorCodes: ['35'], vendedorCodes: ['35'] };
});
test('foreign client is rejected before contact, notes or sales reads', async () => {
  mockAssigned.mockResolvedValue(['80']);
  const response = await request(app).get('/objectives/matrix').query({ clientCode: '4300030056', vendedorCodes: '35' });
  expect(response.status).toBe(403);
  expect(response.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
  expect(mockQuery).not.toHaveBeenCalled();
});
test('commercial ALL cannot bypass client authorization', async () => {
  mockAssigned.mockResolvedValue(['80']);
  const response = await request(app).get('/objectives/matrix').query({ clientCode: '4300030056', vendedorCodes: 'ALL' });
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
test('unknown client ownership fails closed', async () => {
  mockAssigned.mockResolvedValue([]);
  const response = await request(app).get('/objectives/matrix').query({ clientCode: 'missing', vendedorCodes: '35' });
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
test('limited sales manager ALL cannot access a foreign client', async () => {
  mockUser = { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['35'], vendedorCodes: ['35'] };
  mockAssigned.mockResolvedValue(['80']);
  const response = await request(app).get('/objectives/matrix').query({ clientCode: '4300030056', vendedorCodes: 'ALL' });
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
test('manager without a signed vendor scope fails closed', async () => {
  mockUser = { code: '98', role: 'JEFE_VENTAS' };
  const response = await request(app).get('/objectives/matrix').query({ clientCode: '4300030056', vendedorCodes: 'ALL' });
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
