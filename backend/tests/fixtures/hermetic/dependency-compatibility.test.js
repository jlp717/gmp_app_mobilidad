'use strict';

const bodyParser = require('body-parser');
const express = require('express');
const qs = require('qs');
const { PassThrough } = require('node:stream');

function executeUrlencoded(middleware, payload) {
  return new Promise((resolve) => {
    const request = new PassThrough();
    request.method = 'POST';
    request.url = '/synthetic';
    request.headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': String(Buffer.byteLength(payload)),
    };
    middleware(request, {}, (error) => resolve({ body: request.body, error }));
    request.end(payload);
  });
}

describe('dependency compatibility', () => {
  test('qs supports ordinary nested request parameters', () => {
    expect(qs.parse('cliente[nombre]=Ana&items[]=uno&items[]=dos')).toEqual({
      cliente: { nombre: 'Ana' },
      items: ['uno', 'dos'],
    });
  });

  test('Express compiles and uses its extended query parser without listening', () => {
    const app = express();
    app.set('query parser', 'extended');

    const parseQuery = app.get('query parser fn');
    expect(parseQuery('pedido[id]=42&lineas[]=A&lineas[]=B')).toEqual({
      pedido: { id: '42' },
      lineas: ['A', 'B'],
    });
  });

  test('body-parser parses a synthetic urlencoded stream without listening', async () => {
    const middleware = bodyParser.urlencoded({ extended: true, limit: '16kb' });
    await expect(executeUrlencoded(middleware, 'cliente[nombre]=Ana&lineas[]=A&lineas[]=B')).resolves.toEqual({
      body: { cliente: { nombre: 'Ana' }, lineas: ['A', 'B'] },
      error: undefined,
    });
  });

  test('body-parser reports the configured limit for a synthetic stream without listening', async () => {
    const middleware = bodyParser.urlencoded({ extended: true, limit: '4b' });
    const result = await executeUrlencoded(middleware, 'nombre=Ana');
    expect(result.error).toMatchObject({ status: 413, type: 'entity.too.large' });
  });
});
