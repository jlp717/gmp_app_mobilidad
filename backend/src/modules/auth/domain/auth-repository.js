/**
 * Auth Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class AuthRepository extends Repository {
  async findByCredentials(username, password) {
    throw new Error('Method not implemented: findByCredentials');
  }

  async findByCode(code) {
    throw new Error('Method not implemented: findByCode');
  }

  async updatePassword(userId, newPasswordHash) {
    throw new Error('Method not implemented: updatePassword');
  }

  async logLoginAttempt(userId, success, ip) {
    throw new Error('Method not implemented: logLoginAttempt');
  }
}

module.exports = { AuthRepository };
