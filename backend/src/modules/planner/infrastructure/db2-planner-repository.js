/**
 * Planner Repository Implementation - DB2
 * READ-ONLY: DSEDAC.OPP (orders), DSEDAC.VEH (vehicles)
 * READ/WRITE: JAVIER.ALMACEN_CARGA_MANUAL, JAVIER.ALMACEN_CARGA_HISTORICO, JAVIER.ALMACEN_CAMIONES_CONFIG
 */
const { PlannerRepository } = require('../domain/planner-repository');
const { LoadPlan } = require('../domain/load-plan');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { sanitizeCodeList } = require('../../../../utils/common');

class Db2PlannerRepository extends PlannerRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getDayPlan(date, vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `ACM.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        ACM.ID,
        ACM.VEHICULO,
        ACM.FECHA,
        ACM.VENDEDOR,
        ACM.ORDENES,
        ACM.PESO,
        ACM.VOLUMEN,
        ACM.ESTADO,
        ACM.NOTAS
      FROM JAVIER.ALMACEN_CARGA_MANUAL ACM
      WHERE ACM.FECHA = ?
        AND ${vendorFilter}
      ORDER BY ACM.FECHA, ACM.VEHICULO
    `;

    const result = await this._db.executeParams(sql, [date]);
    return (result || []).map(row => LoadPlan.fromDbRow(row));
  }

  async savePlan(plan) {
    const existingSql = `
      SELECT ID FROM JAVIER.ALMACEN_CARGA_MANUAL 
      WHERE FECHA = ? AND VEHICULO = ?
    `;
    const existing = await this._db.executeParams(existingSql, [plan.date, plan.vehicle]);

    if (existing && existing.length > 0) {
      const sql = `
        UPDATE JAVIER.ALMACEN_CARGA_MANUAL
        SET ORDENES = ?, PESO = ?, VOLUMEN = ?, ESTADO = ?, NOTAS = ?, 
            FECHA_ACTUALIZACION = CURRENT TIMESTAMP
        WHERE FECHA = ? AND VEHICULO = ?
      `;
      await this._db.executeParams(sql, [
        JSON.stringify(plan.orders), plan.weight, plan.volume, plan.status, plan.notes,
        plan.date, plan.vehicle
      ]);
    } else {
      const sql = `
        INSERT INTO JAVIER.ALMACEN_CARGA_MANUAL 
          (VEHICULO, FECHA, VENDEDOR, ORDENES, PESO, VOLUMEN, ESTADO, NOTAS, FECHA_CREACION)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
      `;
      await this._db.executeParams(sql, [
        plan.vehicle, plan.date, plan.vendor,
        JSON.stringify(plan.orders), plan.weight, plan.volume, plan.status, plan.notes
      ]);
    }

    const histSql = `
      INSERT INTO JAVIER.ALMACEN_CARGA_HISTORICO 
        (VEHICULO, FECHA, VENDEDOR, ORDENES, PESO, VOLUMEN, ESTADO, NOTAS, FECHA_REGISTRO)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
    `;
    await this._db.executeParams(histSql, [
      plan.vehicle, plan.date, plan.vendor,
      JSON.stringify(plan.orders), plan.weight, plan.volume, plan.status, plan.notes
    ]);

    return { success: true };
  }

  async updateStatus(planId, status) {
    const sql = `
      UPDATE JAVIER.ALMACEN_CARGA_MANUAL
      SET ESTADO = ?, FECHA_ACTUALIZACION = CURRENT TIMESTAMP
      WHERE ID = ?
    `;
    await this._db.executeParams(sql, [status, planId]);
    return { success: true, planId, status };
  }

  async getVehicles() {
    const sql = `
      SELECT 
        ACC.ID,
        ACC.MATRICULA,
        ACC.CAPACIDAD_PESO,
        ACC.CAPACIDAD_VOLUMEN,
        ACC.ACTIVO,
        ACC.NOTAS
      FROM JAVIER.ALMACEN_CAMIONES_CONFIG ACC
      WHERE ACC.ACTIVO = 1
      ORDER BY ACC.MATRICULA
    `;
    return await this._db.executeParams(sql, []);
  }

  async getPendingOrders(date, vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `OPP.CODIGOVENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        OPP.NUMERO_PEDIDO,
        OPP.FECHA_PEDIDO,
        OPP.CODIGO_CLIENTE,
        CLI.NOMBRECLIENTE AS NOMBRE_CLIENTE,
        OPP.DIRECCION_ENTREGA,
        OPP.PESO_TOTAL,
        OPP.VOLUMEN_TOTAL,
        OPP.ESTADO,
        OPP.OBSERVACIONES
      FROM DSEDAC.OPP OPP
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(OPP.CODIGO_CLIENTE)
      WHERE DATE(OPP.FECHA_ENTREGA) = ?
        AND ${vendorFilter}
        AND OPP.ESTADO = 'P'
      ORDER BY OPP.NUMERO_PEDIDO
    `;

    return await this._db.executeParams(sql, [date]);
  }

  async getHistory(dateFrom, dateTo, vendorCodes) {
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `ACH.VENDEDOR IN (${sanitizeCodeList(vendorCodes)})`;

    const sql = `
      SELECT 
        ACH.ID,
        ACH.VEHICULO,
        ACH.FECHA,
        ACH.VENDEDOR,
        ACH.ORDENES,
        ACH.PESO,
        ACH.VOLUMEN,
        ACH.ESTADO,
        ACH.NOTAS,
        ACH.FECHA_REGISTRO
      FROM JAVIER.ALMACEN_CARGA_HISTORICO ACH
      WHERE ACH.FECHA BETWEEN ? AND ?
        AND ${vendorFilter}
      ORDER BY ACH.FECHA DESC, ACH.VEHICULO
    `;

    const result = await this._db.executeParams(sql, [dateFrom, dateTo]);
    return (result || []).map(row => LoadPlan.fromDbRow(row));
  }
}

module.exports = { Db2PlannerRepository };
