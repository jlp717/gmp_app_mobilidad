'use strict';

const code = 'TEST_EXTERNAL_IO_BLOCKED';
const fail = () => {
  const error = new Error('Hermetic test blocked external driver import');
  error.code = code;
  throw error;
};

module.exports = new Proxy(Object.freeze({}), {
  get: (_target, property) => property === '__esModule' ? false : fail,
  apply: fail,
  construct: fail,
});
