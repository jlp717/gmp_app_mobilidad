/**
 * REPARTIDOR SERVICE - Refactored from legacy repartidor.js (2200 lines)
 *
 * Handles repartidor-specific functionality:
 *   - Collections (cobros) summary with 30% threshold commission
 *   - Daily collection accumulation
 *   - Document history with deduplication & status logic
 *   - Historical objectives (30% threshold tracking)
 *   - Delivery summary by day
 *
 * POST endpoints (entregas, firma, cobros) remain in entregas.service.ts.
 * PDF generation remains in pdfService.js.
 *
 * SECURITY: All queries use parameterized placeholders (?).
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toFloat, toInt, toStr } from '../utils/db-helpers';
import { sanitizeCode, sanitizeSearch, buildInClause } from '../utils/validators';
import { queryCache, TTL } from '../utils/query-cache';

// ============================================
// CONSTANTS
// ============================================

const REPARTIDOR_CONFIG = {
  threshold: 30.0,
  tiers: [
    { min: 100.01, max: 103.00, pct: 1.0 },
    { min: 103.01, max: 106.00, pct: 1.3 },
    { min: 106.01, max: 110.00, pct: 1.6 },
    { min: 110.01, max: 999.99, pct: 2.0 },
  ],
};

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateCollectionCommission(collectable: number, collected: number) {
  const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;
  const thresholdMet = percentage >= REPARTIDOR_CONFIG.threshold;

  let commission = 0;
  let tier = 0;
  if (thresholdMet && percentage > 100) {
    const excess = collected - collectable;
    for (let i = 0; i < REPARTIDOR_CONFIG.tiers.length; i++) {
      const t = REPARTIDOR_CONFIG.tiers[i];
      if (percentage >= t.min && percentage <= t.max) {
        commission = excess * (t.pct / 100);
        tier = i + 1;
        break;
      }
    }
  }

  return { percentage, thresholdMet, commission, tier };
}

function mapPaymentType(formaPago: string): string {
  const fp = formaPago.toUpperCase();
  if (fp.includes('CTR') || fp.includes('CONTADO')) return 'Contado';
  if (fp.includes('REP')) return 'Reposición';
  if (fp.includes('MEN')) return 'Mensual';
  return 'Otro';
}

/**
 * Determines delivery status based on cascading priority:
 * App status > Legacy ERP status > Dispatch flag > Pending
 */
function determineDeliveryStatus(row: Record<string, unknown>): string {
  const appStatus = toStr(row.DELIVERY_STATUS).trim().toLowerCase();
  const legacyStatus = toStr(row.SITUACIONALBARAN).trim().toUpperCase();
  const isDispatched = toStr(row.CONFORMADOSN).trim().toUpperCase() === 'S';
  const importe = toFloat(row.IMPORTETOTAL);
  const pendiente = toFloat(row.IMPORTE_PENDIENTE);

  let status = 'pending';

  if (appStatus === 'delivered') {
    status = 'delivered';
  } else if (appStatus === 'no_delivered' || appStatus === 'absent') {
    status = 'no_delivered';
  } else if (legacyStatus === 'F' || legacyStatus === 'R') {
    status = 'delivered';
  } else if (isDispatched) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const docDate = new Date(toInt(row.ANO), toInt(row.MES) - 1, toInt(row.DIA));
    status = docDate < today ? 'delivered' : 'en_ruta';
  }

  // Partial payment overrides
  if (pendiente > 0 && pendiente < importe) status = 'partial';

  return status;
}

// ============================================
// SERVICE CLASS
// ============================================

class RepartidorService {

  /**
   * GET /collections/summary/:repartidorId
   * Collection summary per client with 30% threshold commission.
   */
  async getCollectionsSummary(params: {
    repartidorIds: string; year?: number; month?: number;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const selectedYear = params.year || now.getFullYear();
    const selectedMonth = params.month || (now.getMonth() + 1);

    if (!params.repartidorIds || !params.repartidorIds.trim()) {
      return {
        success: true, repartidorId: '',
        period: { year: selectedYear, month: selectedMonth },
        summary: { totalCollectable: 0, totalCollected: 0, totalCommission: 0, overallPercentage: 0, thresholdMet: false, clientCount: 0 },
        clients: [],
      };
    }

    const ids = params.repartidorIds.split(',').map(id => sanitizeCode(id.trim()));
    const { clause: idsClause, params: idsParams } = buildInClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);

    let rows: Record<string, unknown>[];
    try {
      rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT
          TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
          TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
          CPC.CODIGOFORMAPAGO AS FORMA_PAGO,
          SUM(CPC.IMPORTETOTAL) AS TOTAL_COBRABLE,
          SUM(CASE
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 THEN CPC.IMPORTETOTAL
            ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
          END) AS TOTAL_COBRADO,
          COUNT(*) AS NUM_DOCUMENTOS
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
        LEFT JOIN DSEDAC.CVC CVC
          ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
          AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
        WHERE OPP.MESREPARTO = ?
          AND OPP.ANOREPARTO = ?
          AND ${idsClause}
        GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN),
          TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')),
          CPC.CODIGOFORMAPAGO
        ORDER BY TOTAL_COBRABLE DESC
        FETCH FIRST 100 ROWS ONLY
      `, [selectedMonth, selectedYear, ...idsParams]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[REPARTIDOR] Collections summary query error: ${msg}`);
      return {
        success: true, repartidorId: params.repartidorIds,
        period: { year: selectedYear, month: selectedMonth },
        summary: { totalCollectable: 0, totalCollected: 0, totalCommission: 0, overallPercentage: 0, thresholdMet: false, clientCount: 0 },
        clients: [], warning: 'No hay datos disponibles para este período',
      };
    }

    const clients = rows.map(row => {
      const collectable = toFloat(row.TOTAL_COBRABLE);
      const collected = toFloat(row.TOTAL_COBRADO);
      const { percentage, thresholdMet, commission, tier } = calculateCollectionCommission(collectable, collected);

      return {
        clientId: toStr(row.CLIENTE),
        clientName: toStr(row.NOMBRE_CLIENTE) || toStr(row.CLIENTE),
        collectable, collected,
        percentage: parseFloat(percentage.toFixed(2)),
        thresholdMet,
        thresholdProgress: Math.min(percentage / REPARTIDOR_CONFIG.threshold, 1),
        commission: parseFloat(commission.toFixed(2)),
        tier,
        paymentType: mapPaymentType(toStr(row.FORMA_PAGO)),
        numDocuments: toInt(row.NUM_DOCUMENTOS),
      };
    });

    const totalCollectable = clients.reduce((sum, c) => sum + c.collectable, 0);
    const totalCollected = clients.reduce((sum, c) => sum + c.collected, 0);
    const totalCommission = clients.reduce((sum, c) => sum + c.commission, 0);
    const overallPercentage = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

    return {
      success: true,
      repartidorId: params.repartidorIds,
      period: { year: selectedYear, month: selectedMonth },
      summary: {
        totalCollectable: parseFloat(totalCollectable.toFixed(2)),
        totalCollected: parseFloat(totalCollected.toFixed(2)),
        totalCommission: parseFloat(totalCommission.toFixed(2)),
        overallPercentage: parseFloat(overallPercentage.toFixed(2)),
        thresholdMet: overallPercentage >= REPARTIDOR_CONFIG.threshold,
        clientCount: clients.length,
      },
      clients,
    };
  }

  /**
   * GET /collections/daily/:repartidorId
   * Daily collection accumulation for a month.
   */
  async getCollectionsDaily(params: {
    repartidorId: string; year?: number; month?: number;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const selectedYear = params.year || now.getFullYear();
    const selectedMonth = params.month || (now.getMonth() + 1);
    const safeId = sanitizeCode(params.repartidorId);

    let rows: Record<string, unknown>[];
    try {
      rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT
          OPP.DIAREPARTO AS DIA,
          SUM(CPC.IMPORTETOTAL) AS TOTAL_COBRABLE,
          SUM(CASE
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 THEN CPC.IMPORTETOTAL
            ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
          END) AS TOTAL_COBRADO
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        LEFT JOIN DSEDAC.CVC CVC
          ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
          AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
        WHERE OPP.ANOREPARTO = ?
          AND OPP.MESREPARTO = ?
          AND TRIM(OPP.CODIGOREPARTIDOR) = ?
        GROUP BY OPP.DIAREPARTO
        ORDER BY OPP.DIAREPARTO
      `, [selectedYear, selectedMonth, safeId]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[REPARTIDOR] Collections daily query error: ${msg}`);
      return { success: true, daily: [] };
    }

    const daily = rows.map(row => ({
      day: toInt(row.DIA),
      date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(toInt(row.DIA)).padStart(2, '0')}`,
      collectable: toFloat(row.TOTAL_COBRABLE),
      collected: toFloat(row.TOTAL_COBRADO),
    }));

    return { success: true, daily };
  }

  /**
   * GET /history/documents/:clientId
   * Client document history with deduplication and status cascade.
   */
  async getDocumentHistory(params: {
    clientId: string; repartidorId?: string;
    year?: number; dateFrom?: string; dateTo?: string;
    limit?: number; offset?: number;
  }): Promise<Record<string, unknown>> {
    const safeClientId = sanitizeCode(params.clientId);
    const conditions: string[] = ['CPC.CODIGOCLIENTEALBARAN = ?'];
    const queryParams: unknown[] = [safeClientId];

    // Optional repartidor join
    let repartidorJoin = '';
    if (params.repartidorId) {
      const ids = params.repartidorId.split(',').map(id => sanitizeCode(id.trim()));
      const { clause, params: idParams } = buildInClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      repartidorJoin = `
        INNER JOIN DSEDAC.OPP OPP
          ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
          AND ${clause}`;
      queryParams.push(...idParams);
    }

    // Year filter
    if (params.year) {
      conditions.push('CPC.EJERCICIOALBARAN = ?');
      queryParams.push(params.year);
    }

    // Date range filters
    if (params.dateFrom) {
      const parts = params.dateFrom.split('-');
      if (parts.length === 3) {
        const numFrom = parseInt(parts[0]) * 10000 + parseInt(parts[1]) * 100 + parseInt(parts[2]);
        conditions.push('(CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ?');
        queryParams.push(numFrom);
      }
    }
    if (params.dateTo) {
      const parts = params.dateTo.split('-');
      if (parts.length === 3) {
        const numTo = parseInt(parts[0]) * 10000 + parseInt(parts[1]) * 100 + parseInt(parts[2]);
        conditions.push('(CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ?');
        queryParams.push(numTo);
      }
    }

    const whereClause = conditions.join(' AND ');

    // Check if DELIVERY_STATUS table is available
    let dsAvailable = false;
    try {
      const { isDeliveryStatusAvailable } = require('../../utils/delivery-status-check');
      dsAvailable = isDeliveryStatusAvailable();
    } catch { dsAvailable = false; }

    const dsJoin = dsAvailable
      ? `LEFT JOIN JAVIER.DELIVERY_STATUS DS ON
          DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))`
      : '';
    const dsStatusCol = dsAvailable ? 'DS.STATUS AS DELIVERY_STATUS' : "CAST(NULL AS VARCHAR(20)) AS DELIVERY_STATUS";
    const dsFirmaCol = dsAvailable ? 'DS.FIRMA_PATH' : "CAST(NULL AS VARCHAR(255)) AS FIRMA_PATH";
    const dsObsCol = dsAvailable ? 'DS.OBSERVACIONES' : "CAST(NULL AS VARCHAR(512)) AS OBSERVACIONES";

    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT
        CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
        CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
        CPC.ANODOCUMENTO AS ANO, CPC.MESDOCUMENTO AS MES, CPC.DIADOCUMENTO AS DIA,
        CPC.CODIGOCLIENTEALBARAN, CPC.IMPORTETOTAL,
        COALESCE((
          SELECT SUM(CV.IMPORTEPENDIENTE) FROM DSEDAC.CVC CV
          WHERE CV.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
            AND CV.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
            AND CV.SERIEDOCUMENTO = CPC.SERIEALBARAN
            AND CV.NUMERODOCUMENTO = CPC.NUMEROALBARAN
        ), 0) AS IMPORTE_PENDIENTE,
        CPC.CONFORMADOSN, CPC.SITUACIONALBARAN, CPC.HORALLEGADA,
        ${dsStatusCol}, ${dsFirmaCol}, ${dsObsCol},
        COALESCE((SELECT CAC2.NUMEROFACTURA FROM DSEDAC.CAC CAC2
          WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
            AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
          FETCH FIRST 1 ROW ONLY), 0) AS NUMEROFACTURA,
        COALESCE((SELECT TRIM(CAC2.SERIEFACTURA) FROM DSEDAC.CAC CAC2
          WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
            AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
          FETCH FIRST 1 ROW ONLY), '') AS SERIEFACTURA,
        COALESCE((SELECT CAC2.EJERCICIOFACTURA FROM DSEDAC.CAC CAC2
          WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
            AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
          FETCH FIRST 1 ROW ONLY), 0) AS EJERCICIOFACTURA,
        COALESCE((SELECT FIRMANOMBRE FROM DSEDAC.CACFIRMAS
          WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND TRIM(SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
            AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
          FETCH FIRST 1 ROW ONLY), '') AS LEGACY_FIRMA_NOMBRE,
        (SELECT ANO FROM DSEDAC.CACFIRMAS
          WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND TRIM(SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
            AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
          FETCH FIRST 1 ROW ONLY) AS LEGACY_ANO
      FROM DSEDAC.CPC CPC
      ${repartidorJoin}
      ${dsJoin}
      WHERE ${whereClause}
      ORDER BY CPC.EJERCICIOALBARAN DESC, CPC.ANODOCUMENTO DESC,
        CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC, CPC.NUMEROALBARAN DESC
    `, queryParams);

    // Deduplication: group by unique albaran OR factura key
    const uniqueMap = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const serie = toStr(row.SERIEALBARAN).trim();
      const numFactura = toInt(row.NUMEROFACTURA);
      const key = numFactura > 0
        ? `FAC-${row.EJERCICIOALBARAN}-${(toStr(row.SERIEFACTURA) || serie).trim()}-${numFactura}`
        : `ALB-${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, row);
      } else if (numFactura > 0) {
        const existing = uniqueMap.get(key)!;
        if (toInt(row.NUMEROALBARAN) > toInt(existing.NUMEROALBARAN)) {
          uniqueMap.set(key, row);
        }
      }
    }

    const documents = Array.from(uniqueMap.values()).map(row => {
      const importe = toFloat(row.IMPORTETOTAL);
      const pendiente = toFloat(row.IMPORTE_PENDIENTE);
      const status = determineDeliveryStatus(row);
      const numFactura = toInt(row.NUMEROFACTURA);
      const isFactura = numFactura > 0;
      const serie = toStr(row.SERIEALBARAN).trim() || 'A';
      const legacyNombre = toStr(row.LEGACY_FIRMA_NOMBRE).trim();
      const hasLegacySig = legacyNombre.length > 0 || toInt(row.LEGACY_ANO) > 0;
      const hasFirmaPath = !!row.FIRMA_PATH;

      // Format time
      const hora = toInt(row.HORALLEGADA);
      let time: string | null = null;
      if (hora > 0) {
        const hStr = hora.toString().padStart(6, '0');
        time = `${hStr.substring(0, 2)}:${hStr.substring(2, 4)}`;
      }

      return {
        id: `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
        type: isFactura ? 'factura' : 'albaran',
        number: isFactura ? numFactura : toInt(row.NUMEROALBARAN),
        albaranNumber: toInt(row.NUMEROALBARAN),
        facturaNumber: numFactura || null,
        serieFactura: toStr(row.SERIEFACTURA).trim() || null,
        ejercicioFactura: toInt(row.EJERCICIOFACTURA) || null,
        serie, ejercicio: toInt(row.EJERCICIOALBARAN), terminal: toInt(row.TERMINALALBARAN),
        date: `${toInt(row.ANO)}-${String(toInt(row.MES)).padStart(2, '0')}-${String(toInt(row.DIA)).padStart(2, '0')}`,
        time, amount: importe, pending: pendiente, status,
        hasSignature: hasFirmaPath || hasLegacySig,
        signaturePath: toStr(row.FIRMA_PATH) || null,
        deliveryObs: toStr(row.OBSERVACIONES) || null,
        hasLegacySignature: hasLegacySig,
        legacySignatureName: legacyNombre || null,
      };
    });

    return { success: true, clientId: safeClientId, total: documents.length, documents };
  }

  /**
   * GET /history/objectives/:repartidorId
   * Historical monthly 30% threshold tracking.
   */
  async getHistoricalObjectives(params: {
    repartidorIds: string; clientId?: string;
  }): Promise<Record<string, unknown>> {
    const ids = params.repartidorIds.split(',').map(id => sanitizeCode(id.trim()));
    const { clause: idsClause, params: idsParams } = buildInClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);

    const conditions = [idsClause];
    const queryParams = [...idsParams];

    if (params.clientId) {
      conditions.push('TRIM(CPC.CODIGOCLIENTEALBARAN) = ?');
      queryParams.push(sanitizeCode(params.clientId));
    }

    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT
        OPP.ANOREPARTO AS ANO,
        OPP.MESREPARTO AS MES,
        SUM(CPC.IMPORTETOTAL) AS TOTAL_COBRABLE,
        SUM(CASE
          WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 THEN CPC.IMPORTETOTAL
          ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
        END) AS TOTAL_COBRADO
      FROM DSEDAC.OPP OPP
      INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      LEFT JOIN DSEDAC.CVC CVC
        ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
        AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
      WHERE ${conditions.join(' AND ')}
      GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
      ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
    `, queryParams);

    const objectives = rows.map(row => {
      const collectable = toFloat(row.TOTAL_COBRABLE);
      const collected = toFloat(row.TOTAL_COBRADO);
      const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;
      const mes = toInt(row.MES);

      return {
        month: `${MONTH_NAMES[mes - 1] || ''} ${toInt(row.ANO)}`,
        year: toInt(row.ANO),
        monthNum: mes,
        collectable, collected,
        percentage: parseFloat(percentage.toFixed(2)),
        thresholdMet: percentage >= REPARTIDOR_CONFIG.threshold,
      };
    });

    return { success: true, objectives };
  }

  /**
   * GET /config
   * Returns repartidor commission configuration.
   */
  getConfig(): Record<string, unknown> {
    return {
      success: true,
      config: REPARTIDOR_CONFIG,
    };
  }
}

export const repartidorService = new RepartidorService();
