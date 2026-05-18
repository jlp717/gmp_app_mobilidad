/**
 * Objectives Module - DDD Entry Point
 */
const { Objective, ObjectiveProgress } = require('./domain/objective');
const { ObjectiveRepository } = require('./domain/objective-repository');
const { Db2ObjectiveRepository } = require('./infrastructure/db2-objective-repository');
const { GetObjectivesUseCase } = require('./application/get-objectives-usecase');
const { GetObjectiveProgressUseCase } = require('./application/get-objective-progress-usecase');
const { GetClientMatrixUseCase } = require('./application/get-client-matrix-usecase');

module.exports = {
  Objective,
  ObjectiveProgress,
  ObjectiveRepository,
  Db2ObjectiveRepository,
  GetObjectivesUseCase,
  GetObjectiveProgressUseCase,
  GetClientMatrixUseCase
};
