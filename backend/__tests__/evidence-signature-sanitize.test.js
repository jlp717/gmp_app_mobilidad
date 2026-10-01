'use strict';

const { sanitizeInput, detectSqlInjection } = require('../middleware/security');
const { decodeSignature } = require('../services/delivery-evidence-service');

// 1x1 PNG. Its data URI contains ';' '+' '/' '=' which the global sanitizer
// used to strip, so POST /rutero/evidence/signature returned 400
// INVALID_SIGNATURE_DATA_URI (response body 102 bytes) before any DB write.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
  'base64',
);

function runPipeline(body) {
  const req = { body, query: {} };
  sanitizeInput(req, {}, () => {});
  let blocked = false;
  detectSqlInjection(req, {
    status() { return this; },
    json() { blocked = true; return this; },
  }, () => {});
  return { body: req.body, blocked };
}

test('keeps a signature data URI intact so evidence validation can decode it', () => {
  const dataUri = `data:image/png;base64,${PNG.toString('base64')}`;
  const { body, blocked } = runPipeline({
    documentId: '2026-S-10-404-4300009479',
    repartidorId: '98',
    signature: dataUri,
    firma: dataUri,
  });

  expect(blocked).toBe(false);
  expect(body.signature).toBe(dataUri);
  expect(body.firma).toBe(dataUri);
  expect(decodeSignature(body.signature)).toMatchObject({ mimeType: 'image/png' });
  expect(decodeSignature(body.firma).buffer).toEqual(PNG);
});
