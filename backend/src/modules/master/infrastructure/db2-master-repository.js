/**
 * Master Repository Implementation - DB2
 * READ-ONLY: DSEDAC.FAM (families), DSEDAC.TRF (tarifas), DSEDAC.VDD (vendors), DSEDAC.FPA (payment conditions)
 * READ/WRITE: JAVIER.PAYMENT_CONDITIONS
 */
const { MasterRepository } = require('../domain/master-repository');
const { MasterData } = require('../domain/master-data');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2MasterRepository extends MasterRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getByType(type) {
    switch (type) {
      case 'families': return await this.getFamilies();
      case 'tarifas': return await this.getTarifas();
      case 'vendors': return await this.getVendors();
      case 'payment_conditions': return await this.getPaymentConditions();
      default: return [];
    }
  }

  async getAll() {
    const [families, tarifas, vendors, paymentConditions] = await Promise.all([
      this.getFamilies(),
      this.getTarifas(),
      this.getVendors(),
      this.getPaymentConditions()
    ]);

    return {
      families,
      tarifas,
      vendors,
      payment_conditions: paymentConditions
    };
  }

  async update(type, code, data) {
    if (type === 'payment_conditions') {
      const sql = `
        UPDATE JAVIER.PAYMENT_CONDITIONS
        SET NOMBRE = ?, DIAS = ?, ACTIVO = ?, FECHA_ACTUALIZACION = CURRENT TIMESTAMP
        WHERE CODIGO = ?
      `;
      await this._db.executeParams(sql, [data.name, data.days, data.active ? 1 : 0, code]);
      return { success: true };
    }
    return { success: false, error: 'Cannot update read-only master data' };
  }

  async getFamilies() {
    const sql = `
      SELECT 
        CODIGOFAMILIA AS CODIGO,
        DESCRIPCIONFAMILIA AS NOMBRE
      FROM DSEDAC.FAM
      ORDER BY CODIGOFAMILIA
    `;
    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => MasterData.fromDbRow(row, 'family'));
  }

  async getTarifas() {
    const sql = `
      SELECT 
        CODIGOTARIFA AS CODIGO,
        DESCRIPCIONTARIFA AS NOMBRE
      FROM DSEDAC.TRF
      ORDER BY CODIGOTARIFA
    `;
    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => MasterData.fromDbRow(row, 'tarifa'));
  }

  async getVendors() {
    const sql = `
      SELECT 
        CODIGOVENDEDOR AS CODIGO,
        NOMBREVENDEDOR AS NOMBRE
      FROM DSEDAC.VDD
      ORDER BY NOMBREVENDEDOR
    `;
    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => MasterData.fromDbRow(row, 'vendor'));
  }

  async getPaymentConditions() {
    try {
      const sql = `
        SELECT 
          PC.CODIGO,
          PC.NOMBRE,
          PC.DIAS,
          PC.ACTIVO
        FROM JAVIER.PAYMENT_CONDITIONS PC
        ORDER BY PC.CODIGO
      `;
      const result = await this._db.executeParams(sql, []);
      if (result && result.length > 0) {
        return result.map(row => new MasterData({
          type: 'payment_condition',
          code: row.CODIGO,
          name: row.NOMBRE,
          description: `${row.DIAS} days`,
          active: row.ACTIVO !== 0,
          extra: { days: row.DIAS }
        }));
      }
    } catch (e) {
      // Table may not exist, fall back to DSEDAC.FPA
    }

    const sql = `
      SELECT 
        CODIGOFORMAPAGO AS CODIGO,
        DESCRIPCIONFORMAPAGO AS NOMBRE,
        DIASPAGO AS DIAS
      FROM DSEDAC.FPA
      ORDER BY CODIGOFORMAPAGO
    `;
    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => new MasterData({
      type: 'payment_condition',
      code: row.CODIGO,
      name: row.NOMBRE,
      description: `${row.DIAS || 0} days`,
      active: true,
      extra: { days: row.DIAS || 0 }
    }));
  }
}

module.exports = { Db2MasterRepository };
