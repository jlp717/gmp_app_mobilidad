const zlib = require('zlib');

const COMPRESSION_LEVEL = 6;
const MIN_SIZE_THRESHOLD = 1024;

const COMPRESSED_TYPES = [
  'application/json',
  'application/javascript',
  'application/xml',
  'text/css',
  'text/html',
  'text/plain',
  'text/xml'
];

const SKIP_TYPES = [
  'image/',
  'audio/',
  'video/',
  'font/',
  'application/zip',
  'application/pdf',
  'application/gzip'
];

function shouldCompress(res) {
  const contentType = res.getHeader('Content-Type') || '';
  
  for (const type of SKIP_TYPES) {
    if (contentType.includes(type)) return false;
  }
  
  for (const type of COMPRESSED_TYPES) {
    if (contentType.includes(type)) return true;
  }
  
  return contentType.includes('text/');
}

function createCompressionMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('deflate')) {
    return next();
  }
  
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    const jsonStr = JSON.stringify(data);
    
    if (jsonStr.length < MIN_SIZE_THRESHOLD) {
      return originalJson(data);
    }
    
    if (!shouldCompress(res)) {
      return originalJson(data);
    }
    
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    
    const gzip = zlib.createGzip({ level: COMPRESSION_LEVEL });
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    gzip.write(jsonStr);
    gzip.end();
    
    gzip.on('data', (chunk) => res.write(chunk));
    gzip.on('end', () => res.end());
    gzip.on('error', (err) => {
      console.error('Compression error:', err);
      if (!res.headersSent) {
        originalJson(data);
      } else {
        res.end();
      }
    });
    
    return;
  };
  
  next();
}

module.exports = { createCompressionMiddleware, COMPRESSION_LEVEL, MIN_SIZE_THRESHOLD };
