/**
 * Entregas Module - DDD Entry Point
 */
const { Albaran } = require('./domain/albaran');
const { EntregasRepository } = require('./domain/entregas-repository');
const { Db2EntregasRepository } = require('./infrastructure/db2-entregas-repository');

module.exports = {
  Albaran,
  EntregasRepository,
  Db2EntregasRepository
};
