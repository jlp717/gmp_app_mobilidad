'use strict';

const request = require('supertest');
const express = require('express');

const mockAxiosGet = jest.fn();

jest.mock('axios', () => ({
  get: (...args) => mockAxiosGet(...args),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', require('../routes/products'));
  return app;
}

describe('products image route performance contracts', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAxiosGet.mockReset();
    delete process.env.PRODUCT_IMAGES_PATH;
    process.env.PRODUCT_IMAGES_URL = 'http://images.test/base';
    process.env.PRODUCT_IMAGES_DIR_TIMEOUT_MS = '500';
    process.env.PRODUCT_IMAGES_DISCOVERY_BUDGET_MS = '1000';
    process.env.PRODUCT_IMAGES_MAX_SUBDIRS = '2';
    delete process.env.PRODUCT_IMAGES_FILE_TIMEOUT_MS;
  });

  test('image discovery scans a bounded number of subdirectories', async () => {
    mockAxiosGet.mockImplementation(async (url) => {
      if (url.endsWith('/1234/')) {
        return {
          status: 200,
          data: [
            '<a href="FOTOS1/">FOTOS1</a>',
            '<a href="FOTOS2/">FOTOS2</a>',
            '<a href="FOTOS3/">FOTOS3</a>',
            '<a href="FOTOS4/">FOTOS4</a>',
          ].join('\n'),
          headers: {},
        };
      }
      return { status: 200, data: '<a href="readme.txt">readme</a>', headers: {} };
    });

    const res = await request(makeApp()).get('/api/products/1234/image');

    expect(res.status).toBe(404);
    const urls = mockAxiosGet.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => /\/1234\/FOTOS[12]\//.test(url))).toHaveLength(2);
    expect(urls.some((url) => /\/1234\/FOTOS3\//.test(url))).toBe(false);
    expect(urls.some((url) => /\/1234\/FOTOS4\//.test(url))).toBe(false);
  });

  test('image proxy uses a short default fetch timeout', async () => {
    mockAxiosGet.mockImplementation(async (url) => {
      if (url.endsWith('/1234/')) {
        return { status: 200, data: '<a href="1234.jpg">1234.jpg</a>', headers: {} };
      }
      return { status: 200, data: Buffer.from('image'), headers: { 'content-type': 'image/jpeg' } };
    });

    const res = await request(makeApp()).get('/api/products/1234/image');

    expect(res.status).toBe(200);
    const fileCall = mockAxiosGet.mock.calls.find(([url]) => url.endsWith('/1234/1234.jpg'));
    expect(fileCall).toBeDefined();
    expect(fileCall[1]).toMatchObject({ timeout: 2500, responseType: 'arraybuffer' });
  });
});
