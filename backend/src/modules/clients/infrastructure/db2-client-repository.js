/**
 * Clients Repository Implementation - DB2
 */
const { ClientRepository } = require('../domain/client-repository');
const { Client, ClientDetail } = require('../domain/client');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { VENDOR_COLUMN, sanitizeCodeList } = require('../../../../utils/common');

class Db2ClientRepository extends ClientRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findAll({ vendedorCodes, search = '', limit = 100, offset = 0 }) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `CLI.CODVEN IN (${sanitizeCodeList(vendedorCodes)})`;
    const searchFilter = search
      ? `AND (CLI.NOMCLI LIKE ? OR CLI.CODCLI LIKE ?)`
      : '';
    const params = [];
    if (search) { params.push(`%${search}%`, `%${search}%`); }
    params.push(limit, offset);

    const sql = `
      SELECT 
        CLI.CODCLI AS CODIGO,
        CLI.NOMCLI AS NOMBRE,
        CLI.DIRCLI AS DIRECCION,
        CLI.POBLAC AS POBLACION,
        CLI.PROVINC AS PROVINCIA,
        CLI.TELCLI AS TELEFONO,
        CLI.EMAIL,
        CLI.CODTAR AS TARIFA,
        CLI.CODVEN AS VENDEDOR,
        CLI.ACTIVO
      FROM JAVIER.CLI CLI
      WHERE ${vendorFilter}
        AND CLI.ACTIVO = 1
        ${searchFilter}
      ORDER BY CLI.NOMCLI
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Client.fromDbRow(row));
  }

  async findByCode(code) {
    const sql = `
      SELECT 
        CLI.CODCLI AS CODIGO,
        CLI.NOMCLI AS NOMBRE,
        CLI.DIRCLI AS DIRECCION,
        CLI.POBLAC AS POBLACION,
        CLI.PROVINC AS PROVINCIA,
        CLI.TELCLI AS TELEFONO,
        CLI.EMAIL,
        CLI.CODTAR AS TARIFA,
        CLI.CODVEN AS VENDEDOR,
        CLI.ACTIVO
      FROM JAVIER.CLI CLI
      WHERE CLI.CODCLI = ?
    `;

    const result = await this._db.executeParams(sql, [code]);
    return result && result.length > 0 ? Client.fromDbRow(result[0]) : null;
  }

  async findDetail(code, vendedorCodes, year) {
    const client = await this.findByCode(code);
    if (!client) return null;

    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const params = [code];
    if (year) params.push(year);

    const salesSql = `
      SELECT 
        YEAR(L.FECHA) AS ANIO,
        MONTH(L.FECHA) AS MES,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS
      FROM JAVIER.LACLAE L
      WHERE L.CODIGO = ?
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY YEAR(L.FECHA), MONTH(L.FECHA)
      ORDER BY ANIO, MES
    `;

    const productsSql = `
      SELECT 
        L.CODART AS CODIGO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.CANTIDAD), 0) AS UNIDADES
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE L.CODIGO = ?
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY L.CODART, A.DESCART
      ORDER BY VENTAS DESC
      FETCH FIRST 20 ROWS ONLY
    `;

    const paymentSql = `
      SELECT 
        COALESCE(SUM(CASE WHEN ESTADO = 'P' THEN IMPORTE ELSE 0 END), 0) AS PENDIENTE,
        COALESCE(SUM(CASE WHEN ESTADO = 'C' THEN IMPORTE ELSE 0 END), 0) AS COBRADO
      FROM JAVIER.CVC
      WHERE CODIGO = ?
    `;

    const [salesHistory, productsPurchased, paymentStatus] = await Promise.all([
      this._db.executeParams(salesSql, params),
      this._db.executeParams(productsSql, params),
      this._db.executeParams(paymentSql, [code])
    ]);

    return new ClientDetail({
      ...client,
      salesHistory: salesHistory || [],
      productsPurchased: productsPurchased || [],
      paymentStatus: paymentStatus ? paymentStatus[0] : {},
      totalSales: (salesHistory || []).reduce((sum, row) => sum + parseFloat(row.VENTAS || 0), 0),
      totalMargin: (salesHistory || []).reduce((sum, row) => sum + parseFloat(row.MARGEN || 0), 0),
      orderCount: (salesHistory || []).reduce((sum, row) => sum + parseInt(row.PEDIDOS || 0), 0)
    });
  }

  async compare(clientCodes, vendedorCodes, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const placeholders = clientCodes.map(() => '?').join(',');
    const params = [...clientCodes];
    if (year) params.push(year);

    const sql = `
      SELECT 
        L.CODIGO AS CLIENTE,
        COALESCE(C.NOMCLI, L.CODIGO) AS NOMBRE,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS,
        COUNT(DISTINCT L.CODART) AS PRODUCTOS
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(L.CODIGO)
      WHERE L.CODIGO IN (${placeholders})
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY L.CODIGO, C.NOMCLI
      ORDER BY VENTAS DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async findSalesHistory(code, year, limit = 12) {
    const sql = `
      SELECT 
        L.FECHA,
        L.NUMDOC AS DOCUMENTO,
        L.CODART AS PRODUCTO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE_PRODUCTO,
        L.CANTIDAD,
        L.IMPORTE AS VENTAS,
        L.IMPORTE - L.COSTE AS MARGEN
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE L.CODIGO = ?
        ${year ? `AND YEAR(L.FECHA) = ?` : ''}
      ORDER BY L.FECHA DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const params = [code];
    if (year) params.push(year);
    params.push(limit);

    return await this._db.executeParams(sql, params);
  }

  async findProductsPurchased(code, limit = 20) {
    const sql = `
      SELECT 
        L.CODART AS CODIGO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.CANTIDAD), 0) AS UNIDADES,
        COUNT(*) AS FRECUENCIA
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE L.CODIGO = ?
      GROUP BY L.CODART, A.DESCART
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    return await this._db.executeParams(sql, [code, limit]);
  }

  async findPaymentStatus(code) {
    const sql = `
      SELECT 
        COALESCE(SUM(CASE WHEN ESTADO = 'P' THEN IMPORTE ELSE 0 END), 0) AS PENDIENTE,
        COALESCE(SUM(CASE WHEN ESTADO = 'C' THEN IMPORTE ELSE 0 END), 0) AS COBRADO,
        COUNT(*) AS TOTAL_RECEIPTS
      FROM JAVIER.CVC
      WHERE CODIGO = ?
    `;

    const result = await this._db.executeParams(sql, [code]);
    return result[0] || { PENDIENTE: 0, COBRADO: 0, TOTAL_RECEIPTS: 0 };
  }
}

module.exports = { Db2ClientRepository };
