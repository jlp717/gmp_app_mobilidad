'use strict';

const zlib = require('zlib');
const { assertDecodablePng } = require('../utils/png-image-validator');
const { decodeSignature } = require('../services/delivery-evidence-service');
const { createRepartoReceiptPdfService } = require('../services/reparto-receipt-pdf-service');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function rgbaPng(filter) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([filter, 0, 0, 0, 255]))),
    chunk('IEND'),
  ]);
}

function indexedPng({ palette }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 1;
  ihdr[9] = 3;
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', palette));
  parts.push(chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0]))), chunk('IEND'));
  return Buffer.concat(parts);
}

function receipt() {
  return {
    confirmationId: 'filter-guard', documentId: 'ALB-filter-guard',
    cliente: { codigo: 'C1', nombre: 'CLIENTE' }, pedido: { ejercicio: 2026, numero: 1 },
    confirmedAt: '2026-08-18T20:00:00Z', status: 'ENTREGADO',
    lineas: [{
      lineaId: 'L1', codigoArticulo: 'A1', descripcion: 'ARTICULO',
      cantidadPedida: 1, cantidadEntregada: 1, cantidadRechazada: 0,
      cantidadPendiente: 0, precioUnitario: 1,
    }],
    receptor: { nombre: 'ANA', apellidos: 'PRUEBA', dni: '00000000T' },
    incidencia: {}, observaciones: '', firmaEvidenceId: 'ev_signature', cobro: null,
  };
}

test('rejects a CRC-valid PNG whose decoded scanline uses an invalid filter', async () => {
  const invalidFilterPng = rgbaPng(5);
  expect(() => assertDecodablePng(invalidFilterPng))
    .toThrow(expect.objectContaining({ code: 'INVALID_PNG_IMAGE' }));
  expect(() => decodeSignature(`data:image/png;base64,${invalidFilterPng.toString('base64')}`))
    .toThrow(expect.objectContaining({ code: 'INVALID_SIGNATURE_IMAGE', statusCode: 415 }));

  const uncaught = [];
  const capture = (error) => uncaught.push(error);
  process.on('uncaughtException', capture);
  try {
    await expect(createRepartoReceiptPdfService().render({
      receipt: receipt(),
      signature: { mimeType: 'image/png', contentBase64: invalidFilterPng.toString('base64') },
    })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', statusCode: 503 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(uncaught).toEqual([]);
  } finally {
    process.removeListener('uncaughtException', capture);
  }
});

test('keeps a normal Flutter-compatible RGBA PNG renderable', async () => {
  const validPng = rgbaPng(0);
  expect(assertDecodablePng(validPng)).toMatchObject({ width: 1, height: 1, colorType: 6 });
  const result = await createRepartoReceiptPdfService().render({
    receipt: receipt(), signature: { mimeType: 'image/png', contentBase64: validPng.toString('base64') },
  });
  expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('requires a valid indexed palette before image data', () => {
  expect(() => assertDecodablePng(indexedPng({ palette: null })))
    .toThrow(expect.objectContaining({ code: 'INVALID_PNG_IMAGE' }));
  expect(() => assertDecodablePng(indexedPng({ palette: Buffer.alloc(2) })))
    .toThrow(expect.objectContaining({ code: 'INVALID_PNG_IMAGE' }));
  expect(() => assertDecodablePng(indexedPng({ palette: Buffer.alloc(9) })))
    .toThrow(expect.objectContaining({ code: 'INVALID_PNG_IMAGE' }));
  expect(assertDecodablePng(indexedPng({ palette: Buffer.from([0, 0, 0, 255, 255, 255]) })))
    .toMatchObject({ colorType: 3, bitDepth: 1 });
});
