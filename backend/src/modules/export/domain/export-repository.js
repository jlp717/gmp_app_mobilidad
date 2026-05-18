/**
 * Export Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class ExportRepository extends Repository {
  async createJob(job) {
    throw new Error('Method not implemented: createJob');
  }

  async updateStatus(jobId, status, filePath, recordCount) {
    throw new Error('Method not implemented: updateStatus');
  }

  async getJob(jobId) {
    throw new Error('Method not implemented: getJob');
  }

  async getUserJobs(userId, limit = 20) {
    throw new Error('Method not implemented: getUserJobs');
  }

  async getExportData(type, filters) {
    throw new Error('Method not implemented: getExportData');
  }
}

module.exports = { ExportRepository };
