'use strict';

/**
 * DSEDAC EXPORTS SERVICE
 * ======================
 * Funciones que escriben datos generados por la app directamente al ERP
 * (esquema DSEDAC). Estas funciones son la pieza que cierra el flujo:
 *
 *   App -> escribe en JAVIER.* (sandbox dev)
 *        \-> tambien escribe en DSEDAC.* (ERP real) cuando el feature flag
 *            PEDIDOS_EXPORT_TO_SYSTEM=true esta activo.
 *
 * Decisiones de diseño:
 *  - Best-effort: si el export falla, se loguea pero NO rompe el flujo
 *    principal (la fila en JAVIER ya esta persistida).
 *  - Idempotente: se comprueba antes de insertar si el documento ya existe
 *    en DSEDAC (busqueda por idempotency token o por clave natural).
 *  - Conservador con columnas: solo se rellenan las columnas obligatorias
 *    o las que tienen valor real. El resto se deja con default del ERP.
 *
 * Tablas DSEDAC implicadas (NO se escriben en dev, solo en prod):
 *  - DSEDAC.CRC   = cabecera recibos PDA (cobros)
 *  - DSEDAC.CRCA  = registro cobro a albaran
 *  - DSEDAC.CLV   = lineas concepto liquidacion (N filas por liquidacion)
 *  - DSEDAC.CAC   = cabecera albaran cliente
 *  - DSEDAC.LAC   = lineas albaran cliente
 *
 * EXCLUYE: pedidos (ya existe exportCommercialOrderToSystem en pedidos.service.js)
 *          y bolsa (siempre JAVIER por diseño).
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

const ERP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER').trim().toUpperCase();
const EXPORTS_ENABLED = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').toLowerCase() === 'true';

// Mapeo importes JAVIER -> CODIGOCONCEPTO de DSEDAC.CLV.
// Los codigos son tentativos y se sobreescriben si CLV usa otros. Confirma
// con: SELECT DISTINCT CODIGOCONCEPTO, DESCRIPCIONCONCEPTO FROM DSEDAC.CLV;
const CLV_CONCEPT_MAP = [
  { javierField: 'IMPORTEEFECTIVO',      codigo: 'EF', descripcion: 'EFECTIVO' },
  { javierField: 'IMPORTECHEQUES',       codigo: 'CH', descripcion: 'CHEQUES' },
  { javierField: 'IMPORTETARJETA',       codigo: 'TJ', descripcion: 'TARJETA' },
  { javierField: 'IMPORTEPOSTDATADOS',   codigo: 'PD', descripcion: 'POSTDATADOS' },
  { javierField: 'IMPORTEINGRESOENBANCO', codigo: 'IB', descripcion: 'INGRESO BANCO' },
  { javierField: 'IMPORTEGASTOS',        codigo: 'GT', descripcion: 'GASTOS' },
];

function isEnabled() {
  return EXPORTS_ENABLED && ERP_SCHEMA === 'DSEDAC';
}

function logSkip(tag, reason) {
  logger.info(`[DSEDAC-EXPORT] ${tag}: skip (${reason})`);
}

// ============================================================================
// COBRO -> DSEDAC.CRC + DSEDAC.CRCA
// ============================================================================

/**
 * Exporta un cobro comercial (JAVIER.COBROS row) al ERP.
 * Best-effort: nunca lanza, devuelve { exported, reason, error? }.
 * @param {object} cobroRow - fila ya guardada en JAVIER.COBROS
 */
async function exportCobroToSystem(cobroRow) {
  if (!isEnabled()) {
    logSkip('exportCobroToSystem', 'PEDIDOS_EXPORT_TO_SYSTEM=false o schema!=DSEDAC');
    return { exported: false, reason: 'disabled' };
  }
  if (!cobroRow || !cobroRow.IDEMPOTENCY_TOKEN) {
    return { exported: false, reason: 'invalid_input' };
  }

  try {
    // 1. Idempotencia: existe ya este token en CRC?
    const existing = await queryWithParams(
      `SELECT 1 FROM DSEDAC.CRC WHERE IDMARCALIQUIDACION = ? FETCH FIRST 1 ROW ONLY`,
      [String(cobroRow.IDEMPOTENCY_TOKEN).slice(0, 30)],
      false, false
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return { exported: false, reason: 'already_exists_in_erp' };
    }

    // 2. Reservar numero CRC (proximo NUMERORECIBO)
    const numRows = await queryWithParams(
      `SELECT COALESCE(MAX(NUMERORECIBO), 0) + 1 AS N FROM DSEDAC.CRC
        WHERE SUBEMPRESARECIBO = ? AND EJERCICIORECIBO = ?`,
      [String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP'), new Date().getFullYear()],
      false, false
    );
    const numero = parseInt(numRows?.[0]?.N) || 1;
    const now = new Date();

    // 3. INSERT en CRC (solo columnas obligatorias mas comunes)
    await queryWithParams(`
      INSERT INTO DSEDAC.CRC (
        SUBEMPRESARECIBO, EJERCICIORECIBO, SERIERECIBO, TERMINALRECIBO, NUMERORECIBO,
        CODIGOCLIENTEFACTURA, CODIGOVENDEDOR, TIPORECIBO,
        DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
        IMPORTECOBRADO, IDMARCALIQUIDACION
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP'),
      now.getFullYear(),
      String(process.env.PEDIDOS_SYSTEM_SERIE || 'R'),
      parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '10'),
      numero,
      String(cobroRow.CODIGO_CLIENTE || cobroRow.CODIGOCLIENTE || '').padEnd(10).slice(0, 10),
      String(cobroRow.CODIGO_USUARIO || cobroRow.CODIGOVENDEDOR || '').padEnd(2).slice(0, 2),
      'C', // tipoRecibo cobro
      now.getDate(),
      now.getMonth() + 1,
      now.getFullYear(),
      parseInt(`${now.getHours()}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`),
      parseFloat(cobroRow.IMPORTE) || 0,
      String(cobroRow.IDEMPOTENCY_TOKEN).slice(0, 30),
    ], false);

    logger.info(`[DSEDAC-EXPORT] exportCobroToSystem: OK CRC#${numero} (cobro=${cobroRow.IDEMPOTENCY_TOKEN})`);
    return { exported: true, numeroRecibo: numero };
  } catch (err) {
    logger.error(`[DSEDAC-EXPORT] exportCobroToSystem FAIL: ${err.message}`);
    return { exported: false, reason: 'erp_insert_failed', error: err.message };
  }
}

// ============================================================================
// LIQUIDACION -> DSEDAC.CLV (N filas por concepto)
// ============================================================================

async function exportLiquidacionToSystem(liquidacionRow) {
  if (!isEnabled()) {
    logSkip('exportLiquidacionToSystem', 'PEDIDOS_EXPORT_TO_SYSTEM=false o schema!=DSEDAC');
    return { exported: false, reason: 'disabled' };
  }
  if (!liquidacionRow || !liquidacionRow.IDEMPOTENCY_TOKEN) {
    return { exported: false, reason: 'invalid_input' };
  }

  try {
    // Idempotencia (a nivel de liquidacion)
    const existing = await queryWithParams(
      `SELECT 1 FROM DSEDAC.CLV WHERE OBSERVACIONES = ? FETCH FIRST 1 ROW ONLY`,
      [String(liquidacionRow.IDEMPOTENCY_TOKEN).slice(0, 40)],
      false, false
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return { exported: false, reason: 'already_exists_in_erp' };
    }

    const codigoVendedor = String(liquidacionRow.CODIGOVENDEDOR || liquidacionRow.CODIGO_REPARTIDOR || '').padEnd(2).slice(0, 2);
    const now = new Date();
    const dia = now.getDate(), mes = now.getMonth() + 1, ano = now.getFullYear();

    // Reservar NUMEROREGISTRO inicial
    const numRows = await queryWithParams(
      `SELECT COALESCE(MAX(NUMEROREGISTRO), 0) + 1 AS N FROM DSEDAC.CLV
        WHERE CODIGOVENDEDOR = ? AND ANOLIQUIDACION = ?`,
      [codigoVendedor, ano], false, false
    );
    let numero = parseInt(numRows?.[0]?.N) || 1;

    // Insertar N filas (una por concepto con importe > 0)
    let inserted = 0;
    for (const concept of CLV_CONCEPT_MAP) {
      const importe = parseFloat(liquidacionRow[concept.javierField]) || 0;
      if (importe <= 0) continue;
      try {
        await queryWithParams(`
          INSERT INTO DSEDAC.CLV (
            CODIGOVENDEDOR, NUMEROREGISTRO, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
            CODIGOCONCEPTO, DESCRIPCIONCONCEPTO, OBSERVACIONES, IMPORTE,
            CODIGOALMACEN, CODIGODELEGACION
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          codigoVendedor, numero, dia, mes, ano,
          concept.codigo, concept.descripcion,
          String(liquidacionRow.IDEMPOTENCY_TOKEN).slice(0, 40),
          importe,
          parseInt(process.env.PEDIDOS_SYSTEM_ALMACEN || '1'),
          String(process.env.PEDIDOS_SYSTEM_DELEGACION || '01'),
        ], false);
        numero++;
        inserted++;
      } catch (lineErr) {
        logger.warn(`[DSEDAC-EXPORT] CLV concept ${concept.codigo} fallo: ${lineErr.message}`);
      }
    }

    if (inserted === 0) {
      return { exported: false, reason: 'no_lines_to_export' };
    }
    logger.info(`[DSEDAC-EXPORT] exportLiquidacionToSystem: OK ${inserted} filas CLV (token=${liquidacionRow.IDEMPOTENCY_TOKEN})`);
    return { exported: true, rowsInserted: inserted };
  } catch (err) {
    logger.error(`[DSEDAC-EXPORT] exportLiquidacionToSystem FAIL: ${err.message}`);
    return { exported: false, reason: 'erp_insert_failed', error: err.message };
  }
}

// ============================================================================
// ENTREGA -> DSEDAC.CAC (cabecera) + DSEDAC.LAC (lineas)
// ============================================================================

async function exportEntregaToSystem(entregaHeader, entregaLineas = []) {
  if (!isEnabled()) {
    logSkip('exportEntregaToSystem', 'PEDIDOS_EXPORT_TO_SYSTEM=false o schema!=DSEDAC');
    return { exported: false, reason: 'disabled' };
  }
  if (!entregaHeader || !entregaHeader.IDEMPOTENCY_TOKEN) {
    return { exported: false, reason: 'invalid_input' };
  }

  try {
    // Idempotencia
    const existing = await queryWithParams(
      `SELECT 1 FROM DSEDAC.CAC WHERE DOCUMENTO = ? FETCH FIRST 1 ROW ONLY`,
      [String(entregaHeader.IDEMPOTENCY_TOKEN).slice(0, 20)],
      false, false
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return { exported: false, reason: 'already_exists_in_erp' };
    }

    const subempresa = String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP');
    const serie = String(process.env.PEDIDOS_SYSTEM_SERIE || 'P');
    const terminal = parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '10');
    const ano = new Date().getFullYear();

    // Reservar numero albaran
    const numRows = await queryWithParams(
      `SELECT COALESCE(MAX(NUMEROALBARAN), 0) + 1 AS N FROM DSEDAC.CAC
        WHERE SUBEMPRESAALBARAN = ? AND EJERCICIOALBARAN = ?
          AND SERIEALBARAN = ? AND TERMINALALBARAN = ?`,
      [subempresa, ano, serie, terminal], false, false
    );
    const numeroAlbaran = parseInt(numRows?.[0]?.N) || 1;
    const now = new Date();

    // INSERT CAC (columnas obligatorias)
    await queryWithParams(`
      INSERT INTO DSEDAC.CAC (
        SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
        DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
        CODIGOCLIENTEALBARAN, CODIGOVENDEDOR,
        IMPORTETOTAL, DOCUMENTO
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      subempresa, ano, serie, terminal, numeroAlbaran,
      now.getDate(), now.getMonth() + 1, now.getFullYear(),
      String(entregaHeader.CODIGOCLIENTEALBARAN || entregaHeader.CODIGOCLIENTE || '').padEnd(10).slice(0, 10),
      String(entregaHeader.CODIGOVENDEDOR || '').padEnd(2).slice(0, 2),
      parseFloat(entregaHeader.IMPORTETOTAL) || 0,
      String(entregaHeader.IDEMPOTENCY_TOKEN).slice(0, 20),
    ], false);

    // INSERT LAC (una por linea)
    let linesInserted = 0;
    for (let i = 0; i < entregaLineas.length; i++) {
      const line = entregaLineas[i];
      try {
        await queryWithParams(`
          INSERT INTO DSEDAC.LAC (
            SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN, SECUENCIA,
            DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
            CODIGOCLIENTEALBARAN, CODIGOVENDEDOR,
            CODIGOARTICULO, DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, IMPORTEVENTA
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          subempresa, ano, serie, terminal, numeroAlbaran, (i + 1),
          now.getDate(), now.getMonth() + 1, now.getFullYear(),
          String(entregaHeader.CODIGOCLIENTEALBARAN || entregaHeader.CODIGOCLIENTE || '').padEnd(10).slice(0, 10),
          String(entregaHeader.CODIGOVENDEDOR || '').padEnd(2).slice(0, 2),
          String(line.CODIGOARTICULO || '').padEnd(10).slice(0, 10),
          String(line.DESCRIPCION || '').slice(0, 40),
          parseFloat(line.CANTIDADENVASES) || 0,
          parseFloat(line.CANTIDADUNIDADES) || 0,
          parseFloat(line.PRECIOVENTA) || 0,
          parseFloat(line.IMPORTEVENTA) || 0,
        ], false);
        linesInserted++;
      } catch (lineErr) {
        logger.warn(`[DSEDAC-EXPORT] LAC linea ${i + 1} fallo: ${lineErr.message}`);
      }
    }

    logger.info(`[DSEDAC-EXPORT] exportEntregaToSystem: OK CAC#${numeroAlbaran} + ${linesInserted} LAC (token=${entregaHeader.IDEMPOTENCY_TOKEN})`);
    return { exported: true, numeroAlbaran, linesInserted };
  } catch (err) {
    logger.error(`[DSEDAC-EXPORT] exportEntregaToSystem FAIL: ${err.message}`);
    return { exported: false, reason: 'erp_insert_failed', error: err.message };
  }
}

module.exports = {
  isEnabled,
  exportCobroToSystem,
  exportLiquidacionToSystem,
  exportEntregaToSystem,
  CLV_CONCEPT_MAP,
};
