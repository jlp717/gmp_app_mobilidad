/**
 * Objectives Repository Implementation - DB2
 */
const { ObjectiveRepository } = require('../domain/objective-repository');
const { Objective, ObjectiveProgress } = require('../domain/objective');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { LACLAE_SALES_FILTER, sanitizeCodeList, getVendorColumnExpr } = require('../../../../utils/common');

function clampInt(value, defaultValue, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

class Db2ObjectiveRepository extends ObjectiveRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByVendor(vendedorCodes, year) {
    const vendorExpr = getVendorColumnExpr('L');
    const cmvVendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `CMV.CODIGOVENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const lacVendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const params = [];
    if (year) {
      params.push(year);
      params.push(year);
    }

    const sql = `
      SELECT 
        CMV.CODIGOVENDEDOR AS VENDEDOR,
        CT.ANIO,
        CT.MES,
        'ventas' AS TIPO,
        COALESCE(CT.IMPORTE_OBJETIVO, COALESCE(CMV.IMPORTEOBJETIVO, 0)) AS OBJETIVO,
        COALESCE(L.VENTAS, 0) AS ACTUAL
      FROM DSEDAC.CMV CMV
      LEFT JOIN JAVIER.COMMERCIAL_TARGETS CT 
        ON CT.CODIGOVENDEDOR = CMV.CODIGOVENDEDOR
        AND CT.ACTIVO = 'S'
        ${year ? 'AND CT.ANIO = ?' : ''}
      LEFT JOIN (
        SELECT 
          ${vendorExpr} AS VENDEDOR,
          L.LCAADC AS ANIO,
          L.LCMMDC AS MES,
          COALESCE(SUM(L.LCIMVT), 0) AS VENTAS
        FROM DSED.LACLAE L
        WHERE ${LACLAE_SALES_FILTER}
          AND ${lacVendorFilter}
          ${year ? 'AND L.LCAADC = ?' : ''}
        GROUP BY ${vendorExpr}, L.LCAADC, L.LCMMDC
      ) L ON L.VENDEDOR = CMV.CODIGOVENDEDOR 
        AND L.ANIO = CT.ANIO 
        AND L.MES = CT.MES
      WHERE ${cmvVendorFilter}
      ORDER BY CMV.CODIGOVENDEDOR, CT.ANIO, CT.MES
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Objective.fromDbRow(row));
  }

  async getProgress(vendedorCodes, year) {
    const objectives = await this.findByVendor(vendedorCodes, year);

    const byVendor = {};
    objectives.forEach(obj => {
      if (!byVendor[obj.vendedor]) {
        byVendor[obj.vendedor] = { objectives: [], summary: {} };
      }
      byVendor[obj.vendedor].objectives.push(obj);
    });

    return Object.entries(byVendor).map(([vendedor, data]) => {
      const totalTarget = data.objectives.reduce((s, o) => s + o.target, 0);
      const totalActual = data.objectives.reduce((s, o) => s + o.actual, 0);
      return new ObjectiveProgress({
        vendedor,
        year,
        objectives: data.objectives,
        summary: {
          totalTarget,
          totalActual,
          progress: totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0,
          achieved: data.objectives.filter(o => o.isAchieved).length,
          total: data.objectives.length
        }
      });
    });
  }

  async getClientMatrix(vendedorCodes, year, filters = {}) {
    const { limit = 50, offset = 0, family = null } = filters;
    const safeLimit = clampInt(limit, 50, 1, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const vendorCol = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const familyFilter = family ? `AND TRIM(ART.CODIGOFAMILIA) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (family) params.push(family);
    params.push(safeOffset, safeLimit);

    const sql = `
      SELECT 
        L.LCCDCL AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE_CLIENTE,
        L.LCCDRF AS PRODUCTO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE_PRODUCTO,
        COALESCE(ART.CODIGOFAMILIA, '') AS FAMILIA,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      LEFT JOIN DSEDAC.ART ART ON ART.CODIGOARTICULO = L.LCCDRF
      WHERE ${vendorFilter}
        AND ${LACLAE_SALES_FILTER}
        ${yearFilter}
        ${familyFilter}
      GROUP BY L.LCCDCL, CLI.NOMBRECLIENTE, L.LCCDRF, ART.DESCRIPCIONARTICULO, ART.CODIGOFAMILIA
      ORDER BY VENTAS DESC
      OFFSET ? ROWS FETCH FIRST ? ROWS ONLY
    `;

    return await this._db.executeParams(sql, params);
  }

  async save(objective) {
    const sql = `
      MERGE INTO JAVIER.COMMERCIAL_TARGETS CT
      USING (VALUES (?, ?, ?)) AS V(CODIGOVENDEDOR, ANIO, MES)
      ON CT.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND CT.ANIO = V.ANIO AND CT.MES = V.MES
      WHEN MATCHED THEN UPDATE SET CT.IMPORTE_OBJETIVO = ?, CT.ACTIVO = 'S'
      WHEN NOT MATCHED THEN INSERT (CODIGOVENDEDOR, ANIO, MES, IMPORTE_OBJETIVO, ACTIVO) VALUES (?, ?, ?, ?, 'S')
    `;

    await this._db.executeParams(sql, [
      objective.vendedor, objective.year, objective.month,
      objective.target,
      objective.vendedor, objective.year, objective.month, objective.target
    ]);

    return objective;
  }
}

module.exports = { Db2ObjectiveRepository };
