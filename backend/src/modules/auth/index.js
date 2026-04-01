/**
 * Auth Module - DDD Entry Point
 * Exports all domain entities, repositories, and use cases
 */
const { User } = require('./domain/user');
const { AuthRepository } = require('./domain/auth-repository');
const { Db2AuthRepository } = require('./infrastructure/db2-auth-repository');
const { LoginUseCase, AuthError } = require('./application/login-usecase');

module.exports = {
  User,
  AuthRepository,
  Db2AuthRepository,
  LoginUseCase,
  AuthError
};
