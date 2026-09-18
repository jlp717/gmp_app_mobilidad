'use strict';

function fail() {
  const error = new Error('Hermetic test blocked environment loader');
  error.code = 'TEST_EXTERNAL_IO_BLOCKED';
  throw error;
}

module.exports = Object.freeze({ loadEnv: fail, overlayRepartoFlags: fail });
