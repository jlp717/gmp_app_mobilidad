/**
 * Master Module - DDD Entry Point
 */
const { MasterData } = require('./domain/master-data');
const { MasterRepository } = require('./domain/master-repository');
const { Db2MasterRepository } = require('./infrastructure/db2-master-repository');
const { GetMasterDataUseCase } = require('./application/get-master-data-usecase');

module.exports = {
  MasterData,
  MasterRepository,
  Db2MasterRepository,
  GetMasterDataUseCase
};
