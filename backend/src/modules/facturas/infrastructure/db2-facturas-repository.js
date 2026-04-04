/**
 * Facturas Repository Implementation - DB2
 */
const { FacturasRepository } = require('../domain/facturas-repository');
const { Factura } = require('../domain/factura');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { sanitizeCodeList } = require('../../../../utils/common');

class Db2FacturasRepository extends FacturasRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByVendor(vendedorCodes, year, month, filters = {}) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `TRIM(CAC.CODIGOVENDEDOR) IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND CAC.EJERCICIOFACTURA = ?` : '';
    const monthFilter = month ? `AND CAC.MESDOCUMENTO = ?` : '';
    const clientFilter = filters.clientId ? `AND TRIM(CAC.CODIGOCLIENTEFACTURA) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (filters.clientId) params.push(filters.clientId);

    const sql = `
      SELECT
        TRIM(CAC.SERIEFACTURA) AS SERIE,
        CAC.NUMEROFACTURA AS NUMERO,
        CAC.EJERCICIOFACTURA AS EJERCICIO,
        CAC.ANODOCUMENTO AS ANO,
        CAC.MESDOCUMENTO AS MES,
        CAC.DIADOCUMENTO AS DIA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) AS CLIENTE_ID,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) AS CLIENTE_NOMBRE,
        COALESCE(CAC.IMPORTETOTAL, 0) AS TOTAL
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
      WHERE CAC.NUMEROFACTURA > 0
        AND CAC.NUMEROFACTURA < 900000
        AND ${vendorFilter}
        ${yearFilter}
        ${monthFilter}
        ${clientFilter}
      ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC, CAC.NUMEROFACTURA DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return this._aggregateInvoices(result || []);
  }

  async findByClient(vendedorCodes, clientId, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `TRIM(CAC.CODIGOVENDEDOR) IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND CAC.EJERCICIOFACTURA = ?` : '';
    const params = [clientId];
    if (year) params.push(year);

    const sql = `
      SELECT
        TRIM(CAC.SERIEFACTURA) AS SERIE,
        CAC.NUMEROFACTURA AS NUMERO,
        CAC.EJERCICIOFACTURA AS EJERCICIO,
        CAC.ANODOCUMENTO AS ANO,
        CAC.MESDOCUMENTO AS MES,
        CAC.DIADOCUMENTO AS DIA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) AS CLIENTE_ID,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) AS CLIENTE_NOMBRE,
        COALESCE(CAC.IMPORTETOTAL, 0) AS TOTAL
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
      WHERE CAC.NUMEROFACTURA > 0
        AND CAC.NUMEROFACTURA < 900000
        AND TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
        AND ${vendorFilter}
        ${yearFilter}
      ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC, CAC.NUMEROFACTURA DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return this._aggregateInvoices(result || []);
  }

  async getSummary(vendedorCodes, year, month, filters = {}) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `TRIM(CAC.CODIGOVENDEDOR) IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND CAC.EJERCICIOFACTURA = ?` : '';
    const monthFilter = month ? `AND CAC.MESDOCUMENTO = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT
        COUNT(DISTINCT TRIM(SERIEFACTURA) || '-' || NUMEROFACTURA) AS NUM_FACTURAS,
        COALESCE(SUM(IMPORTETOTAL), 0) AS TOTAL
      FROM DSEDAC.CAC CAC
      WHERE CAC.NUMEROFACTURA > 0
        AND CAC.NUMEROFACTURA < 900000
        AND ${vendorFilter}
        ${yearFilter}
        ${monthFilter}
    `;

    const result = await this._db.executeParams(sql, params);
    return result && result.length > 0 ? result[0] : {};
  }

  async getDetail(serie, numero, ejercicio) {
    const headerSql = `
      SELECT
        MIN(CAC.NUMEROFACTURA) AS NUMEROFACTURA,
        MIN(TRIM(CAC.SERIEFACTURA)) AS SERIEFACTURA,
        MIN(CAC.EJERCICIOFACTURA) AS EJERCICIOFACTURA,
        MIN(CAC.DIADOCUMENTO) AS DIADOCUMENTO,
        MIN(CAC.MESDOCUMENTO) AS MESDOCUMENTO,
        MIN(CAC.ANODOCUMENTO) AS ANODOCUMENTO,
        MIN(TRIM(CAC.CODIGOCLIENTEFACTURA)) AS CODIGOCLIENTE,
        MIN(TRIM(COALESCE(CLI.NOMBRECLIENTE, ''))) AS NOMBRECLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.DIRECCION, ''))) AS DIRECCIONCLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.POBLACION, ''))) AS POBLACIONCLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.NIF, ''))) AS CIFCLIENTEFACTURA,
        SUM(CAC.IMPORTETOTAL) AS TOTALFACTURA
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
      WHERE TRIM(CAC.SERIEFACTURA) = ?
        AND CAC.NUMEROFACTURA = ?
        AND CAC.EJERCICIOFACTURA = ?
      GROUP BY CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA
    `;

    const headers = await this._db.executeParams(headerSql, [serie, numero, ejercicio]);

    if (!headers || headers.length === 0) {
      return null;
    }

    const header = headers[0];

    const linesSql = `
      SELECT
        LAC.CODIGOARTICULO,
        COALESCE(ART.DESCRIPCIONARTICULO, LAC.CODIGOARTICULO) AS DESCRIPCIONARTICULO,
        LAC.CANTIDADUNIDADES AS CANTIDAD,
        LAC.IMPORTEVENTA AS IMPORTE,
        LAC.IMPORTECOSTO AS COSTO
      FROM DSEDAC.LAC LAC
      INNER JOIN DSEDAC.CAC CAC
        ON LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
        AND LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
        AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
        AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
      WHERE TRIM(CAC.SERIEFACTURA) = ?
        AND CAC.NUMEROFACTURA = ?
        AND CAC.EJERCICIOFACTURA = ?
      ORDER BY LAC.CODIGOARTICULO
    `;

    const lines = await this._db.executeParams(linesSql, [serie, numero, ejercicio]);

    return {
      header: {
        serie: header.SERIEFACTURA && header.SERIEFACTURA.trim ? header.SERIEFACTURA.trim() : serie,
        numero: header.NUMEROFACTURA,
        ejercicio: header.EJERCICIOFACTURA,
        fecha: `${String(header.DIADOCUMENTO).padStart(2, '0')}/${String(header.MESDOCUMENTO).padStart(2, '0')}/${header.ANODOCUMENTO}`,
        clienteId: header.CODIGOCLIENTE,
        clienteNombre: header.NOMBRECLIENTEFACTURA,
        clienteDireccion: header.DIRECCIONCLIENTEFACTURA,
        clientePoblacion: header.POBLACIONCLIENTEFACTURA,
        clienteNif: header.CIFCLIENTEFACTURA,
        total: parseFloat(header.TOTALFACTURA) || 0,
        bases: []
      },
      lines: (lines || []).map(l => ({
        codigo: l.CODIGOARTICULO && l.CODIGOARTICULO.trim ? l.CODIGOARTICULO.trim() : '',
        descripcion: l.DESCRIPCIONARTICULO && l.DESCRIPCIONARTICULO.trim ? l.DESCRIPCIONARTICULO.trim() : '',
        cantidad: parseFloat(l.CANTIDAD) || 0,
        precio: parseFloat(l.IMPORTE) || 0,
        importe: parseFloat(l.IMPORTE) || 0,
        descuento: 0
      }))
    };
  }

  async getPending(vendedorCodes) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `TRIM(CAC.CODIGOVENDEDOR) IN (${sanitizeCodeList(vendedorCodes)})`;

    const sql = `
      SELECT
        TRIM(CAC.SERIEFACTURA) AS SERIE,
        CAC.NUMEROFACTURA AS NUMERO,
        CAC.EJERCICIOFACTURA AS EJERCICIO,
        CAC.ANODOCUMENTO AS ANO,
        CAC.MESDOCUMENTO AS MES,
        CAC.DIADOCUMENTO AS DIA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) AS CLIENTE_ID,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) AS CLIENTE_NOMBRE,
        COALESCE(CAC.IMPORTETOTAL, 0) AS TOTAL
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
      WHERE CAC.NUMEROFACTURA > 0
        AND CAC.NUMEROFACTURA < 900000
        AND ${vendorFilter}
        AND CAC.ANODOCUMENTO >= YEAR(CURRENT DATE) - 1
      ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
    `;

    const result = await this._db.executeParams(sql, []);
    return this._aggregateInvoices(result || []);
  }

  async getAvailableYears(vendedorCodes) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `TRIM(CAC.CODIGOVENDEDOR) IN (${sanitizeCodeList(vendedorCodes)})`;

    const sql = `
      SELECT DISTINCT EJERCICIOFACTURA AS YEAR
      FROM DSEDAC.CAC
      WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000
        AND ${vendorFilter}
      ORDER BY YEAR DESC
    `;

    const result = await this._db.executeParams(sql, []);
    return (result || []).map(r => r.YEAR);
  }

  _aggregateInvoices(rows) {
    const invoiceMap = new Map();
    for (const row of rows) {
      const key = `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`;
      const sanitize = (v) => {
        const n = parseFloat(v) || 0;
        if (Object.is(n, -0)) return 0;
        if (Math.abs(n) >= 900000) return 0;
        return n;
      };

      if (!invoiceMap.has(key)) {
        invoiceMap.set(key, {
          id: key,
          serie: row.SERIE,
          numero: row.NUMERO,
          ejercicio: row.EJERCICIO,
          fecha: `${String(row.DIA).padStart(2, '0')}/${String(row.MES).padStart(2, '0')}/${row.ANO}`,
          clienteId: row.CLIENTE_ID,
          clienteNombre: row.CLIENTE_NOMBRE || `Cliente ${row.CLIENTE_ID}`,
          total: sanitize(row.TOTAL),
          base: 0,
          iva: 0
        });
      } else {
        const existing = invoiceMap.get(key);
        existing.total += sanitize(row.TOTAL);
      }
    }

    return Array.from(invoiceMap.values()).map(row => Factura.fromDbRow(row));
  }
}

module.exports = { Db2FacturasRepository };
