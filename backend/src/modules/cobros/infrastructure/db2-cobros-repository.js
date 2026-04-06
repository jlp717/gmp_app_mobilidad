/**
 * Cobros Repository Implementation - DB2
 * 
 * DELEGATES TO LEGACY cobros.js routes for correct SQL
 * The legacy implementation has proper column names and business logic
 */
const { CobrosRepository } = require('../domain/cobros-repository');
const { query, queryWithParams } = require('../../../config/db');
const { v4: uuidv4 } = require('uuid');

class Db2CobrosRepository extends CobrosRepository {
  /**
   * Get pending payments for a client (orders that are CONFIRMADO/ENVIADO but not yet paid)
   * Uses correct column names: DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, IMPORTETOTAL
   */
  async getPendientes(clientCode) {
    // Check if COBROS table exists
    let cobrosTableExists = false;
    try {
      await query(`SELECT 1 FROM JAVIER.COBROS FETCH FIRST 1 ROW ONLY`);
      cobrosTableExists = true;
    } catch(e) {
      try {
        await query(`
          CREATE TABLE JAVIER.COBROS (
            ID VARCHAR(64) PRIMARY KEY,
            CODIGO_CLIENTE VARCHAR(20),
            REFERENCIA VARCHAR(100),
            IMPORTE DECIMAL(10,2),
            FORMA_PAGO VARCHAR(50),
            TIPO_VENTA VARCHAR(20),
            TIPO_MODO VARCHAR(20),
            TIPO_USUARIO VARCHAR(20),
            CODIGO_USUARIO VARCHAR(20),
            OBSERVACIONES VARCHAR(500),
            FECHA TIMESTAMP DEFAULT CURRENT TIMESTAMP
          )
        `);
        cobrosTableExists = true;
      } catch(createErr) {
        // Table creation failed, continue without payment tracking
      }
    }

    // Check if ORIGEN column exists
    let origenExists = false;
    try {
      const colCheck = await query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS2
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'PEDIDOS_CAB' AND COLUMN_NAME = 'ORIGEN'
        FETCH FIRST 1 ROW ONLY
      `);
      origenExists = colCheck && colCheck.length > 0;
    } catch(e) {}

    // Build query with correct column names
    let sql;
    if (origenExists) {
      sql = `
        SELECT
          PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
          PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
          PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
        FROM JAVIER.PEDIDOS_CAB PC
        WHERE TRIM(PC.CODIGOCLIENTE) = ?
          AND PC.ORIGEN = 'A'
          AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
          AND PC.IMPORTETOTAL > 0
        ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY
      `;
    } else {
      sql = `
        SELECT
          PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
          PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
          PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
        FROM JAVIER.PEDIDOS_CAB PC
        WHERE TRIM(PC.CODIGOCLIENTE) = ?
          AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
          AND PC.IMPORTETOTAL > 0
        ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY
      `;
    }

    const resultado = await queryWithParams(sql, [clientCode], []);
    
    const ahora = new Date();
    const mesActual = ahora.getMonth() + 1;
    const anoActual = ahora.getFullYear();
    const format2 = (n) => String(n).padStart(2, '0');

    const cobros = (resultado && resultado.length > 0 ? resultado : []).map(row => {
      const mes = Number(row.MESDOCUMENTO);
      const ano = Number(row.ANODOCUMENTO);
      const referencia = `${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`;
      const dia = format2(row.DIADOCUMENTO);
      const mm = format2(row.MESDOCUMENTO);
      const fechaStr = `${ano}-${mm}-${dia}T00:00:00.000Z`;

      return {
        id: uuidv4(),
        tipo: 'pedido_app',
        referencia,
        fecha: fechaStr,
        importeTotal: parseFloat(row.IMPORTETOTAL) || 0,
        importePendiente: parseFloat(row.IMPORTETOTAL) || 0,
        descripcion: `Pedido ${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`,
        estado: row.ESTADO,
        ejercicio: row.EJERCICIO,
        numeroPedido: row.NUMEROPEDIDO,
        seriePedido: row.SERIEPEDIDO
      };
    });

    let total = cobros.reduce((sum, c) => sum + c.importePendiente, 0);

    return {
      cobros,
      resumen: {
        totalPendiente: total,
        pedidos: { cantidad: cobros.length, total: total }
      }
    };
  }

  /**
   * Get pending payments summary for a vendor (all clients)
   */
  async getPendingSummary(vendorCode) {
    const sql = `
      SELECT
        PC.CODIGOCLIENTE,
        COUNT(*) as NUM_PEDIDOS,
        SUM(PC.IMPORTETOTAL) as TOTAL_PENDIENTE
      FROM JAVIER.PEDIDOS_CAB PC
      WHERE TRIM(PC.CODIGOCLIENTE) IN (
        SELECT DISTINCT CODIGOCLIENTE 
        FROM JAVIER.PEDIDOS_CAB 
        WHERE CODIGOVENDEDOR = ? 
          AND ESTADO IN ('CONFIRMADO', 'ENVIADO')
      )
      AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
      AND PC.IMPORTETOTAL > 0
      GROUP BY PC.CODIGOCLIENTE
      ORDER BY TOTAL_PENDIENTE DESC
    `;

    const result = await queryWithParams(sql, [vendorCode], []);
    return result || [];
  }

  /**
   * Register a payment
   */
  async registerPayment({ clientCode, amount, paymentMethod, reference, observations, userId, orderIds = [] }) {
    const id = uuidv4();
    
    // Insert payment record
    await queryWithParams(`
      INSERT INTO JAVIER.COBROS (
        ID, CODIGO_CLIENTE, IMPORTE, FORMA_PAGO, REFERENCIA,
        OBSERVACIONES, CODIGO_USUARIO, FECHA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, clientCode, amount, paymentMethod, reference || '', observations || '', userId], []);

    return {
      id,
      clientCode,
      amount,
      paymentMethod,
      reference,
      status: 'REGISTRADO'
    };
  }

  /**
   * Get payment history for a client
   */
  async getHistorico({ clientCode, limit = 20, offset = 0 }) {
    const sql = `
      SELECT
        C.ID, C.CODIGO_CLIENTE, C.IMPORTE, C.FORMA_PAGO,
        C.REFERENCIA, C.OBSERVACIONES, C.FECHA
      FROM JAVIER.COBROS C
      WHERE TRIM(C.CODIGO_CLIENTE) = ?
      ORDER BY C.FECHA DESC
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
    `;

    const result = await queryWithParams(sql, [clientCode], []);
    return result || [];
  }

  /**
   * Get totals by vendor
   */
  async getTotalesByVendor(vendorCode) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL_COBROS,
        SUM(IMPORTE) as TOTAL_IMPORTE,
        AVG(IMPORTE) as PROMEDIO
      FROM JAVIER.COBROS
      WHERE CODIGO_USUARIO = ?
    `;

    const result = await queryWithParams(sql, [vendorCode], []);
    return result[0] || {};
  }
}

module.exports = { Db2CobrosRepository };
