/**
 * Cobros Repository Implementation - DB2
 */
const { CobrosRepository } = require('../domain/cobros-repository');
const { Cobro } = require('../domain/cobro');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2CobrosRepository extends CobrosRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getPendientes(clientCode) {
    const sql = `
      SELECT
        PC.ID,
        PC.EJERCICIO,
        PC.NUMEROPEDIDO,
        PC.SERIEPEDIDO,
        PC.FECHAPEDIDO,
        PC.ESTADO,
        PC.CODIGOCLIENTE,
        CL.NOMBRE as NOMBRE_CLIENTE,
        SUM(PL.CANTIDAD * PL.PRECIO) as IMPORTE
      FROM JAVIER.PEDIDOS_CAB PC
      LEFT JOIN JAVIER.PEDIDOS_LIN PL ON PC.ID = PL.PEDIDO_ID
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(PC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      WHERE TRIM(PC.CODIGOCLIENTE) = ?
        AND PC.ESTADO IN ('CONFIRMADO', 'FACTURADO')
      GROUP BY PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
               PC.FECHAPEDIDO, PC.ESTADO, PC.CODIGOCLIENTE, CL.NOMBRE
      ORDER BY PC.FECHAPEDIDO DESC
    `;

    const result = await this._db.executeParams(sql, [clientCode]);
    return result.map(row => Cobro.fromDbRow({
      ID: row.ID,
      CODIGOCLIENTE: row.CODIGOCLIENTE,
      NOMBRECLIENTE: row.NOMBRE_CLIENTE,
      IMPORTE: row.IMPORTE,
      FECHA: row.FECHAPEDIDO,
      ESTADO: row.ESTADO
    }));
  }

  async registerPayment({ clientCode, amount, paymentMethod, reference, observations, userId }) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    const sql = `
      INSERT INTO JAVIER.COBROS (
        ID, CODIGO_CLIENTE, IMPORTE, FORMA_PAGO, REFERENCIA,
        OBSERVACIONES, CODIGO_USUARIO, FECHA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this._db.executeParams(sql, [
      id, clientCode, amount, paymentMethod, reference || '', observations || '', userId
    ]);

    return { id, clientCode, amount, paymentMethod, reference, status: 'REGISTRADO' };
  }

  async getHistorico({ clientCode, limit = 20, offset = 0 }) {
    const sql = `
      SELECT
        C.ID,
        C.CODIGO_CLIENTE,
        C.IMPORTE,
        C.FORMA_PAGO,
        C.REFERENCIA,
        C.OBSERVACIONES,
        C.FECHA,
        CL.NOMBRE as NOMBRE_CLIENTE
      FROM JAVIER.COBROS C
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(C.CODIGO_CLIENTE) = TRIM(CL.CODIGO)
      WHERE TRIM(C.CODIGO_CLIENTE) = ?
      ORDER BY C.FECHA DESC
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
    `;

    const result = await this._db.executeParams(sql, [clientCode]);
    return result.map(row => Cobro.fromDbRow({
      ID: row.ID,
      CODIGOCLIENTE: row.CODIGO_CLIENTE,
      NOMBRECLIENTE: row.NOMBRE_CLIENTE,
      IMPORTE: row.IMPORTE,
      PAGADO: row.IMPORTE,
      FECHA: row.FECHA,
      ESTADO: 'COBRADO'
    }));
  }

  async getTotalesByVendor(vendorCode) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL_COBROS,
        SUM(IMPORTE) as TOTAL_IMPORTE,
        AVG(IMPORTE) as PROMEDIO,
        MIN(FECHA) as PRIMER_COBRO,
        MAX(FECHA) as ULTIMO_COBRO
      FROM JAVIER.COBROS
      WHERE CODIGO_USUARIO = ?
    `;

    const result = await this._db.executeParams(sql, [vendorCode]);
    return result[0] || {};
  }
}

module.exports = { Db2CobrosRepository };
