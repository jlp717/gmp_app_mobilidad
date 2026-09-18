'use strict';

function blockedDbCall() {
  const error = new Error('Hermetic test blocked database adapter');
  error.code = 'TEST_EXTERNAL_IO_BLOCKED';
  throw error;
}

module.exports = Object.freeze({
  query: blockedDbCall,
  queryWithParams: blockedDbCall,
  execute: blockedDbCall,
  acquireConfiguredConnection: blockedDbCall,
  closePool: async () => undefined,
  runWithDbRequestContext: (_context, next) => next(),
  getDbCircuitState: () => ({ state: 'blocked' }),
});
