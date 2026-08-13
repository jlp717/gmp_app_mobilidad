/**
 * DB2 access for repartidor routes (G2-B1).
 * Owns ALL SQL previously embedded in backend/routes/repartidor.js.
 * Read-only against DSEDAC — no INSERT/UPDATE/DELETE/MERGE on DSEDAC.
 */
'use strict';

const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const { chunkedInQuery } = require('../utils/common');
const {
  isDeliveryStatusAvailable,
  isDeliveryStatusNewSchema,
  getDeliveryStatusJoin,
  getDeliveryStatusColumns,
  getDeliveryStatusTable,
} = require('../utils/delivery-status-check');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');

const MUTATION_RE = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i;
const CANONICAL_CONFIRMATION_STATUSES = Object.freeze([
  'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO',
]);

function resolveConfirmationTables() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    const confirmation = runtime?.tables?.confirmation;
    if (runtime?.valid && confirmation?.confirmations && confirmation?.evidences) {
      return confirmation;
    }
  } catch (_error) {
    // Invalid runtime: isolated tests still overlay JAVIER.TEST_*.
  }
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return null;
  }
  return {
    confirmations: 'JAVIER.TEST_REPARTO_CONFIRMACIONES',
    evidences: 'JAVIER.TEST_REPARTO_EVIDENCIAS',
  };
}

function canonicalDocumentId(row, clientCode) {
  const ejercicio = row?.EJERCICIOALBARAN;
  const serie = String(row?.SERIEALBARAN || '').trim();
  const terminal = row?.TERMINALALBARAN;
  const numero = row?.NUMEROALBARAN;
  const cliente = String(row?.CODIGOCLIENTEALBARAN || clientCode || '').trim();
  if (!ejercicio || !serie || numero == null || numero === '' || !cliente) return '';
  return `${ejercicio}-${serie}-${terminal}-${numero}-${cliente}`;
}

function blobToBase64(raw) {
  if (raw == null) return null;
  if (Buffer.isBuffer(raw)) return raw.length ? raw.toString('base64') : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  if (raw instanceof Uint8Array) {
    return raw.length ? Buffer.from(raw).toString('base64') : null;
  }
  return null;
}

async function overlayCanonicalConfirmations(rows, { repartidorIds, clientCode } = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const tables = resolveConfirmationTables();
  if (!tables?.confirmations) return rows;
  const documentIds = [...new Set(rows.map((row) => canonicalDocumentId(row, clientCode)).filter(Boolean))];
  const drivers = [...new Set((repartidorIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!documentIds.length || !drivers.length) return rows;
  try {
    const documentPlaceholders = documentIds.map(() => '?').join(', ');
    const driverPlaceholders = drivers.map(() => '?').join(', ');
    const confirmRows = await runQueryWithParams(
      `SELECT TRIM(DOCUMENT_ID) AS DOCUMENT_ID,
              TRIM(STATUS) AS STATUS,
              ID,
              FIRMA_EVIDENCE_ID
         FROM ${tables.confirmations}
        WHERE DOCUMENT_ID IN (${documentPlaceholders})
          AND TRIM(REPARTIDOR_ID) IN (${driverPlaceholders})`,
      [...documentIds, ...drivers],
      false,
    );
    const byId = new Map();
    for (const row of Array.isArray(confirmRows) ? confirmRows : []) {
      const id = String(row.DOCUMENT_ID || row.document_id || '').trim();
      const status = String(row.STATUS || row.status || '').trim().toUpperCase();
      if (!id || !CANONICAL_CONFIRMATION_STATUSES.includes(status)) continue;
      byId.set(id, {
        status,
        confirmationId: row.ID ?? row.id ?? null,
        firmaEvidenceId: row.FIRMA_EVIDENCE_ID || row.firma_evidence_id || null,
      });
    }
    if (!byId.size) return rows;
    return rows.map((row) => {
      const match = byId.get(canonicalDocumentId(row, clientCode));
      if (!match) return row;
      return {
        ...row,
        CANONICAL_STATUS: match.status,
        CANONICAL_CONFIRMATION_ID: match.confirmationId,
        CANONICAL_FIRMA_EVIDENCE_ID: match.firmaEvidenceId,
      };
    });
  } catch (_error) {
    return rows;
  }
}

async function getCanonicalConfirmationSignature({
  year, serie, terminal, number, ownerIds,
} = {}) {
  const tables = resolveConfirmationTables();
  if (!tables?.confirmations) return null;
  const parsedYear = Number(year);
  const parsedTerminal = Number(terminal);
  const parsedNumber = Number(number);
  const serieNorm = String(serie || '').trim();
  if (!parsedYear || !serieNorm || !Number.isFinite(parsedNumber)) return null;
  try {
    const rows = await runQueryWithParams(
      `SELECT C.ID,
              TRIM(C.STATUS) AS STATUS,
              C.FIRMA_EVIDENCE_ID,
              TRIM(C.REPARTIDOR_ID) AS REPARTIDOR_ID
         FROM ${tables.confirmations} C
        WHERE C.DOCUMENTO_EJERCICIO = ?
          AND TRIM(C.DOCUMENTO_SERIE) = ?
          AND C.DOCUMENTO_TERMINAL = ?
          AND C.DOCUMENTO_NUMERO = ?
        FETCH FIRST 8 ROWS ONLY`,
      [parsedYear, serieNorm, Number.isFinite(parsedTerminal) ? parsedTerminal : 0, parsedNumber],
      false,
    );
    const allowed = new Set((ownerIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    const match = (Array.isArray(rows) ? rows : []).find((row) => {
      const owner = String(row.REPARTIDOR_ID || row.repartidor_id || '').trim();
      return !allowed.size || allowed.has(owner);
    });
    if (!match) return null;
    const evidenceId = match.FIRMA_EVIDENCE_ID || match.firma_evidence_id;
    let base64 = null;
    if (evidenceId && tables.evidences) {
      const blobs = await runQueryWithParams(
        `SELECT CONTENT_BLOB
           FROM ${tables.evidences}
          WHERE EVIDENCE_ID = ?
          FETCH FIRST 1 ROW ONLY`,
        [evidenceId],
        false,
      );
      base64 = blobToBase64(blobs?.[0]?.CONTENT_BLOB || blobs?.[0]?.content_blob);
    }
    return {
      confirmationId: match.ID ?? match.id ?? null,
      status: String(match.STATUS || match.status || '').trim().toUpperCase(),
      hasSignature: Boolean(base64 || evidenceId),
      base64,
    };
  } catch (_error) {
    return null;
  }
}

function assertReadOnlySql(sql) {
  const text = String(sql || '');
  if (MUTATION_RE.test(text)) {
    const err = new Error('repartidor-route repository rejects mutating SQL');
    err.code = 'REPARTIDOR_SQL_NOT_READONLY';
    throw err;
  }
  return text;
}

async function runQueryWithParams(sql, params, useCache = false) {
  return queryWithParams(assertReadOnlySql(sql), params, useCache);
}

async function runQuery(sql, a, b) {
  return query(assertReadOnlySql(sql), a, b);
}

async function runCached(sql, cacheKey, ttl, params) {
  return cachedQuery(queryWithParams, assertReadOnlySql(sql), cacheKey, ttl, params);
}

const INVOICE_HEADER_COLS = `
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.TERMINALALBARAN,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA`;

async function resolveAlbaranOwners(key) {
  return runQueryWithParams(`
        SELECT DISTINCT TRIM(OPP.CODIGOREPARTIDOR) AS OWNER_ID
        FROM DSEDAC.CPC CPC
        INNER JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        WHERE CPC.EJERCICIOALBARAN = ?
          AND TRIM(CPC.SERIEALBARAN) = ?
          AND CPC.TERMINALALBARAN = ?
          AND CPC.NUMEROALBARAN = ?
        FETCH FIRST 2 ROWS ONLY
    `, [key.year, key.series, key.terminal, key.number], false);
}

async function resolveInvoiceOwners(key) {
  return runQueryWithParams(`
        SELECT DISTINCT TRIM(OPP.CODIGOREPARTIDOR) AS OWNER_ID
        FROM DSEDAC.CAC CAC
        INNER JOIN DSEDAC.CPC CPC
            ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
            AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
            AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
            AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
        INNER JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        WHERE CAC.EJERCICIOFACTURA = ?
          AND TRIM(CAC.SERIEFACTURA) = ?
          AND CAC.NUMEROFACTURA = ?
        FETCH FIRST 2 ROWS ONLY
    `, [key.year, key.series, key.number], false);
}

async function resolveDeliveryOwners(entregaId) {
  return runQueryWithParams(`
        SELECT DISTINCT TRIM(CODIGOREPARTIDOR) AS OWNER_ID
        FROM JAVIER.REPARTIDOR_ENTREGAS
        WHERE ID = ?
        FETCH FIRST 2 ROWS ONLY
    `, [entregaId], false);
}

async function getCollectionsSummary(selectedMonth, selectedYear, repartidorParams) {
  const repartidorKey = repartidorParams.join(',');
  const cacheKey = `repartidor:collections:summary:${repartidorKey}:${selectedYear}:${selectedMonth}`;
  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
                    TRIM(CPC.CODIGOFORMAPAGO) AS FORMA_PAGO,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.SUBEMPRESA, OPP.EJERCICIOORDENPREPARACION,
                            OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                LEFT JOIN DSEDAC.CLI CLI
                    ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                WHERE OPP.MESREPARTO = ?
                  AND OPP.ANOREPARTO = ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorParams.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.CLIENTE,
                DOC.NOMBRE_CLIENTE,
                DOC.FORMA_PAGO,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.CLIENTE, DOC.NOMBRE_CLIENTE, DOC.FORMA_PAGO
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 100 ROWS ONLY
        `;
  return (await runCached(sql, cacheKey, TTL.MEDIUM, [selectedMonth, selectedYear, ...repartidorParams])) || [];
}

async function getCollectionsDaily(selectedYear, selectedMonth, repartidorIdList) {
  const repartidorKey = repartidorIdList.join(',');
  const cacheKey = `repartidor:collections:daily:${repartidorKey}:${selectedYear}:${selectedMonth}`;
  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    OPP.DIAREPARTO AS DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.DIAREPARTO, OPP.SUBEMPRESA,
                            OPP.EJERCICIOORDENPREPARACION, OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.DIA,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.DIA
            ORDER BY DOC.DIA
        `;
  return (await runCached(sql, cacheKey, TTL.MEDIUM, [selectedYear, selectedMonth, ...repartidorIdList])) || [];
}


async function getClientDocuments({
  repartidorIds,
  clientCode,
  yearValue,
  dateFromValue,
  dateToValue,
  pageOffset,
  pageLimit,
}) {
  const ids = repartidorIds;
  const repartidorJoin = `
            INNER JOIN DSEDAC.OPP OPP
                ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                AND OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
                AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
                AND TRIM(OPP.CODIGOREPARTIDOR) IN (${ids.map(() => '?').join(',')})`;

  let dateFilter = '';
  const dateParams = [];
  if (dateFromValue) {
    dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ?`;
    dateParams.push(dateFromValue);
  }
  if (dateToValue) {
    dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ?`;
    dateParams.push(dateToValue);
  }

  const dsJoin = getDeliveryStatusJoin('CPC', 'DS');
  const dsCols = getDeliveryStatusColumns('DS');
  const dsAvail = isDeliveryStatusAvailable();

  let yearFilter = '';
  const yearFilterParams = [];
  if (yearValue) {
    yearFilter = ` AND CPC.EJERCICIOALBARAN = ?`;
    yearFilterParams.push(yearValue);
  }

  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.ANODOCUMENTO AS ANO, CPC.MESDOCUMENTO AS MES,
                    CPC.DIADOCUMENTO AS DIA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
                    CPC.IMPORTETOTAL,
                    CAC_J.IMPORTETOTAL AS IMPORTETOTAL_FACTURA,
                    CPC.CONFORMADOSN, CPC.SITUACIONALBARAN,
                    CPC.HORALLEGADA, CPC.HORACREACION,
                    ${dsCols},
                    COALESCE(CAC_J.NUMEROFACTURA, 0) AS NUMEROFACTURA,
                    COALESCE(TRIM(CAC_J.SERIEFACTURA), '') AS SERIEFACTURA,
                    COALESCE(CAC_J.EJERCICIOFACTURA, 0) AS EJERCICIOFACTURA,
                    COALESCE(CF_J.FIRMANOMBRE, '') AS LEGACY_FIRMA_NOMBRE,
                    CF_J.DIA AS LEGACY_DIA, CF_J.MES AS LEGACY_MES,
                    CF_J.ANO AS LEGACY_ANO, CF_J.HORA AS LEGACY_HORA,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY COALESCE(CF_J.ANO, 0) DESC,
                            COALESCE(CF_J.MES, 0) DESC, COALESCE(CF_J.DIA, 0) DESC,
                            COALESCE(CF_J.HORA, 0) DESC, OPP.SUBEMPRESA,
                            OPP.EJERCICIOORDENPREPARACION,
                            OPP.NUMEROORDENPREPARACION
                    ) AS ALBARAN_RANK
                FROM DSEDAC.CPC CPC
                ${repartidorJoin}
                ${dsJoin}
                LEFT JOIN DSEDAC.CAC CAC_J
                    ON CAC_J.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                    AND CAC_J.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                    AND TRIM(CAC_J.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                    AND CAC_J.TERMINALALBARAN = CPC.TERMINALALBARAN
                    AND CAC_J.NUMEROALBARAN = CPC.NUMEROALBARAN
                    AND TRIM(CAC_J.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                LEFT JOIN DSEDAC.CACFIRMAS CF_J
                    ON CF_J.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                    AND TRIM(CF_J.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                    AND CF_J.TERMINALALBARAN = CPC.TERMINALALBARAN
                    AND CF_J.NUMEROALBARAN = CPC.NUMEROALBARAN
                WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = ?
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
                  ${yearFilter}
                  ${dateFilter}
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE ALBARAN_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO, CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CODIGOCLIENTEALBARAN
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            ),
            DOCUMENT_ROWS AS (
                SELECT DOC.*,
                    CASE
                        WHEN CVC_DOC.NUMERODOCUMENTO IS NULL
                          OR COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0
                        THEN 0 ELSE 1
                    END AS CVC_PRESENT,
                    CVC_DOC.IMPORTE_PENDIENTE AS CVC_PENDING,
                    CASE WHEN DOC.NUMEROFACTURA > 0 THEN
                        'F-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOFACTURA)) || '-' ||
                        DOC.SERIEFACTURA || '-' || TRIM(CHAR(DOC.NUMEROFACTURA))
                    ELSE
                        'A-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOALBARAN)) || '-' ||
                        DOC.SERIEALBARAN || '-' || TRIM(CHAR(DOC.TERMINALALBARAN)) ||
                        '-' || TRIM(CHAR(DOC.NUMEROALBARAN))
                    END AS LOGICAL_KEY
                FROM UNIQUE_DOCUMENTS DOC
                LEFT JOIN CVC_DOCUMENTS CVC_DOC
                    ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                    AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND CVC_DOC.CLIENTE = DOC.CODIGOCLIENTEALBARAN
            ),
            LOGICAL_DOCUMENTS AS (
                SELECT LOGICAL_KEY,
                    MAX(ANO * 10000 + MES * 100 + DIA) AS SORT_DATE,
                    MAX(CASE WHEN NUMEROFACTURA > 0 THEN NUMEROFACTURA ELSE NUMEROALBARAN END) AS SORT_NUMBER
                FROM DOCUMENT_ROWS
                GROUP BY LOGICAL_KEY
            ),
            NUMBERED_DOCUMENTS AS (
                SELECT LOGICAL_DOCUMENTS.*,
                    COUNT(*) OVER () AS TOTAL_COUNT,
                    ROW_NUMBER() OVER (
                        ORDER BY SORT_DATE DESC, SORT_NUMBER DESC, LOGICAL_KEY DESC
                    ) AS LOGICAL_POSITION
                FROM LOGICAL_DOCUMENTS
            ),
            PAGED_DOCUMENTS AS (
                SELECT * FROM NUMBERED_DOCUMENTS
                WHERE LOGICAL_POSITION > ?
                  AND LOGICAL_POSITION <= ?
            ),
            TOTAL_META AS (
                SELECT COUNT(*) AS TOTAL_COUNT FROM LOGICAL_DOCUMENTS
            )
            SELECT DOC.*, COALESCE(PAGED_ROW.TOTAL_COUNT, META.TOTAL_COUNT) AS TOTAL_COUNT,
                PAGED_ROW.LOGICAL_POSITION,
                CASE WHEN PAGED_ROW.LOGICAL_KEY IS NULL THEN 1 ELSE 0 END AS META_ONLY
            FROM TOTAL_META META
            LEFT JOIN PAGED_DOCUMENTS PAGED_ROW ON META.TOTAL_COUNT = META.TOTAL_COUNT
            LEFT JOIN DOCUMENT_ROWS DOC ON DOC.LOGICAL_KEY = PAGED_ROW.LOGICAL_KEY
            ORDER BY PAGED_ROW.LOGICAL_POSITION, DOC.ANO DESC, DOC.MES DESC, DOC.DIA DESC,
                DOC.NUMEROALBARAN DESC, DOC.SERIEALBARAN DESC,
                DOC.TERMINALALBARAN DESC
        `;
  const allParams = [
    ...ids,
    clientCode,
    ...yearFilterParams,
    ...dateParams,
    pageOffset,
    pageOffset + pageLimit,
  ];
  const rows = await runQueryWithParams(sql, allParams, false);
  const overlaid = await overlayCanonicalConfirmations(rows || [], {
    repartidorIds: ids,
    clientCode,
  });
  return {
    rows: overlaid,
    deliveryStatusAvailability: dsAvail ? 'AVAILABLE' : 'LEGACY_ONLY',
  };
}

async function getObjectives(cleanRepartidorIds, normalizedClientId) {
  let clientFilter = '';
  const queryParams = [...cleanRepartidorIds];
  if (normalizedClientId) {
    clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
    queryParams.push(normalizedClientId);
  }
  const placeholders = cleanRepartidorIds.map(() => '?').join(',');
  const sql = `
            SELECT 
                OPP.ANOREPARTO as ANO,
                OPP.MESREPARTO as MES,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${placeholders})
              ${clientFilter}
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
            ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
            FETCH FIRST 500 ROWS ONLY
        `;
  return runCached(
    sql,
    `repartidor:objectives:${cleanRepartidorIds.join(',')}:${normalizedClientId || 'all'}`,
    TTL.REALTIME,
    queryParams,
  );
}

async function getObjectivesDetailClients(repartidorIdList, selectedYear, clientId) {
  let clientFilter = '';
  const clientFilterParams = [];
  if (clientId) {
    clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
    clientFilterParams.push(String(clientId).trim());
  }
  const repartidorKey = repartidorIdList.join(',');
  const clientsSql = `
            SELECT DISTINCT TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENT_CODE,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as CLIENT_NAME
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
              AND OPP.ANOREPARTO = ?
              ${clientFilter}
            FETCH FIRST 1000 ROWS ONLY
        `;
  const clientSqlParams = [...repartidorIdList, selectedYear, ...clientFilterParams];
  return runCached(
    clientsSql,
    `repartidor:objDetail:${repartidorKey}:${selectedYear}:${clientId || 'all'}`,
    TTL.REALTIME,
    clientSqlParams,
  );
}

async function getObjectivesDetailLaclae(allCodes, selectedYear) {
  const CHUNK_SIZE = 500;
  const laclaeParams = [];
  const chunks = [];
  for (let i = 0; i < allCodes.length; i += CHUNK_SIZE) {
    const chunk = allCodes.slice(i, i + CHUNK_SIZE);
    chunks.push(`L.LCCDCL IN (${chunk.map(() => '?').join(',')})`);
    laclaeParams.push(...chunk);
  }
  const clientInFilter = `(${chunks.join(' OR ')})`;
  const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT')`;
  const dataSql = `
            SELECT
                TRIM(L.LCCDCL) as CLIENT_CODE,
                TRIM(L.LCCDRF) as PRODUCT_CODE,
                COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
                COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCCTUD) as UNITS,
                COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
                COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
                COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
                COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
            WHERE ${clientInFilter}
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL, L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.UNIDADMEDIDA, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04
            ORDER BY SALES DESC
        `;
  return runQueryWithParams(dataSql, [...laclaeParams, selectedYear], false);
}

async function getFiFilterCatalog() {
  const [fi1Rows, fi2Rows, fi3Rows, fi4Rows] = await Promise.all([
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`, false, false),
  ]);
  return { fi1Rows, fi2Rows, fi3Rows, fi4Rows };
}


function appFirmasTable() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.tableSet === 'isolated_test') return 'JAVIER.TEST_REPARTIDOR_FIRMAS';
  } catch (_) { /* fall through */ }
  return 'JAVIER.REPARTIDOR_FIRMAS';
}

async function getDeliveryStatusFirmaPath(albId) {
  if (!isDeliveryStatusAvailable() || isDeliveryStatusNewSchema()) return [];
  const table = getDeliveryStatusTable();
  return runQueryWithParams(
    `SELECT FIRMA_PATH FROM ${table} WHERE ID = ?`,
    [albId],
    false,
  );
}

async function getRepartidorFirmasByAlbaran(numero, ejercicio, serie, terminal) {
  const table = appFirmasTable();
  return runQueryWithParams(`
            SELECT FIRMABASE64, TRIM(FIRMANOMBRE) AS FIRMANOMBRE, TRIM(FIRMADNI) AS FIRMADNI,
                   DIA, MES, ANO, HORA
            FROM ${table}
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [
    parseInt(ejercicio, 10),
    (serie || 'A').trim(),
    parseInt(terminal || 0, 10),
    parseInt(numero, 10),
  ], false);
}

async function getCacFirmasDetailed(ejercicio, serie, terminal, numero) {
  const params = [
    parseInt(ejercicio, 10),
    (serie || 'A').trim(),
    parseInt(terminal || 0, 10),
    parseInt(numero, 10),
  ];
  try {
    return await runQueryWithParams(`
                SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA,
                       LENGTH(FIRMABASE64) as FIRMA_LEN
                FROM DSEDAC.CACFIRMAS
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 5 ROWS ONLY
            `, params, false);
  } catch (_) {
    return runQueryWithParams(`
                SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA
                FROM DSEDAC.CACFIRMAS
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 5 ROWS ONLY
            `, params, false);
  }
}

async function getDebugCacSignatures() {
  return runQuery(`
            SELECT 
                CF.EJERCICIOALBARAN, TRIM(CF.SERIEALBARAN) as SERIE, 
                CF.TERMINALALBARAN, CF.NUMEROALBARAN,
                TRIM(CF.FIRMANOMBRE) as FIRMANTE,
                CF.ANO, CF.MES, CF.DIA,
                LENGTH(CF.FIRMABASE64) as FIRMA_SIZE,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE
            FROM DSEDAC.CACFIRMAS CF
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOALBARAN = CF.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CF.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CF.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CF.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE CF.FIRMABASE64 IS NOT NULL 
              AND LENGTH(TRIM(CF.FIRMABASE64)) > 10
              AND CF.EJERCICIOALBARAN >= 2025
            ORDER BY CF.ANO DESC, CF.MES DESC, CF.DIA DESC
            FETCH FIRST 50 ROWS ONLY
        `, false);
}

async function getEntregaFirma(entregaId) {
  return runQueryWithParams(`
            SELECT FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA
            FROM JAVIER.REPARTIDOR_FIRMAS 
            WHERE ENTREGA_ID = ?
            FETCH FIRST 1 ROW ONLY
        `, [entregaId], false);
}

async function getLegacySignatureBase64(year, series, terminal, number) {
  return runQueryWithParams(`
            SELECT FIRMABASE64
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
        `, [year, (series || '').trim(), terminal, number], false);
}

async function getRepartidorFirmaBase64ByAlbaran(numero, year, serie, terminal) {
  const table = appFirmasTable();
  return runQueryWithParams(`
                    SELECT FIRMABASE64 FROM ${table}
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [year, (serie || 'A').trim(), parseInt(terminal || 0, 10), parseInt(numero, 10)], false);
}

async function getCacFirmaBase64(year, serie, terminal, number) {
  return runQueryWithParams(`
                    SELECT FIRMABASE64 FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [year, serie, terminal, number], false);
}

async function getDeliverySummary(selectedYear, selectedMonth, dayFilterParams, repartidorIdList) {
  const dayFilter = dayFilterParams.length ? `AND OPP.DIAREPARTO <= ?` : '';
const dsAvail = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
        // The legacy ID does not encode subempresa or client, so it cannot be
        // joined safely for a cross-client aggregate. Use canonical status
        // only when every delivery identity component is available.
        const dsJoinSub = dsAvail ? `
            LEFT JOIN JAVIER.DELIVERY_STATUS DS
                ON DS.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                AND DS.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND TRIM(DS.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                AND DS.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND DS.NUMEROALBARAN = CPC.NUMEROALBARAN
                AND TRIM(DS.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
        ` : '';
        const canonicalStatusCases = dsAvail ? `
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN
                        ('NO_ENTREGADO', 'NO_REALIZADA', 'NO_REALIZADO', 'RECHAZADO', 'RECHAZADA', 'ABSENT')
                        THEN 1 ELSE 0 END) = 1 THEN 'NO_ENTREGADO'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('PARCIAL', 'PARTIAL')
                        THEN 1 ELSE 0 END) = 1 THEN 'PARCIAL'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('ENTREGADO', 'DELIVERED')
                        THEN 1 ELSE 0 END) = 1 THEN 'ENTREGADO'
                    WHEN MAX(CASE WHEN TRIM(COALESCE(DS.STATUS, '')) <> '' THEN 1 ELSE 0 END) = 1
                        THEN 'PENDIENTE'` : '';

        
  const baseSql = `
            SELECT DIA,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(CASE WHEN FINAL_STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'NO_ENTREGADO' THEN 1 ELSE 0 END) as NO_ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'PARCIAL' THEN 1 ELSE 0 END) as PARCIALES,
                CAST(SUM(IMPORTE) AS DECIMAL(15,2)) as IMPORTE_TOTAL
            FROM (
                SELECT 
                    OPP.DIAREPARTO as DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) as SERIE,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CAST(MAX(CPC.IMPORTETOTAL) AS DECIMAL(15,2)) as IMPORTE,
                    CASE
                        ${canonicalStatusCases}
                        WHEN MAX(CASE WHEN TRIM(COALESCE(CPC.CONFORMADOSN, '')) = 'S' THEN 1 ELSE 0 END) = 1
                            THEN 'ENTREGADO'
                        ELSE 'PENDIENTE'
                    END AS FINAL_STATUS
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${dsJoinSub}
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  ${dayFilter}
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
                GROUP BY OPP.DIAREPARTO, CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN),
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN)
            ) ALBS
            GROUP BY DIA
            ORDER BY DIA
        `;
  return (await runQueryWithParams(
    baseSql,
    [selectedYear, selectedMonth, ...dayFilterParams, ...repartidorIdList],
    false,
  )) || [];
}

async function getRuteroWeek(weekStartNum, weekEndNum, repartidorIdList) {
  const dsWeekAvail = isDeliveryStatusAvailable();
  const dsWeekJoin = getDeliveryStatusJoin('CPC', 'DS');
  const sql = `
            WITH DOCUMENTOS_SEMANA AS (
                SELECT
                    OPP.DIAREPARTO as DIA,
                    OPP.MESREPARTO as MES,
                    OPP.ANOREPARTO as ANO,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    MAX(CASE
                        WHEN TRIM(CPC.CONFORMADOSN) = 'S'
                          OR CPC.SITUACIONALBARAN IN ('F', 'R') THEN 1
                        ${dsWeekAvail ? "WHEN DS.STATUS = 'ENTREGADO' THEN 1" : ''}
                        ELSE 0
                    END) as ENTREGADO
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${dsWeekAvail ? dsWeekJoin : ''}
                WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO)
                    BETWEEN ? AND ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
                GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
            )
            SELECT
                DIA, MES, ANO,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(ENTREGADO) as ENTREGADOS
            FROM DOCUMENTOS_SEMANA
            GROUP BY ANO, MES, DIA
            ORDER BY ANO, MES, DIA
        `;
  return runQueryWithParams(sql, [weekStartNum, weekEndNum, ...repartidorIdList], false);
}

async function getHistoryDeliveries({ startInt, endInt, repartidorIdList, search, offset, limit }) {
  const dsHistAvail = isDeliveryStatusAvailable();
  const dsHistJoin = getDeliveryStatusJoin('CPC', 'DS');
  let sql = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CPC.SERIEALBARAN,
                CPC.EJERCICIOALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOFACTURA,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CODIGO_CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                CPC.IMPORTETOTAL as TOTAL,
                ${dsHistAvail ? "DS.STATUS as ESTADO_ENTREGA" : "CAST(NULL AS VARCHAR(20)) as ESTADO_ENTREGA"},
                ${dsHistAvail && !isDeliveryStatusNewSchema() ? "DS.FIRMA_PATH" : "CAST(NULL AS VARCHAR(255)) as FIRMA_PATH"}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dsHistAvail ? dsHistJoin : ''}
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
        `;
  const sqlParams = [startInt, endInt, ...repartidorIdList];
  if (search) {
    const cleanSearch = `%${String(search).toUpperCase()}%`;
    sql += ` AND (
                UPPER(CLI.NOMBRECLIENTE) LIKE ? OR 
                UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR
                CAST(CPC.NUMEROALBARAN AS CHAR(20)) LIKE ? OR
                CAST(CAC.NUMEROFACTURA AS CHAR(20)) LIKE ?
            )`;
    sqlParams.push(cleanSearch, cleanSearch, cleanSearch, cleanSearch);
  }
  sql += ` ORDER BY FECHA DESC, CPC.EJERCICIOALBARAN DESC, CPC.NUMEROALBARAN DESC, CPC.SERIEALBARAN DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
  sqlParams.push(offset, limit);
  return (await runQueryWithParams(sql, sqlParams, false)) || [];
}

async function getHistoryClients({ repartidorIdList, search, fetchLimit }) {
  const rows = await chunkedInQuery(
`
            SELECT
                TRIM(UNIQ.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(*) as TOTAL_DOCS,
                COALESCE(SUM(UNIQ.IMPORTETOTAL), 0) as TOTAL_AMOUNT,
                MAX(UNIQ.ANODOCUMENTO * 10000 + UNIQ.MESDOCUMENTO * 100 + UNIQ.DIADOCUMENTO) as LAST_VISIT
            FROM (
                SELECT DISTINCT
                    CPC.CODIGOCLIENTEALBARAN,
                    CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.IMPORTETOTAL,
                    CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO
                FROM DSEDAC.CPC CPC
                INNER JOIN DSEDAC.OPP OPP
                    ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                    AND OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
                    AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
                WHERE @IN_IDS@
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
            ) UNIQ
            LEFT JOIN DSEDAC.CLI CLI
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(UNIQ.CODIGOCLIENTEALBARAN)
            WHERE (CLI.ANOBAJA = 0 OR CLI.ANOBAJA IS NULL)
              @CLIENT_SEARCH@
            GROUP BY TRIM(UNIQ.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
            ORDER BY LAST_VISIT DESC, ID ASC
            FETCH FIRST ? ROWS ONLY
            `,
            'TRIM(OPP.CODIGOREPARTIDOR)',
            repartidorIdList,
            async (sql, params) => {
                // Apply search filter to each chunk query
                const searchFilter = search
                    ? `AND (UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR TRIM(UNIQ.CODIGOCLIENTEALBARAN) LIKE ?)`
                    : '';
                const finalSql = sql.replace('@CLIENT_SEARCH@', searchFilter);
                const finalParams = [...params];
                if (search) {
                    const cleanSearch = `%${search.toUpperCase()}%`;
                    finalParams.push(cleanSearch, cleanSearch, cleanSearch);
                }
                finalParams.push(fetchLimit);
                const cacheKey = `repartidor:clients:${repartidorIdList.join(',')}:${search || ''}:${fetchLimit}`;
                return runCached(finalSql, cacheKey, TTL.REALTIME, finalParams);
            },
            20
        );
        
  return rows;
}

async function getAlbaranPdfHeader(parsedNumber, serie, parsedYear, parsedTerminal) {
  return runQueryWithParams(`
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN, CAC.TERMINALALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBRUTO,
                CAC.IMPORTEBASEIMPONIBLE1,
                CAC.PORCENTAJEIVA1,
                CAC.IMPORTEIVA1,
                CAC.IMPORTEBASEIMPONIBLE2,
                CAC.PORCENTAJEIVA2,
                CAC.IMPORTEIVA2,
                CAC.IMPORTEBASEIMPONIBLE3,
                CAC.PORCENTAJEIVA3,
                CAC.IMPORTEIVA3,
                CAC.IMPORTEBASEIMPONIBLE4,
                CAC.PORCENTAJEIVA4,
                CAC.IMPORTEIVA4,
                CAC.IMPORTEBASEIMPONIBLE5,
                CAC.PORCENTAJEIVA5,
                CAC.IMPORTEIVA5,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROALBARAN = ?
              AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
              AND CAC.EJERCICIOALBARAN = ?
              AND CAC.TERMINALALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear, parsedTerminal], false);
}

async function getCpcIvaBreakdown(year, serie, terminal, number) {
  return runQueryWithParams(`
                SELECT 
                    IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1_PCT, IMPORTEIVA1 as IVA1_IMP,
                    IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2_PCT, IMPORTEIVA2 as IVA2_IMP,
                    IMPORTEBASEIMPONIBLE3 as BI3, PORCENTAJEIVA3 as IVA3_PCT, IMPORTEIVA3 as IVA3_IMP,
                    IMPORTETOTAL
                FROM DSEDAC.CPC
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [year, (serie || '').trim(), terminal, number], false);
}

async function getAlbaranLines(parsedYear, serie, parsedTerminal, parsedNumber) {
  return (await runQueryWithParams(`
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO,
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                LAC.CANTIDADENVASES as CAJASARTICULO,
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                TRIM(LAC.CODIGOIVA) as CODIGOIVA,
                0 as PORCENTAJERECARGOARTICULO,
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO,
                TRIM(COALESCE(LAC.UNIDADMEDIDA, '')) as UNIDADMEDIDA
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = ?
              AND TRIM(LAC.SERIEALBARAN) = ?
              AND LAC.TERMINALALBARAN = ?
              AND LAC.NUMEROALBARAN = ?
            ORDER BY LAC.SECUENCIA
        `, [parsedYear, serie, parsedTerminal, parsedNumber], false)) || [];
}

async function getInvoiceHeaderByFactura(parsedNumber, serie, parsedYear) {
  return runQueryWithParams(`
            SELECT ${INVOICE_HEADER_COLS}
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA = ?
              AND (? = '' OR TRIM(CAC.SERIEFACTURA) = ?)
              AND CAC.EJERCICIOFACTURA = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear], false);
}

async function getInvoiceHeaderByAlbaran(parsedAlbaranNumber, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal) {
  return runQueryWithParams(`
                SELECT ${INVOICE_HEADER_COLS}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                  AND CAC.TERMINALALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedAlbaranNumber, albaranSerieNorm, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal], false);
}

async function getInvoiceHeaderByAlbaranNoTerminal(parsedNumber, serie, parsedYear) {
  return runQueryWithParams(`
                SELECT ${INVOICE_HEADER_COLS}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedNumber, serie, serie, parsedYear], false);
}

module.exports = {
  resolveAlbaranOwners,
  resolveInvoiceOwners,
  resolveDeliveryOwners,
  getCollectionsSummary,
  getCollectionsDaily,
  getClientDocuments,
  overlayCanonicalConfirmations,
  getCanonicalConfirmationSignature,
  getObjectives,
  getObjectivesDetailClients,
  getObjectivesDetailLaclae,
  getFiFilterCatalog,
  getDeliveryStatusFirmaPath,
  getRepartidorFirmasByAlbaran,
  getCacFirmasDetailed,
  getDebugCacSignatures,
  getEntregaFirma,
  getLegacySignatureBase64,
  getRepartidorFirmaBase64ByAlbaran,
  getCacFirmaBase64,
  getDeliverySummary,
  getRuteroWeek,
  getHistoryDeliveries,
  getHistoryClients,
  getAlbaranPdfHeader,
  getCpcIvaBreakdown,
  getAlbaranLines,
  getInvoiceHeaderByFactura,
  getInvoiceHeaderByAlbaran,
  getInvoiceHeaderByAlbaranNoTerminal,
  assertReadOnlySql,
  runQueryWithParams,
  runCached,
  runQuery,
};
