/**
 * Clients Module - DDD Entry Point
 */
const { Client, ClientDetail } = require('./domain/client');
const { ClientRepository } = require('./domain/client-repository');
const { Db2ClientRepository } = require('./infrastructure/db2-client-repository');
const { GetClientsUseCase } = require('./application/get-clients-usecase');
const { GetClientDetailUseCase } = require('./application/get-client-detail-usecase');
const { CompareClientsUseCase } = require('./application/compare-clients-usecase');

module.exports = {
  Client,
  ClientDetail,
  ClientRepository,
  Db2ClientRepository,
  GetClientsUseCase,
  GetClientDetailUseCase,
  CompareClientsUseCase
};
