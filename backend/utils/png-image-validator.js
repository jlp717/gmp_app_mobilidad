'use strict';

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 4 * 1024 * 1024;
const CHANNELS_BY_COLOR_TYPE = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const BIT_DEPTHS_BY_COLOR_TYPE = Object.freeze({
  0: new Set([1, 2, 4, 8, 16]),
  2: new Set([8, 16]),
  3: new Set([1, 2, 4, 8]),
  4: new Set([8, 16]),
  6: new Set([8, 16]),
});

class PngValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PngValidationError';
    this.code = 'INVALID_PNG_IMAGE';
  }
}

function invalid(message) {
  throw new PngValidationError(message);
}

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

function assertDecodablePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalid('PNG signature or length is invalid');
  }
  let offset = 8;
  let header = null;
  let paletteEntries = null;
  let sawImageData = false;
  let endedImageData = false;
  let sawEnd = false;
  const compressedParts = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) invalid('PNG chunk header is truncated');
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) invalid('PNG chunk is truncated');
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== storedCrc) invalid('PNG chunk checksum is invalid');
    if (!header && type !== 'IHDR') invalid('PNG IHDR must be first');
    if (type === 'IHDR') {
      if (header || length !== 13) invalid('PNG IHDR is invalid');
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
        invalid('PNG dimensions are invalid');
      }
      if (!BIT_DEPTHS_BY_COLOR_TYPE[colorType]?.has(bitDepth)
          || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        invalid('PNG encoding is unsupported');
      }
      header = { width, height, bitDepth, colorType };
    } else if (type === 'IDAT') {
      if (!header || sawEnd || endedImageData || length === 0) invalid('PNG IDAT is invalid');
      if (header.colorType === 3 && paletteEntries == null) invalid('PNG palette is required');
      sawImageData = true;
      compressedParts.push(data);
    } else if (type === 'PLTE') {
      if (!header || sawImageData || paletteEntries != null
          || length < 3 || length > 768 || length % 3 !== 0
          || [0, 4].includes(header.colorType)) {
        invalid('PNG palette is invalid');
      }
      paletteEntries = length / 3;
      if (header.colorType === 3 && paletteEntries > (2 ** header.bitDepth)) {
        invalid('PNG palette has too many entries');
      }
    } else if (type === 'IEND') {
      if (!header || !sawImageData || length !== 0 || sawEnd) invalid('PNG IEND is invalid');
      sawEnd = true;
    } else if (typeBytes[0] >= 65 && typeBytes[0] <= 90 && type !== 'PLTE') {
      invalid('PNG contains an unsupported critical chunk');
    }
    if (sawImageData && type !== 'IDAT') endedImageData = true;
    offset = end;
    if (sawEnd) break;
  }
  if (!header || !sawImageData || !sawEnd || offset !== buffer.length) invalid('PNG structure is incomplete');
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  const rowBytes = Math.ceil((header.width * channels * header.bitDepth) / 8);
  const expectedInflatedBytes = (rowBytes + 1) * header.height;
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressedParts), {
      maxOutputLength: expectedInflatedBytes + 1,
    });
  } catch (_) {
    invalid('PNG compressed data is invalid');
  }
  if (inflated.length !== expectedInflatedBytes) invalid('PNG decoded size is invalid');
  const inflatedStride = rowBytes + 1;
  for (let row = 0; row < header.height; row += 1) {
    if (inflated[row * inflatedStride] > 4) invalid('PNG scanline filter is invalid');
  }
  return Object.freeze({ ...header, decodedBytes: inflated.length });
}

module.exports = { PngValidationError, assertDecodablePng };
