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
        RC.CLIENTE AS CODIGOCLIENTE,
        COALESCE(C.NOMBRECLIENTE, RC.CLIENTE) AS NOMBRECLIENTE,
        C.DIRECCION,
        RC.ORDEN
      FROM JAVIER.RUTERO_CONFIG RC
      LEFT JOIN DSEDAC.CLI C ON TRIM(C.CODIGOCLIENTE) = TRIM(RC.CLIENTE)
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
          id: `${day}-${row.CODIGOCLIENTE}`,
          day,
          clientCode: row.CODIGOCLIENTE,
          clientName: row.NOMBRECLIENTE,
          address: row.DIRECCION,
          estimatedTime: row.ORDEN
        });
      }
    });

    return Object.values(routes);
  }

  async getDayDeliveries(repartidorCode, date) {
    const dateParts = date.split('-');
    const year = dateParts[0];
    const month = parseInt(dateParts[1]);
    const day = parseInt(dateParts[2]);

    const sql = `
      SELECT 
        OPC.NUMEROORDENPREPARACION AS NUMEROORDEN,
        OPC.EJERCICIOORDENPREPARACION AS EJERCICIO,
        OPC.CODIGOCLIENTEALBARAN AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, OPC.CODIGOCLIENTEALBARAN) AS NOMBRE_CLIENTE,
        OPC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.STATUS, 'PENDIENTE') AS ESTADO,
        DS.FIRMA_PATH AS FIRMA
      FROM DSEDAC.CPC OPC
      INNER JOIN DSEDAC.OPP OP 
        ON OP.NUMEROORDENPREPARACION = OPC.NUMEROORDENPREPARACION
        AND OP.EJERCICIOORDENPREPARACION = OPC.EJERCICIOORDENPREPARACION
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(OPC.CODIGOCLIENTEALBARAN)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS 
        ON DS.REPARTIDOR_ID = TRIM(OP.CODIGOREPARTIDOR)
        AND DS.ID = OPC.NUMEROORDENPREPARACION
      WHERE OP.CODIGOREPARTIDOR = ?
        AND OPC.DIADOCUMENTO = ?
        AND OPC.MESDOCUMENTO = ?
        AND OPC.ANODOCUMENTO = ?
      ORDER BY OPC.NUMEROORDENPREPARACION
    `;

    const result = await this._db.executeParams(sql, [repartidorCode, day, month, year]);
    return (result || []).map(row => new DeliveryItem({
      albaran: `${row.EJERCICIO}-${row.NUMEROORDEN}`,
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
        OPC.NUMEROORDENPREPARACION AS NUMEROORDEN,
        OPC.EJERCICIOORDENPREPARACION AS EJERCICIO,
        OPC.CODIGOCLIENTEALBARAN AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, OPC.CODIGOCLIENTEALBARAN) AS NOMBRE_CLIENTE,
        OPC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.STATUS, 'PENDIENTE') AS ESTADO
      FROM DSEDAC.CPC OPC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(OPC.CODIGOCLIENTEALBARAN)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.ID = OPC.NUMEROORDENPREPARACION
      WHERE OPC.NUMEROORDENPREPARACION = ?
    `;

    const linSql = `
      SELECT 
        LAC.CODIGOARTICULO AS PRODUCTO,
        COALESCE(ART.DESCRIPCIONARTICULO, LAC.CODIGOARTICULO) AS NOMBRE,
        LAC.CANTIDADUNIDADES AS CANTIDAD,
        LAC.IMPORTEVENTA AS PRECIO,
        LAC.IMPORTECOSTO AS COSTO
      FROM DSEDAC.LAC LAC
      INNER JOIN DSEDAC.CAC CAC
        ON LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
        AND LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
        AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
        AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
      WHERE CAC.NUMEROORDENPREPARACION = ?
      ORDER BY LAC.CODIGOARTICULO
    `;

    const [cab, lines] = await Promise.all([
      this._db.executeParams(cabSql, [albaranNumber]),
      this._db.executeParams(linSql, [albaranNumber])
    ]);

    if (!cab || cab.length === 0) return null;

    return new DeliveryItem({
      albaran: `${cab[0].EJERCICIO}-${cab[0].NUMEROORDEN}`,
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
      USING (VALUES (?, ?)) AS V(ID, REPARTIDOR_ID)
      ON DS.ID = V.ID
      WHEN MATCHED THEN UPDATE SET DS.STATUS = ?, DS.OBSERVACIONES = ?, DS.UPDATED_AT = CURRENT TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (ID, STATUS, OBSERVACIONES, REPARTIDOR_ID, UPDATED_AT) VALUES (?, ?, ?, ?, CURRENT TIMESTAMP)
    `;

    await this._db.executeParams(sql, [
      albaranNumber, '', status, observations,
      albaranNumber, status, observations, ''
    ]);

    return { albaranNumber, status, updatedAt: new Date() };
  }

  async registerSignature(albaranNumber, signaturePath, latitud = null, longitud = null) {
    const sql = `
      MERGE INTO JAVIER.DELIVERY_STATUS DS
      USING (VALUES (?)) AS V(ID)
      ON DS.ID = V.ID
      WHEN MATCHED THEN UPDATE SET DS.FIRMA_PATH = ?, DS.LATITUD = ?, DS.LONGITUD = ?, DS.UPDATED_AT = CURRENT TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (ID, FIRMA_PATH, LATITUD, LONGITUD, STATUS, UPDATED_AT) VALUES (?, ?, ?, ?, 'ENTREGADO', CURRENT TIMESTAMP)
    `;

    await this._db.executeParams(sql, [
      albaranNumber, signaturePath, latitud, longitud,
      albaranNumber, signaturePath, latitud, longitud
    ]);

    return { albaranNumber, signaturePath, latitud, longitud };
  }

  async getHistorico(repartidorCode, filters = {}) {
    const { year, month, limit = 50, offset = 0 } = filters;
    let whereClause = 'WHERE OP.CODIGOREPARTIDOR = ?';
    const params = [repartidorCode];

    if (year) {
      whereClause += ' AND OPC.ANODOCUMENTO = ?';
      params.push(year);
    }
    if (month) {
      whereClause += ' AND OPC.MESDOCUMENTO = ?';
      params.push(month);
    }

    params.push(limit, offset);

    const sql = `
      SELECT 
        OPC.NUMEROORDENPREPARACION AS NUMEROORDEN,
        OPC.EJERCICIOORDENPREPARACION AS EJERCICIO,
        OPC.CODIGOCLIENTEALBARAN AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, OPC.CODIGOCLIENTEALBARAN) AS NOMBRE_CLIENTE,
        OPC.IMPORTETOTAL AS TOTAL,
        COALESCE(DS.STATUS, 'PENDIENTE') AS ESTADO
      FROM DSEDAC.CPC OPC
      INNER JOIN DSEDAC.OPP OP 
        ON OP.NUMEROORDENPREPARACION = OPC.NUMEROORDENPREPARACION
        AND OP.EJERCICIOORDENPREPARACION = OPC.EJERCICIOORDENPREPARACION
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(OPC.CODIGOCLIENTEALBARAN)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.ID = OPC.NUMEROORDENPREPARACION
      ${whereClause}
      ORDER BY OPC.ANODOCUMENTO DESC, OPC.MESDOCUMENTO DESC, OPC.DIADOCUMENTO DESC
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    return await this._db.executeParams(sql, params);
  }

  async getCommissions(repartidorCode, year, month) {
    const yearFilter = year ? `AND OPC.ANODOCUMENTO = ?` : '';
    const monthFilter = month ? `AND OPC.MESDOCUMENTO = ?` : '';
    const params = [repartidorCode];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(SUM(OPC.IMPORTETOTAL), 0) AS TOTAL_ENTREGADO,
        COUNT(DISTINCT OPC.NUMEROORDENPREPARACION) AS TOTAL_ALBARANES,
        COUNT(DISTINCT OPC.CODIGOCLIENTEALBARAN) AS TOTAL_CLIENTES
      FROM DSEDAC.CPC OPC
      INNER JOIN DSEDAC.OPP OP 
        ON OP.NUMEROORDENPREPARACION = OPC.NUMEROORDENPREPARACION
        AND OP.EJERCICIOORDENPREPARACION = OPC.EJERCICIOORDENPREPARACION
      WHERE OP.CODIGOREPARTIDOR = ?
        ${yearFilter}
        ${monthFilter}
    `;

    const result = await this._db.executeParams(sql, params);
    return result[0] || { TOTAL_ENTREGADO: 0, TOTAL_ALBARANES: 0, TOTAL_CLIENTES: 0 };
  }
}

module.exports = { Db2RepartidorRepository };
