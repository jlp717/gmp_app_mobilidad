/**
 * Warehouse Repository Implementation - DB2
 */
const { WarehouseRepository } = require('../domain/warehouse-repository');
const { WarehouseStock, WarehouseMovement } = require('../domain/warehouse');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2WarehouseRepository extends WarehouseRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getStock({ productCode, warehouse, search = '', limit = 100, offset = 0 }) {
    const productFilter = productCode ? `AND ARO.CODIGOARTICULO = ?` : '';
    const warehouseFilter = warehouse ? `AND ARO.CODIGOALMACEN = ?` : '';
    const searchFilter = search ? `AND (ART.DESCRIPCIONARTICULO LIKE ? OR ART.CODIGOARTICULO LIKE ?)` : '';
    const params = [];
    if (productCode) params.push(productCode);
    if (warehouse) params.push(warehouse);
    if (search) params.push(`%${search}%`, `%${search}%`);
    params.push(limit, offset);

    const sql = `
      SELECT 
        ARO.CODIGOARTICULO AS CODIGO,
        ART.DESCRIPCIONARTICULO AS NOMBRE,
        COALESCE(ARO.UNIDADESDISPONIBLES, 0) AS STOCK,
        COALESCE(ARO.ENVASESDISPONIBLES, 0) AS ENVASES,
        ARO.CODIGOALMACEN AS ALMACEN
      FROM DSEDAC.ARO ARO
      LEFT JOIN DSEDAC.ART ART ON ART.CODIGOARTICULO = ARO.CODIGOARTICULO
      WHERE 1=1
        ${productFilter}
        ${warehouseFilter}
        ${searchFilter}
        AND ART.ANOBAJA IS NULL
        AND ART.BLOQUEADOSN = 'N'
      ORDER BY ART.DESCRIPCIONARTICULO
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => WarehouseStock.fromDbRow(row));
  }

  async getMovements({ productCode, type, dateFrom, dateTo, limit = 50, offset = 0 }) {
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (productCode) {
      whereClause += ' AND M.CODART = ?';
      params.push(productCode);
    }
    if (type) {
      whereClause += ' AND M.TIPO = ?';
      params.push(type);
    }
    if (dateFrom) {
      whereClause += ' AND M.FECHA >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND M.FECHA <= ?';
      params.push(dateTo);
    }

    params.push(limit, offset);

    const sql = `
      SELECT 
        M.ID,
        M.CODART AS PRODUCTO,
        M.TIPO,
        M.CANTIDAD,
        M.FECHA,
        M.REFERENCIA,
        M.USUARIO
      FROM JAVIER.STOCK_MOVIMIENTOS M
      ${whereClause}
      ORDER BY M.FECHA DESC
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => new WarehouseMovement({
      id: row.ID,
      productCode: row.PRODUCTO,
      type: row.TIPO,
      quantity: parseFloat(row.CANTIDAD || 0),
      date: row.FECHA,
      reference: row.REFERENCIA,
      user: row.USUARIO
    }));
  }

  async getLowStock(threshold = 10) {
    const sql = `
      SELECT 
        ARO.CODIGOARTICULO AS CODIGO,
        ART.DESCRIPCIONARTICULO AS NOMBRE,
        COALESCE(ARO.UNIDADESDISPONIBLES, 0) AS STOCK,
        COALESCE(ARO.ENVASESDISPONIBLES, 0) AS ENVASES,
        ARO.CODIGOALMACEN AS ALMACEN
      FROM DSEDAC.ARO ARO
      LEFT JOIN DSEDAC.ART ART ON ART.CODIGOARTICULO = ARO.CODIGOARTICULO
      WHERE COALESCE(ARO.UNIDADESDISPONIBLES, 0) <= ?
        AND ART.ANOBAJA IS NULL
        AND ART.BLOQUEADOSN = 'N'
      ORDER BY STOCK ASC
    `;

    const result = await this._db.executeParams(sql, [threshold]);
    return (result || []).map(row => WarehouseStock.fromDbRow(row));
  }

  async registerMovement(movement) {
    const sql = `
      INSERT INTO JAVIER.STOCK_MOVIMIENTOS (ID, CODART, TIPO, CANTIDAD, FECHA, REFERENCIA, USUARIO)
      VALUES (?, ?, ?, ?, CURRENT TIMESTAMP, ?, ?)
    `;

    const id = `${movement.productCode}-${Date.now()}`;
    await this._db.executeParams(sql, [
      id,
      movement.productCode,
      movement.type,
      movement.quantity,
      movement.reference,
      movement.user
    ]);

    return { id, ...movement, date: new Date() };
  }
}

module.exports = { Db2WarehouseRepository };
