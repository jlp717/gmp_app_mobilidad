/**
 * Objectives Repository Implementation - DB2
 */
const { ObjectiveRepository } = require('../domain/objective-repository');
const { Objective, ObjectiveProgress } = require('../domain/objective');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { sanitizeCodeList } = require('../../../../utils/common');

class Db2ObjectiveRepository extends ObjectiveRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByVendor(vendedorCodes, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `O.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND O.ANIO = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        O.VENDEDOR,
        O.ANIO,
        O.MES,
        O.TIPO,
        COALESCE(O.OBJETIVO, 0) AS OBJETIVO,
        COALESCE(L.VENTAS, 0) AS ACTUAL
      FROM JAVIER.OBJETIVOS O
      LEFT JOIN (
        SELECT VENDEDOR, ANIO, MES, SUM(IMPORTE) AS VENTAS
        FROM JAVIER.LACLAE
        WHERE ${vendorFilter}
          ${yearFilter}
        GROUP BY VENDEDOR, ANIO, MES
      ) L ON L.VENDEDOR = O.VENDEDOR AND L.ANIO = O.ANIO AND L.MES = O.MES
      WHERE ${vendorFilter}
        ${yearFilter}
      ORDER BY O.VENDEDOR, O.ANIO, O.MES
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
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const familyFilter = family ? `AND TRIM(A.CODFAM) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (family) params.push(family);
    params.push(limit, offset);

    const sql = `
      SELECT 
        L.CODIGO AS CLIENTE,
        COALESCE(C.NOMCLI, L.CODIGO) AS NOMBRE_CLIENTE,
        L.CODART AS PRODUCTO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE_PRODUCTO,
        COALESCE(A.CODFAM, '') AS FAMILIA,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.CANTIDAD), 0) AS UNIDADES,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(L.CODIGO)
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE ${vendorFilter}
        ${yearFilter}
        ${familyFilter}
      GROUP BY L.CODIGO, C.NOMCLI, L.CODART, A.DESCART, A.CODFAM
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    return await this._db.executeParams(sql, params);
  }

  async save(objective) {
    const sql = `
      MERGE INTO JAVIER.OBJETIVOS O
      USING (VALUES (?, ?, ?, ?)) AS V(VENDEDOR, ANIO, MES, TIPO)
      ON O.VENDEDOR = V.VENDEDOR AND O.ANIO = V.ANIO AND O.MES = V.MES AND O.TIPO = V.TIPO
      WHEN MATCHED THEN UPDATE SET O.OBJETIVO = ?
      WHEN NOT MATCHED THEN INSERT (VENDEDOR, ANIO, MES, TIPO, OBJETIVO) VALUES (?, ?, ?, ?, ?)
    `;

    await this._db.executeParams(sql, [
      objective.vendedor, objective.year, objective.month, objective.type,
      objective.target,
      objective.vendedor, objective.year, objective.month, objective.type, objective.target
    ]);

    return objective;
  }
}

module.exports = { Db2ObjectiveRepository };
