/**
 * Rutero Module - DDD Entry Point
 */
const { RutaConfig } = require('./domain/ruta-config');
const { RuteroRepository } = require('./domain/rutero-repository');
const { Db2RuteroRepository } = require('./infrastructure/db2-rutero-repository');

module.exports = {
  RutaConfig,
  RuteroRepository,
  Db2RuteroRepository
};
