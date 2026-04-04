/**
 * Repartidor Repository Implementation - DB2
 */
const { RepartidorRepository } = require('../domain/repartidor-repository');
const { DeliveryRoute, DeliveryItem } = require('../domain/delivery');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2RepartidorRepository extends RepartidorRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getWeekRoutes(repartidorCode, weekStart) {
    const sql = `
      SELECT 
        RC.DIA,
        RC.CODCLI,
        COALESCE(C.NOMCLI, RC.CODCLI) AS NOMCLI,
        C.DIRCLI,
        RC.ORDEN,
        RC.TIEMPO_EST
      FROM JAVIER.RUTERO_CONFIG RC
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(RC.CODCLI)
      WHERE RC.VENDEDOR = ?
        AND RC.DIA BETWEEN ? AND ?
        AND RC.ORDEN >= 0
      ORDER BY RC.DIA, RC.ORDEN
    `;

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const result = await this._db.executeParams(sql, [
      repartidorCode,
      weekStart.toISOString().split('T')[0],
      weekEnd.toISOString().split('T')[0]
    ]);

    const routes = {};
    (result || []).forEach(row => {
      const day = row.DIA;
      if (!routes[day]) {
        routes[day] = new DeliveryRoute({
          id: `${day}`,
          day,
          clientCode: row.CODCLI,
          clientName: row.NOMCLI,
          address: row.DIRCLI,
          estimatedTime: row.TIEMPO_EST
        });
      }
    });

    return Object.values(routes);
  }

  async getDayDeliveries(repartidorCode, date) {
    const sql = `
      SELECT 
        CAC.NUMALB AS ALBARAN,
        CAC.CODCLI AS CLIENTE,
        COALESCE(CLI.NOMCLI, CAC.CODCLI) AS NOMBRE_CLIENTE,
        CAC.FECHA,
        CAC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.ESTADO, 'PENDIENTE') AS ESTADO,
        CACFIRMAS.FIRMA_PATH AS FIRMA
      FROM JAVIER.CAC
      LEFT JOIN JAVIER.CLI CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODCLI)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.NUMALB = CAC.NUMALB
      LEFT JOIN JAVIER.CACFIRMAS ON CACFIRMAS.NUMALB = CAC.NUMALB
      WHERE CAC.VENDEDOR = ?
        AND CAC.FECHA = ?
      ORDER BY CAC.NUMALB
    `;

    const result = await this._db.executeParams(sql, [repartidorCode, date]);
    return (result || []).map(row => new DeliveryItem({
      albaran: row.ALBARAN,
      clientCode: row.CLIENTE,
      clientName: row.NOMBRE_CLIENTE,
      total: parseFloat(row.TOTAL || 0),
      status: row.ESTADO,
      signature: row.FIRMA
    }));
  }

  async getDeliveryDetail(albaranNumber) {
    const cabSql = `
      SELECT 
        CAC.NUMALB AS ALBARAN,
        CAC.CODCLI AS CLIENTE,
        COALESCE(CLI.NOMCLI, CAC.CODCLI) AS NOMBRE_CLIENTE,
        CAC.FECHA,
        CAC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.ESTADO, 'PENDIENTE') AS ESTADO
      FROM JAVIER.CAC
      LEFT JOIN JAVIER.CLI CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODCLI)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.NUMALB = CAC.NUMALB
      WHERE CAC.NUMALB = ?
    `;

    const linSql = `
      SELECT 
        CPC.CODART AS PRODUCTO,
        COALESCE(ART.DESCART, CPC.CODART) AS NOMBRE,
        CPC.CANTIDAD,
        CPC.PRECIO,
        CPC.IMPORTETOTAL AS TOTAL_LINEA
      FROM JAVIER.CPC
      LEFT JOIN JAVIER.ART ART ON ART.CODART = CPC.CODART
      WHERE CPC.NUMALB = ?
      ORDER BY CPC.LINEA
    `;

    const [cab, lines] = await Promise.all([
      this._db.executeParams(cabSql, [albaranNumber]),
      this._db.executeParams(linSql, [albaranNumber])
    ]);

    if (!cab || cab.length === 0) return null;

    return new DeliveryItem({
      albaran: cab[0].ALBARAN,
      clientCode: cab[0].CLIENTE,
      clientName: cab[0].NOMBRE_CLIENTE,
      items: lines || [],
      total: parseFloat(cab[0].TOTAL || 0),
      status: cab[0].ESTADO
    });
  }

  async updateStatus(albaranNumber, status, observations = '') {
    const sql = `
      MERGE INTO JAVIER.DELIVERY_STATUS DS
      USING (VALUES (?)) AS V(NUMALB)
      ON DS.NUMALB = V.NUMALB
      WHEN MATCHED THEN UPDATE SET DS.ESTADO = ?, DS.FECHA_ACT = CURRENT TIMESTAMP, DS.OBSERVACIONES = ?
      WHEN NOT MATCHED THEN INSERT (NUMALB, ESTADO, FECHA_ACT, OBSERVACIONES) VALUES (?, ?, CURRENT TIMESTAMP, ?)
    `;

    await this._db.executeParams(sql, [
      albaranNumber, status, observations,
      albaranNumber, status, observations
    ]);

    return { albaranNumber, status, updatedAt: new Date() };
  }

  async registerSignature(albaranNumber, signaturePath) {
    const sql = `
      MERGE INTO JAVIER.CACFIRMAS CF
      USING (VALUES (?)) AS V(NUMALB)
      ON CF.NUMALB = V.NUMALB
      WHEN MATCHED THEN UPDATE SET CF.FIRMA_PATH = ?, CF.FECHA_FIRMA = CURRENT TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (NUMALB, FIRMA_PATH, FECHA_FIRMA) VALUES (?, ?, CURRENT TIMESTAMP)
    `;

    await this._db.executeParams(sql, [albaranNumber, signaturePath, albaranNumber, signaturePath]);

    return { albaranNumber, signaturePath };
  }

  async getHistorico(repartidorCode, filters = {}) {
    const { year, month, limit = 50, offset = 0 } = filters;
    let whereClause = 'WHERE CAC.VENDEDOR = ?';
    const params = [repartidorCode];

    if (year) {
      whereClause += ' AND YEAR(CAC.FECHA) = ?';
      params.push(year);
    }
    if (month) {
      whereClause += ' AND MONTH(CAC.FECHA) = ?';
      params.push(month);
    }

    params.push(limit, offset);

    const sql = `
      SELECT 
        CAC.NUMALB AS ALBARAN,
        CAC.CODCLI AS CLIENTE,
        COALESCE(CLI.NOMCLI, CAC.CODCLI) AS NOMBRE_CLIENTE,
        CAC.FECHA,
        CAC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.ESTADO, 'PENDIENTE') AS ESTADO
      FROM JAVIER.CAC
      LEFT JOIN JAVIER.CLI CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODCLI)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.NUMALB = CAC.NUMALB
      ${whereClause}
      ORDER BY CAC.FECHA DESC
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    return await this._db.executeParams(sql, params);
  }

  async getCommissions(repartidorCode, year, month) {
    const yearFilter = year ? `AND YEAR(CAC.FECHA) = ?` : '';
    const monthFilter = month ? `AND MONTH(CAC.FECHA) = ?` : '';
    const params = [repartidorCode];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(SUM(CAC.IMPORTETOTAL), 0) AS TOTAL_ENTREGADO,
        COUNT(DISTINCT CAC.NUMALB) AS TOTAL_ALBARANES,
        COUNT(DISTINCT CAC.CODCLI) AS TOTAL_CLIENTES
      FROM JAVIER.CAC
      WHERE CAC.VENDEDOR = ?
        ${yearFilter}
        ${monthFilter}
    `;

    const result = await this._db.executeParams(sql, params);
    return result[0] || { TOTAL_ENTREGADO: 0, TOTAL_ALBARANES: 0, TOTAL_CLIENTES: 0 };
  }
}

module.exports = { Db2RepartidorRepository };
