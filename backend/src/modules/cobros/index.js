/**
 * Cobros Module - DDD Entry Point
 */
const { Cobro } = require('./domain/cobro');
const { CobrosRepository } = require('./domain/cobros-repository');
const { Db2CobrosRepository } = require('./infrastructure/db2-cobros-repository');

module.exports = {
  Cobro,
  CobrosRepository,
  Db2CobrosRepository
};
