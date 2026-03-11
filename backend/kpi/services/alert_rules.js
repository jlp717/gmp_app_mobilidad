// alert_rules.js: Reglas de generación de alertas por cada tipo de CSV Glacius
// IMPORTANTE: Los CSVs vienen PRE-FILTRADOS por Glacius/Froneri.
// "Es obligatorio incorporar TODOS los avisos al sistema" (doc. Glacius)
// → NO aplicar filtros propios: cada fila del CSV genera una alerta.
'use strict';

const { parseNumber, getColumnValue } = require('./csv_parser');
const logger = require('../../middleware/logger');

/**
 * @typedef {Object} Alert
 * @property {string} clientCode - CodigoInterno del cliente
 * @property {string} alertType - Tipo de alerta
 * @property {string} severity - critical | warning | info
 * @property {string} message - Mensaje formateado
 * @property {object} rawData - Datos brutos de la fila
 * @property {string} sourceFile - Nombre del CSV origen
 */

// ============================================================
// 1. Desviacion_Ventas.csv
// Columnas: H=CodigoInterno, O=Cuo,Anual Helados, R=Desviación €, S=Desviación %
// Mensaje: "Desviado en Ventas: -751.92€ / 52%"
// Severity: critical si desviación > 1000€, warning si > 500€, info resto
// ============================================================
function processDesviacionVentas(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Cod.Interno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacionEur = parseNumber(getColumnValue(row, headers, 'R', ['Desviación €', 'Desviacion €', 'Desviacion EUR']));
      const desviacionPct = parseNumber(getColumnValue(row, headers, 'S', ['Desviación %', 'Desviacion %']));
      const cuotaAnual = parseNumber(getColumnValue(row, headers, 'O', ['Cuo.Anual', 'Cuo,Anual', 'Cuota Anual', 'CuoAnual']));

      // Formatear mensaje según doc: "Desviado en Ventas: 500€ / 52%"
      const eurFormatted = desviacionEur !== null ? desviacionEur.toFixed(2) : '0.00';
      const pctFormatted = desviacionPct !== null ? Math.round(Math.abs(desviacionPct)) : 0;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'DESVIACION_VENTAS',
        severity: desviacionEur !== null && Math.abs(desviacionEur) > 1000 ? 'critical'
                : desviacionEur !== null && Math.abs(desviacionEur) > 500 ? 'warning' : 'info',
        message: `Desviado en Ventas: ${eurFormatted}€ / ${pctFormatted}%`,
        rawData: { cuotaAnual, desviacionEur, desviacionPct, ...extractCommonFields(row, headers) },
        sourceFile: 'Desviacion_Ventas.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila Desviacion_Ventas: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 2. Clientes_ConCuotaSinCompra.csv
// Columnas: F=CodigoInterno, G=Canal, H=Cuota Anual
// Mensaje: "Con cuota sin compra."
// El CSV ya contiene SOLO clientes con cuota sin compra.
// ============================================================
function processCuotaSinCompra(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'F', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const cuotaAnual = parseNumber(getColumnValue(row, headers, 'H', ['Cuota Anual']));

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'CUOTA_SIN_COMPRA',
        severity: cuotaAnual !== null && cuotaAnual > 1000 ? 'warning' : 'info',
        message: 'Con cuota sin compra.',
        rawData: { cuotaAnual, canal: getColumnValue(row, headers, 'G', ['Canal']), ...extractCommonFields(row, headers) },
        sourceFile: 'Clientes_ConCuotaSinCompra.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila CuotaSinCompra: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 3. Desviacion_Referenciacion.csv
// Columnas: H=CodigoInterno, Q=Desviación, S/T/U=Refs sin compra
// Mensaje: "Desviado en referencias: 6 menos"
// + opcionalmente lista de refs sugeridas
// ============================================================
function processDesviacionReferenciacion(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacion = parseNumber(getColumnValue(row, headers, 'Q', ['Desviación', 'Desviacion']));

      const ref1 = getColumnValue(row, headers, 'S', ['Ref.SinCompra 1', 'SinCompra 1']);
      const ref2 = getColumnValue(row, headers, 'T', ['Ref.SinCompra 2', 'SinCompra 2']);
      const ref3 = getColumnValue(row, headers, 'U', ['Ref.SinCompra 3', 'SinCompra 3']);

      let message = desviacion !== null
        ? `Desviado en referencias: ${Math.abs(desviacion)} menos`
        : 'Desviado en referencias';
      const refs = [ref1, ref2, ref3].filter((r) => r && r.trim().length > 0);
      if (refs.length > 0) {
        message += '\n' + refs.map((r) => `- ${r.trim()}`).join('\n');
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'DESVIACION_REFERENCIACION',
        severity: desviacion !== null && Math.abs(desviacion) >= 5 ? 'warning' : 'info',
        message,
        rawData: { desviacion, refs, ...extractCommonFields(row, headers) },
        sourceFile: 'Desviacion_Referenciacion.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila DesviacionReferenciacion: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 4. Mensaje_Promociones.csv
// Columnas: H=Cod.Interno, O=Msg.Marketing
// Mensaje: texto directo de columna O (ej: "Potencial Promo Mochila")
// ============================================================
function processPromociones(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['Cod.Interno', 'CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const msgMarketing = getColumnValue(row, headers, 'O', ['Msg.Marketing', 'MsgMarketing', 'Marketing']);
      if (!msgMarketing || msgMarketing.trim().length === 0) continue;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'PROMOCION',
        severity: 'info',
        message: msgMarketing.trim(),
        rawData: extractCommonFields(row, headers),
        sourceFile: 'Mensaje_Promociones.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila Promociones: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 5. Altas_Clientes.csv (Seguimiento Clientes Nuevos)
// Columnas: H=CodigoInterno, R=Desviación €, S=Desviación %
// Mensaje: "Evolución Captación: -358.67€ / 39%"
// ============================================================
function processAltasClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Cod.Interno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacionEur = parseNumber(getColumnValue(row, headers, 'R', ['Desviación €', 'Desviacion €']));
      const desviacionPct = parseNumber(getColumnValue(row, headers, 'S', ['Desviación %', 'Desviacion %']));

      const eurFormatted = desviacionEur !== null ? desviacionEur.toFixed(2) : '0.00';
      const pctFormatted = desviacionPct !== null ? Math.round(Math.abs(desviacionPct)) : 0;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'ALTA_CLIENTE',
        severity: desviacionEur !== null && desviacionEur < -500 ? 'critical'
                : desviacionEur !== null && desviacionEur < 0 ? 'warning' : 'info',
        message: `Evolución Captación: ${eurFormatted}€ / ${pctFormatted}%`,
        rawData: { desviacionEur, desviacionPct, ...extractCommonFields(row, headers) },
        sourceFile: 'Altas_Clientes.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila AltasClientes: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 6. Mensajes_Clientes.csv (Avisos)
// Columnas: H=CodigoInterno, N=AVISO (confirmado en Excel, PDF decía O)
// Mensaje: texto directo del aviso (ej: "Con Vitrina Sin Compra")
// ============================================================
function processMensajesClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      // AVISO está en columna N (confirmado en Excel). Fallback a O por si el CSV varía.
      let aviso = getColumnValue(row, headers, 'N', ['AVISO', 'Aviso']);
      if (!aviso || aviso.trim().length === 0) {
        aviso = getColumnValue(row, headers, 'O', ['AVISO', 'Aviso']);
      }
      if (!aviso || aviso.trim().length === 0) continue;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'AVISO',
        severity: 'info',
        message: aviso.trim(),
        rawData: extractCommonFields(row, headers),
        sourceFile: 'Mensajes_Clientes.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila MensajesClientes: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 7. Medios_Clientes.csv
// Columnas: G=Cód.Interno (ojo: con tilde), N=Total Medios
// Mensaje: "Cliente con 4 medios"
// NOTA: Estructura diferente — no tiene columna Periodo al inicio
// ============================================================
function processMediosClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      // En Medios, Cod.Interno está en G (no H). Header real: "Cód.Interno" (con tilde)
      const clientCode = getColumnValue(row, headers, 'G', ['Cd.Interno', 'Cod.Interno', 'CodigoInterno', 'Interno']);
      if (!clientCode) continue;

      const totalMedios = parseNumber(getColumnValue(row, headers, 'N', ['Total Medios']));
      if (totalMedios === null || totalMedios <= 0) continue;

      const armarios = parseNumber(getColumnValue(row, headers, 'O', ['Armarios']));
      const conservadoras = parseNumber(getColumnValue(row, headers, 'P', ['Conservadoras']));
      const vitrinas = parseNumber(getColumnValue(row, headers, 'Q', ['Vitrinas']));
      const otros = parseNumber(getColumnValue(row, headers, 'R', ['Otros']));

      // Build detailed message
      const details = [];
      if (armarios && armarios > 0) details.push(`${armarios} armario${armarios > 1 ? 's' : ''}`);
      if (conservadoras && conservadoras > 0) details.push(`${conservadoras} conservadora${conservadoras > 1 ? 's' : ''}`);
      if (vitrinas && vitrinas > 0) details.push(`${vitrinas} vitrina${vitrinas > 1 ? 's' : ''}`);
      if (otros && otros > 0) details.push(`${otros} otro${otros > 1 ? 's' : ''}`);

      let message = `Cliente con ${Math.round(totalMedios)} medios`;
      if (details.length > 0) {
        message += ` (${details.join(', ')})`;
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'MEDIOS_CLIENTE',
        severity: 'info',
        message,
        rawData: {
          totalMedios, armarios, conservadoras, vitrinas, otros,
          ...extractCommonFields(row, headers),
        },
        sourceFile: 'Medios_Clientes.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila MediosClientes: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// Mapa de procesadores por nombre de archivo
// ============================================================
const PROCESSORS = {
  'Desviacion_Ventas.csv':           processDesviacionVentas,
  'Clientes_ConCuotaSinCompra.csv':  processCuotaSinCompra,
  'Desviacion_Referenciacion.csv':   processDesviacionReferenciacion,
  'Mensaje_Promociones.csv':         processPromociones,
  'Altas_Clientes.csv':              processAltasClientes,
  'Mensajes_Clientes.csv':           processMensajesClientes,
  'Medios_Clientes.csv':             processMediosClientes,
};

/**
 * Extrae campos comunes para rawData (nombre comercial, agrupación, etc.)
 */
function extractCommonFields(row, headers) {
  return {
    nombreComercial: getColumnValue(row, headers, 'G', ['Nombre Comercial']) ||
                     getColumnValue(row, headers, 'F', ['Nombre Comercial']),
    agrupacion: getColumnValue(row, headers, 'K', ['Agrupación', 'Agrupacion']),
    tipoEstablecimiento: getColumnValue(row, headers, 'L', ['Tipo Establecimiento']),
  };
}

module.exports = {
  PROCESSORS,
  processDesviacionVentas,
  processCuotaSinCompra,
  processDesviacionReferenciacion,
  processPromociones,
  processAltasClientes,
  processMensajesClientes,
  processMediosClientes,
};
