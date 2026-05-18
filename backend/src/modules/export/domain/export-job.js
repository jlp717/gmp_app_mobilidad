/**
 * ExportJob Entity - Export Domain
 */
const { Entity } = require('../../../core/domain/entity');

class ExportJob extends Entity {
  constructor({ id, type, format, filters, status, filePath, createdAt, completedAt, recordCount }) {
    super(id);
    this._type = type;
    this._format = format;
    this._filters = filters || {};
    this._status = status || 'PENDING';
    this._filePath = filePath || '';
    this._createdAt = createdAt || new Date().toISOString();
    this._completedAt = completedAt || null;
    this._recordCount = recordCount || 0;
  }

  get type() { return this._type; }
  get format() { return this._format; }
  get filters() { return this._filters; }
  get status() { return this._status; }
  get filePath() { return this._filePath; }
  get createdAt() { return this._createdAt; }
  get completedAt() { return this._completedAt; }
  get recordCount() { return this._recordCount; }

  complete(filePath, recordCount) {
    this._status = 'COMPLETED';
    this._filePath = filePath;
    this._recordCount = recordCount;
    this._completedAt = new Date().toISOString();
  }

  fail(error) {
    this._status = 'FAILED';
    this._filePath = error || '';
    this._completedAt = new Date().toISOString();
  }

  static fromDbRow(row) {
    return new ExportJob({
      id: row.ID || row.EJ_ID,
      type: row.TIPO || row.EJ_TIPO,
      format: row.FORMATO || row.EJ_FORMATO,
      filters: row.FILTROS ? JSON.parse(row.FILTROS) : {},
      status: row.ESTADO || row.EJ_ESTADO || 'PENDING',
      filePath: row.RUTA_ARCHIVO || row.EJ_RUTA || '',
      createdAt: row.FECHA_CREACION || row.EJ_CREATED,
      completedAt: row.FECHA_COMPLETADO || row.EJ_COMPLETED,
      recordCount: parseInt(row.REGISTROS || row.EJ_RECORDS || 0)
    });
  }
}

module.exports = { ExportJob };
