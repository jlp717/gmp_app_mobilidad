/**
 * Clients Repository Implementation - DB2
 * REAL SCHEMA: DSEDAC.CLI (clients), DSED.LACLAE (sales), DSEDAC.ART (products), DSEDAC.CVC (payments)
 */
const { ClientRepository } = require('../domain/client-repository');
const { Client, ClientDetail } = require('../domain/client');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const {
  VENDOR_COLUMN,
  sanitizeCodeList,
  buildClientListVendorSqlFilter,
  getVendorColumnExpr,
  MIN_YEAR,
} = require('../../../../utils/common');

const CLIENT_VENDOR_SELECT_SQL = `
        COALESCE(
          (SELECT TRIM(MIN(CLP.VENDEDORCOMERCIAL))
             FROM DSEDAC.CLP CLP
            WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CLI.CODIGOCLIENTE)),
          (SELECT TRIM(LAC_VENDOR)
             FROM (
               SELECT TRIM(${getVendorColumnExpr('LAC')}) AS LAC_VENDOR,
                      ROW_NUMBER() OVER (
                        ORDER BY LAC.LCAADC DESC, LAC.LCMMDC DESC, LAC.LCDDDC DESC
                      ) AS RN
                 FROM DSED.LACLAE LAC
                WHERE TRIM(LAC.LCCDCL) = TRIM(CLI.CODIGOCLIENTE)
                  AND LAC.LCAADC >= ${MIN_YEAR}
                  AND LAC.TPDC = 'LAC'
                  AND LAC.LCTPVT IN ('CC', 'VC')
                  AND LAC.LCCLLN IN ('AB', 'VT')
                  AND LAC.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
             ) X
            WHERE RN = 1)
        ) AS VENDEDOR`;

class Db2ClientRepository extends ClientRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findAll({ vendedorCodes, search = '', limit = 100, offset = 0 }) {
    const vendorFilter = buildClientListVendorSqlFilter(vendedorCodes, 'CLI');
    const searchFilter = search
      ? `AND (CLI.NOMBRECLIENTE LIKE ? OR CLI.CODIGOCLIENTE LIKE ?)`
      : '';
    const params = [];
    if (search) { params.push(`%${search.toUpperCase()}%`, `%${search.toUpperCase()}%`); }
    params.push(limit, offset);

    const sql = `
      SELECT 
        CLI.CODIGOCLIENTE AS CODIGO,
        CLI.NOMBRECLIENTE AS NOMBRE,
        CLI.DIRECCION,
        CLI.POBLACION,
        CLI.PROVINCIA,
        CLI.TELEFONO1 AS TELEFONO,
        CLI.EMAIL,
        CLI.CODCLI AS TARIFA,
        ${CLIENT_VENDOR_SELECT_SQL},
        CASE WHEN CLI.ANOBAJA IS NULL OR CLI.ANOBAJA = 0 THEN 1 ELSE 0 END AS ACTIVO
      FROM DSEDAC.CLI CLI
      WHERE (CLI.ANOBAJA IS NULL OR CLI.ANOBAJA = 0)
        ${vendorFilter}
        ${searchFilter}
      ORDER BY CLI.NOMBRECLIENTE
      FETCH FIRST ? ROWS ONLY OFFSET ? ROWS
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Client.fromDbRow(row));
  }

  async findByCode(code) {
    const sql = `
      SELECT 
        CLI.CODIGOCLIENTE AS CODIGO,
        CLI.NOMBRECLIENTE AS NOMBRE,
        CLI.DIRECCION,
        CLI.POBLACION,
        CLI.PROVINCIA,
        CLI.TELEFONO1 AS TELEFONO,
        CLI.EMAIL,
        CLI.CODCLI AS TARIFA,
        ${CLIENT_VENDOR_SELECT_SQL},
        CASE WHEN CLI.ANOBAJA IS NULL OR CLI.ANOBAJA = 0 THEN 1 ELSE 0 END AS ACTIVO
      FROM DSEDAC.CLI CLI
      WHERE TRIM(CLI.CODIGOCLIENTE) = ?
    `;

    const result = await this._db.executeParams(sql, [code]);
    return result && result.length > 0 ? Client.fromDbRow(result[0]) : null;
  }

  async findDetail(code, vendedorCodes, year) {
    const client = await this.findByCode(code);
    if (!client) return null;

    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const params = [code];
    if (year) params.push(year);

    // Sales by month using DSED.LACLAE
    const salesSql = `
      SELECT 
        LCAADC AS ANIO,
        LCMMDC AS MES,
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      WHERE TRIM(LCCDCL) = ?
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY LCAADC, LCMMDC
      ORDER BY ANIO, MES
    `;

    // Top products using DSED.LACLAE + DSEDAC.ART
    const productsSql = `
      SELECT 
        L.LCCDRF AS CODIGO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE TRIM(L.LCCDCL) = ?
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY L.LCCDRF, ART.DESCRIPCIONARTICULO
      ORDER BY VENTAS DESC
      FETCH FIRST 20 ROWS ONLY
    `;

    // Payment status using DSEDAC.CVC
    const paymentSql = `
      SELECT 
        COALESCE(SUM(CASE WHEN TRIM(SITUACION) = 'P' THEN IMPORTEPENDIENTE ELSE 0 END), 0) AS PENDIENTE,
        COALESCE(SUM(CASE WHEN TRIM(SITUACION) <> 'P' THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS COBRADO
      FROM DSEDAC.CVC
      WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
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
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const placeholders = clientCodes.map(() => '?').join(',');
    const params = [...clientCodes];
    if (year) params.push(year);

    const sql = `
      SELECT 
        L.LCCDCL AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT L.LCCDRF) AS PRODUCTOS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE TRIM(L.LCCDCL) IN (${placeholders})
        AND ${vendorFilter}
        ${yearFilter}
      GROUP BY L.LCCDCL, CLI.NOMBRECLIENTE
      ORDER BY VENTAS DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async findSalesHistory(code, year, limit = 12) {
    const sql = `
      SELECT 
        LCAADC AS ANIO,
        LCMMDC AS MES,
        LCDDDC AS DIA,
        LCSRAB || LCNRAB AS DOCUMENTO,
        LCCDRF AS PRODUCTO,
        COALESCE(ART.DESCRIPCIONARTICULO, LCCDRF) AS NOMBRE_PRODUCTO,
        LCCTUD AS CANTIDAD,
        LCIMVT AS VENTAS,
        LCIMVT - LCIMCT AS MARGEN
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE TRIM(LCCDCL) = ?
        ${year ? `AND LCAADC = ?` : ''}
      ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
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
        L.LCCDRF AS CODIGO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COUNT(*) AS FRECUENCIA
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE TRIM(L.LCCDCL) = ?
      GROUP BY L.LCCDRF, ART.DESCRIPCIONARTICULO
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    return await this._db.executeParams(sql, [code, limit]);
  }

  async findPaymentStatus(code) {
    const sql = `
      SELECT 
        COALESCE(SUM(CASE WHEN TRIM(SITUACION) = 'P' THEN IMPORTEPENDIENTE ELSE 0 END), 0) AS PENDIENTE,
        COALESCE(SUM(CASE WHEN TRIM(SITUACION) <> 'P' THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS COBRADO,
        COUNT(*) AS TOTAL_RECEIPTS
      FROM DSEDAC.CVC
      WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
    `;

    const result = await this._db.executeParams(sql, [code]);
    return result[0] || { PENDIENTE: 0, COBRADO: 0, TOTAL_RECEIPTS: 0 };
  }
}

module.exports = { Db2ClientRepository };
