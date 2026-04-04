/**
 * Pedidos Repository Implementation - DB2
 * Wraps existing pedidos.service.js queries with DDD pattern
 */
const { PedidosRepository } = require('../domain/pedidos-repository');
const { Product } = require('../domain/product');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { getCurrentDate, VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2PedidosRepository extends PedidosRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async searchProducts({ vendedorCodes, clientCode, family, marca, search, limit = 50, offset = 0 }) {
    // Products come from DSEDAC.ART, prices from DSEDAC.ARA, stock from DSEDAC.ARO
    const familyFilter = family ? `AND TRIM(ART.CODIGOFAMILIA) = ?` : '';
    const marcaFilter = marca ? `AND TRIM(ART.CODIGOMARCA) = ?` : '';
    const searchFilter = search ? `AND (TRIM(ART.DESCRIPCIONARTICULO) LIKE ? OR TRIM(ART.CODIGOARTICULO) LIKE ?)` : '';

    const sql = `
      SELECT DISTINCT
        ART.CODIGOARTICULO AS CODART,
        ART.DESCRIPCIONARTICULO AS DESART,
        COALESCE(ARA.PRECIOTARIFA, 0) as PRECIO,
        COALESCE(ARO.UNIDADESDISPONIBLES, 0) as STOCK,
        ART.UNIDADMEDIDA AS UNIDAD,
        ART.CODIGOFAMILIA AS FAMILIA,
        ART.CODIGOMARCA AS MARCA,
        '' AS IMAGEN
      FROM DSEDAC.ART ART
      LEFT JOIN DSEDAC.ARA ARA ON ARA.CODIGOARTICULO = ART.CODIGOARTICULO
      LEFT JOIN DSEDAC.ARO ARO ON ARO.CODIGOARTICULO = ART.CODIGOARTICULO
      WHERE ART.BLOQUEADOSN = 'N'
        AND ART.ANOBAJA = 0
        AND ART.CODIGOARTICULO <> ''
        ${familyFilter}
        ${marcaFilter}
        ${searchFilter}
      ORDER BY ART.DESCRIPCIONARTICULO
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
    `;

    const params = [];
    if (family) params.push(family);
    if (marca) params.push(marca);
    if (search) { params.push(`%${search.toUpperCase()}%`, `%${search.toUpperCase()}%`); }

    const result = await this._db.executeParams(sql, params);
    const products = result.map(row => Product.fromDbRow(row));
    return { products, count: result.length };
  }

  async getProductDetail({ code, clientCode, vendedorCodes }) {
    const sql = `
      SELECT
        ART.CODIGOARTICULO AS CODART,
        ART.DESCRIPCIONARTICULO AS DESART,
        COALESCE(ARA.PRECIOTARIFA, 0) as PRECIO,
        COALESCE(ARO.UNIDADESDISPONIBLES, 0) as STOCK,
        ART.UNIDADMEDIDA AS UNIDAD,
        ART.CODIGOFAMILIA AS FAMILIA,
        ART.CODIGOMARCA AS MARCA,
        '' AS IMAGEN,
        0 AS PRECIO_MINIMO,
        1 AS UNIDADES_CAJA
      FROM DSEDAC.ART ART
      LEFT JOIN DSEDAC.ARA ARA ON ARA.CODIGOARTICULO = ART.CODIGOARTICULO
      LEFT JOIN DSEDAC.ARO ARO ON ARO.CODIGOARTICULO = ART.CODIGOARTICULO
      WHERE TRIM(ART.CODIGOARTICULO) = ?
        AND ART.BLOQUEADOSN = 'N'
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
      FETCH FIRST 100 ROWS ONLY
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
      FETCH FIRST 100 ROWS ONLY
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

  /**
   * Confirm order with transactional integrity.
   * Wraps cabecera + all líneas inserts in a single transaction.
   * If any line insert fails, everything is rolled back.
   */
  async confirmOrder({ userId, clientCode, lines, observations = '' }) {
    const { v4: uuidv4 } = require('uuid');
    const orderId = uuidv4();
    const currentDate = getCurrentDate();
    const year = currentDate.substring(0, 4);

    return this._db.transaction(async (conn) => {
      const cabSql = `
        INSERT INTO JAVIER.PEDIDOS_CAB (
          ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, CODIGOCLIENTE,
          FECHAPEDIDO, ESTADO, OBSERVACIONES, CODIGO_USUARIO, ORIGEN
        ) VALUES (?, ?, 1, 'M', ?, CURRENT_TIMESTAMP, 'PENDIENTE', ?, ?, 'APP')
      `;

      await conn.query(cabSql, [orderId, year, clientCode, observations, userId]);

      for (const line of lines) {
        const lineId = uuidv4();
        const linSql = `
          INSERT INTO JAVIER.PEDIDOS_LIN (
            ID, PEDIDO_ID, CODIGOARTICULO, CANTIDAD, UNIDAD, PRECIO
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        await conn.query(linSql, [
          lineId, orderId, line.productCode, line.quantity, line.unit || 'UD', line.unitPrice || 0
        ]);
      }

      return { orderId, status: 'PENDIENTE', linesCount: lines.length };
    });
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
        PC.NOMBRECLIENTE,
        PC.IMPORTETOTAL as TOTAL
      FROM JAVIER.PEDIDOS_CAB PC
      WHERE PC.CODIGOVENDEDOR = ?
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
      WHERE CODIGOVENDEDOR = ?
    `;

    const result = await this._db.executeParams(sql, [userId]);
    return result[0] || {};
  }
}

module.exports = { Db2PedidosRepository };
