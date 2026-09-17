/**
 * Filters Repository Implementation - DB2
 * READ-ONLY: ${comercialErpTable('FI1')}, ${comercialErpTable('FI2')}, ${comercialErpTable('FI3')}, ${comercialErpTable('FI4')}, ${comercialErpTable('FI5')}
 */
const { FilterRepository } = require('../domain/filter-repository');
const { Filter } = require('../domain/filter');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { sanitizeCodeList } = require('../../../../utils/common');
const { comercialErpTable } = require('../../../../utils/comercial-erp-tables');

class Db2FilterRepository extends FilterRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByType(type, vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `F.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        F.CODIGO,
        F.NOMBRE,
        F.TIPO,
        F.ORDEN,
        F.ACTIVO,
        F.DESCRIPCION
      FROM ${comercialErpTable('FI1')} F
      WHERE TRIM(F.TIPO) = ?
        AND ${vendorFilter}
      ORDER BY F.ORDEN
    `;

    const result = await this._db.executeParams(sql, [type]);
    return (result || []).map(row => Filter.fromDbRow(row));
  }

  async findAll(vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `F.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        F.CODIGO,
        F.NOMBRE,
        F.TIPO,
        F.ORDEN,
        F.ACTIVO,
        F.DESCRIPCION
      FROM ${comercialErpTable('FI1')} F
      WHERE ${vendorFilter}
      ORDER BY F.TIPO, F.ORDEN
    `;

    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => Filter.fromDbRow(row));
  }

  async getActive(type, vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `F.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        F.CODIGO,
        F.NOMBRE,
        F.TIPO,
        F.ORDEN,
        F.ACTIVO,
        F.DESCRIPCION
      FROM ${comercialErpTable('FI1')} F
      WHERE F.ACTIVO = 1
        AND TRIM(F.TIPO) = ?
        AND ${vendorFilter}
      ORDER BY F.ORDEN
    `;

    const result = await this._db.executeParams(sql, [type]);
    return (result || []).map(row => Filter.fromDbRow(row));
  }

  async getFilterTables(vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `F.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const tables = [
      comercialErpTable('FI1'),
      comercialErpTable('FI2'),
      comercialErpTable('FI3'),
      comercialErpTable('FI4'),
      comercialErpTable('FI5'),
    ];
    const allFilters = [];

    for (const table of tables) {
      const sql = `
        SELECT 
          F.CODIGO,
          F.NOMBRE,
          F.TIPO,
          F.ORDEN,
          F.ACTIVO,
          F.DESCRIPCION
        FROM ${table} F
        WHERE F.ACTIVO = 1
          AND ${vendorFilter}
        ORDER BY F.TIPO, F.ORDEN
      `;

      const result = await this._db.executeParams(sql, []);
      allFilters.push(...(result || []).map(row => Filter.fromDbRow(row)));
    }

    return allFilters;
  }
}

module.exports = { Db2FilterRepository };
