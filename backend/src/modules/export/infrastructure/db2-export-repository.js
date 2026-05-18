/**
 * Export Repository Implementation - DB2
 * READ/WRITE: JAVIER tables for job tracking
 * READ-ONLY: DSEDAC/DSED for data export
 */
const { ExportRepository } = require('../domain/export-repository');
const { ExportJob } = require('../domain/export-job');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2ExportRepository extends ExportRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async createJob(job) {
    const sql = `
      INSERT INTO JAVIER.EXPORT_JOBS 
        (TIPO, FORMATO, FILTROS, ESTADO, USUARIO, FECHA_CREACION)
      VALUES (?, ?, ?, 'PENDING', ?, CURRENT TIMESTAMP)
    `;
    await this._db.executeParams(sql, [
      job.type, job.format, JSON.stringify(job.filters), job.userId || ''
    ]);

    const idSql = `SELECT ID FROM JAVIER.EXPORT_JOBS ORDER BY FECHA_CREACION DESC FETCH FIRST 1 ROWS ONLY`;
    const result = await this._db.executeParams(idSql, []);
    return result && result.length > 0 ? result[0].ID : null;
  }

  async updateStatus(jobId, status, filePath, recordCount) {
    const sql = `
      UPDATE JAVIER.EXPORT_JOBS
      SET ESTADO = ?, 
          RUTA_ARCHIVO = ?, 
          REGISTROS = ?,
          FECHA_COMPLETADO = CURRENT TIMESTAMP
      WHERE ID = ?
    `;
    await this._db.executeParams(sql, [status, filePath || '', recordCount || 0, jobId]);
    return { success: true };
  }

  async getJob(jobId) {
    const sql = `
      SELECT ID, TIPO, FORMATO, FILTROS, ESTADO, RUTA_ARCHIVO, 
             FECHA_CREACION, FECHA_COMPLETADO, REGISTROS
      FROM JAVIER.EXPORT_JOBS
      WHERE ID = ?
    `;
    const result = await this._db.executeParams(sql, [jobId]);
    return result && result.length > 0 ? ExportJob.fromDbRow(result[0]) : null;
  }

  async getUserJobs(userId, limit = 20) {
    const sql = `
      SELECT ID, TIPO, FORMATO, FILTROS, ESTADO, RUTA_ARCHIVO, 
             FECHA_CREACION, FECHA_COMPLETADO, REGISTROS
      FROM JAVIER.EXPORT_JOBS
      WHERE USUARIO = ?
      ORDER BY FECHA_CREACION DESC
      FETCH FIRST ? ROWS ONLY
    `;
    const result = await this._db.executeParams(sql, [userId, limit]);
    return (result || []).map(row => ExportJob.fromDbRow(row));
  }

  async getExportData(type, filters) {
    const vendorCodes = filters.vendedorCodes || 'ALL';
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `${VENDOR_COLUMN} IN (${sanitizeCodeList(vendorCodes)})`;

    switch (type) {
      case 'sales': {
        const year = filters.year || new Date().getFullYear();
        const sql = `
          SELECT 
            LCAADC AS ANIO,
            LCMMDC AS MES,
            LCDDDC AS DIA,
            LCCDCL AS CLIENTE,
            LCCDRF AS PRODUCTO,
            LCIMVT AS VENTAS,
            LCIMVT - LCIMCT AS MARGEN,
            LCCTUD AS CANTIDAD,
            LCSRAB || LCNRAB AS DOCUMENTO
          FROM DSED.LACLAE
          WHERE ${vendorFilter}
            AND ${LACLAE_SALES_FILTER}
            AND LCAADC = ?
          ORDER BY LCAADC, LCMMDC, LCDDDC
        `;
        return await this._db.executeParams(sql, [year]);
      }

      case 'clients': {
        const sql = `
          SELECT 
            CODIGOCLIENTE AS CODIGO,
            NOMBRECLIENTE AS NOMBRE,
            DIRECCION,
            POBLACION,
            PROVINCIA,
            TELEFONO1 AS TELEFONO,
            EMAIL,
            CODIGOVENDEDOR AS VENDEDOR
          FROM DSEDAC.CLI
          WHERE (ANOBAJA IS NULL OR ANOBAJA = 0)
            AND ${vendorFilter ? `CODIGOVENDEDOR IN (${sanitizeCodeList(vendorCodes)})` : '1=1'}
          ORDER BY NOMBRECLIENTE
        `;
        return await this._db.executeParams(sql, []);
      }

      case 'products': {
        const sql = `
          SELECT 
            CODIGOARTICULO AS CODIGO,
            DESCRIPCIONARTICULO AS NOMBRE,
            CODIGOFAMILIA AS FAMILIA,
            PRECIOVENTA AS PRECIO
          FROM DSEDAC.ART
          ORDER BY DESCRIPCIONARTICULO
        `;
        return await this._db.executeParams(sql, []);
      }

      default:
        return [];
    }
  }
}

module.exports = { Db2ExportRepository };
