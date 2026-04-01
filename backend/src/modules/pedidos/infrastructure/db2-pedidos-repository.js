/**
 * Pedidos Repository Implementation - DB2
 * Wraps existing pedidos.service.js queries with DDD pattern
 */
const { PedidosRepository } = require('../domain/pedidos-repository');
const { Product } = require('../domain/product');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { getCurrentDate, VENDOR_COLUMN, LACLAE_SALES_FILTER } = require('../../../../utils/common');

class Db2PedidosRepository extends PedidosRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async searchProducts({ vendedorCodes, clientCode, family, marca, search, limit = 50, offset = 0 }) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`;

    const dateFilter = LACLAE_SALES_FILTER;
    const familyFilter = family ? `AND TRIM(FL.FAMILIA) = '${family}'` : '';
    const marcaFilter = marca ? `AND TRIM(FL.MARCA) = '${marca}'` : '';
    const searchFilter = search ? `AND (TRIM(FL.DESART) LIKE '%${search}%' OR TRIM(FL.CODART) LIKE '%${search}%')` : '';

    const sql = `
      SELECT DISTINCT
        FL.CODART,
        FL.DESART,
        COALESCE(FL.PRECIO, 0) as PRECIO,
        COALESCE(FL.STOCK, 0) as STOCK,
        FL.UNIDAD,
        FL.FAMILIA,
        FL.MARCA,
        FL.IMAGEN
      FROM JAVIER.LACLAE FL
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND FL.CODART <> ''
        ${familyFilter}
        ${marcaFilter}
        ${searchFilter}
      ORDER BY FL.DESART
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
    `;

    const result = await this._db.executeParams(sql, []);
    const products = result.map(row => Product.fromDbRow(row));
    return { products, count: result.length };
  }

  async getProductDetail({ code, clientCode, vendedorCodes }) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`;

    const sql = `
      SELECT
        FL.CODART,
        FL.DESART,
        COALESCE(FL.PRECIO, 0) as PRECIO,
        COALESCE(FL.STOCK, 0) as STOCK,
        FL.UNIDAD,
        FL.FAMILIA,
        FL.MARCA,
        FL.IMAGEN,
        FL.PRECIO_MINIMO,
        FL.UNIDADES_CAJA
      FROM JAVIER.LACLAE FL
      WHERE FL.CODART = ?
        AND ${vendorFilter}
      FETCH FIRST 1 ROW ONLY
    `;

    const result = await this._db.executeParams(sql, [code]);
    if (!result || result.length === 0) return null;
    return Product.fromDbRow(result[0]);
  }

  async getPromotions({ clientCode, vendedorCodes }) {
    const sql = `
      SELECT
        PMRL1.IDPROMO,
        PMRL1.DESPROMO,
        PMRL1.TIPO,
        PMRL1.FECHAINICIO,
        PMRL1.FECHAFIN,
        PMRL1.CODIGOCLIENTE,
        PMPL1.CODART,
        PMPL1.UNIDADESMIN,
        PMPL1.UNIDADESMAX,
        PMPL1.PRECIO
      FROM JAVIER.PMRL1 PMRL1
      LEFT JOIN JAVIER.PMPL1 PMPL1 ON PMRL1.IDPROMO = PMPL1.IDPROMO
      WHERE (TRIM(PMRL1.CODIGOCLIENTE) = '' OR TRIM(PMRL1.CODIGOCLIENTE) = ?)
        AND PMRL1.FECHAINICIO <= CURRENT_DATE
        AND PMRL1.FECHAFIN >= CURRENT_DATE
      ORDER BY PMRL1.IDPROMO, PMPL1.CODART
    `;

    const result = await this._db.executeParams(sql, [clientCode]);
    return result;
  }

  async getCart(userId) {
    const sql = `
      SELECT
        CC.ID,
        CC.CODIGO_CLIENTE,
        CC.CODIGO_PRODUCTO,
        CC.CANTIDAD,
        CC.UNIDAD,
        CC.OBSERVACIONES,
        CC.FECHA_CREACION
      FROM JAVIER.CART_CONTENT CC
      WHERE CC.USER_ID = ?
      ORDER BY CC.FECHA_CREACION DESC
    `;

    const result = await this._db.executeParams(sql, [userId]);
    return result;
  }

  async addToCart({ userId, clientCode, productCode, quantity, unit = 'UD' }) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    const sql = `
      INSERT INTO JAVIER.CART_CONTENT (
        ID, USER_ID, CODIGO_CLIENTE, CODIGO_PRODUCTO, CANTIDAD, UNIDAD, FECHA_CREACION
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this._db.executeParams(sql, [id, userId, clientCode, productCode, quantity, unit]);
    return { id, userId, clientCode, productCode, quantity, unit };
  }

  async confirmOrder({ userId, clientCode, lines, observations = '' }) {
    const { v4: uuidv4 } = require('uuid');
    const orderId = uuidv4();
    const currentDate = getCurrentDate();
    const year = currentDate.substring(0, 4);

    const cabSql = `
      INSERT INTO JAVIER.PEDIDOS_CAB (
        ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, CODIGOCLIENTE,
        FECHAPEDIDO, ESTADO, OBSERVACIONES, CODIGO_USUARIO, ORIGEN
      ) VALUES (?, ?, 1, 'M', ?, CURRENT_TIMESTAMP, 'PENDIENTE', ?, ?, 'APP')
    `;

    await this._db.executeParams(cabSql, [orderId, year, clientCode, observations, userId]);

    for (const line of lines) {
      const lineId = uuidv4();
      const linSql = `
        INSERT INTO JAVIER.PEDIDOS_LIN (
          ID, PEDIDO_ID, CODIGOARTICULO, CANTIDAD, UNIDAD, PRECIO
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;
      await this._db.executeParams(linSql, [
        lineId, orderId, line.productCode, line.quantity, line.unit || 'UD', line.unitPrice || 0
      ]);
    }

    return { orderId, status: 'PENDIENTE', linesCount: lines.length };
  }

  async getOrderHistory({ userId, limit = 20, offset = 0 }) {
    const sql = `
      SELECT
        PC.ID,
        PC.EJERCICIO,
        PC.NUMEROPEDIDO,
        PC.SERIEPEDIDO,
        PC.FECHAPEDIDO,
        PC.ESTADO,
        PC.OBSERVACIONES,
        PC.CODIGOCLIENTE,
        CL.NOMBRE as NOMBRE_CLIENTE,
        SUM(PL.CANTIDAD * PL.PRECIO) as TOTAL
      FROM JAVIER.PEDIDOS_CAB PC
      LEFT JOIN JAVIER.PEDIDOS_LIN PL ON PC.ID = PL.PEDIDO_ID
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(PC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      WHERE PC.CODIGO_USUARIO = ?
      GROUP BY PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
               PC.FECHAPEDIDO, PC.ESTADO, PC.OBSERVACIONES,
               PC.CODIGOCLIENTE, CL.NOMBRE
      ORDER BY PC.FECHAPEDIDO DESC
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
    `;

    const result = await this._db.executeParams(sql, [userId]);
    return result;
  }

  async getOrderStats({ userId }) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL,
        SUM(CASE WHEN ESTADO = 'PENDIENTE' THEN 1 ELSE 0 END) as PENDIENTES,
        SUM(CASE WHEN ESTADO = 'CONFIRMADO' THEN 1 ELSE 0 END) as CONFIRMADOS,
        SUM(CASE WHEN ESTADO = 'FACTURADO' THEN 1 ELSE 0 END) as FACTURADOS,
        SUM(CASE WHEN ESTADO = 'ANULADO' THEN 1 ELSE 0 END) as ANULADOS
      FROM JAVIER.PEDIDOS_CAB
      WHERE CODIGO_USUARIO = ?
    `;

    const result = await this._db.executeParams(sql, [userId]);
    return result[0] || {};
  }
}

module.exports = { Db2PedidosRepository };
