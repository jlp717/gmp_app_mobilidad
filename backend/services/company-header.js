'use strict';

const fs = require('fs');
const path = require('path');

const HEADER_PNG_PATH = path.join(__dirname, '../assets/header.png');
const HEADER_WIDTH = 515;
const HEADER_TOP_PADDING = 10;
const HEADER_BOTTOM_PADDING = 10;

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24
      || buffer.readUInt32BE(0) !== 0x89504e47
      || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('El header corporativo no es un PNG valido');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function getHeaderAsset() {
  if (!fs.existsSync(HEADER_PNG_PATH)) {
    const error = new Error('No existe el header corporativo real');
    error.code = 'COMPANY_HEADER_ASSET_UNAVAILABLE';
    throw error;
  }
  const buffer = fs.readFileSync(HEADER_PNG_PATH);
  const dimensions = pngDimensions(buffer);
  if (!dimensions.width || !dimensions.height) {
    const error = new Error('El header corporativo real no tiene dimensiones validas');
    error.code = 'COMPANY_HEADER_ASSET_UNAVAILABLE';
    throw error;
  }
  return Object.freeze({ buffer, dimensions });
}

function drawCompanyHeader(doc, { yStart = 10 } = {}) {
  const { dimensions } = getHeaderAsset();
  const pageWidth = Number(doc?.page?.width);
  const pageLeft = Number(doc?.page?.margins?.left) || 0;
  const pageRight = Number(doc?.page?.margins?.right) || 0;
  if (!Number.isFinite(pageWidth) || typeof doc.image !== 'function') {
    throw new TypeError('Documento PDF no compatible con el header corporativo');
  }
  const availableWidth = pageWidth - pageLeft - pageRight;
  const width = Math.min(HEADER_WIDTH, availableWidth);
  const height = width * dimensions.height / dimensions.width;
  const x = pageLeft + (availableWidth - width) / 2;
  const y = Number(yStart);
  if (!Number.isFinite(y)) throw new TypeError('yStart no valido');
  doc.image(HEADER_PNG_PATH, x, y, { width, height });
  return y + height + HEADER_BOTTOM_PADDING;
}

module.exports = {
  HEADER_PNG_PATH,
  HEADER_WIDTH,
  HEADER_TOP_PADDING,
  HEADER_BOTTOM_PADDING,
  getHeaderAsset,
  drawCompanyHeader,
};
