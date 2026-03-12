// alert_rules.js: Reglas de generación de alertas por cada tipo de CSV Glacius/Nestlé
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
 * @property {string} message - Mensaje formateado (legible para comerciales)
 * @property {object} rawData - Datos brutos de la fila
 * @property {string} sourceFile - Nombre del CSV origen
 */

/**
 * Formatea un número con separador de miles y decimales.
 * Ej: 1525.14 → "1.525,14"  /  -751.92 → "-751,92"
 */
function fmtEur(n) {
  if (n === null || n === undefined) return '0';
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${intPart},${parts[1]}`;
}

/**
 * Formatea un número sin decimales con separador de miles.
 */
function fmtInt(n) {
  if (n === null || n === undefined) return '0';
  return Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ============================================================
// 1. Desviacion_Ventas.csv
// Columnas reales: Cuo.Anual Helados, VtaBru.Cum Actual, VtaBru.Cum Anterior,
//                  Desviacion €, Desviacion %, Agrupacion, Tipo Establecimiento
// ============================================================
function processDesviacionVentas(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Cod.Interno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacionEur = parseNumber(getColumnValue(row, headers, 'R', ['Desviación €', 'Desviacion €', 'Desviacion EUR']));
      const desviacionPct = parseNumber(getColumnValue(row, headers, 'S', ['Desviación %', 'Desviacion %']));
      const cuotaAnual = parseNumber(getColumnValue(row, headers, 'O', ['Cuo.Anual', 'Cuo,Anual', 'Cuota Anual', 'CuoAnual', 'Cuo.Anual Helados']));
      const vtaActual = parseNumber(getColumnValue(row, headers, 'P', ['VtaBru.Cum Actual', 'VtaBru.Cum', 'Venta Actual']));
      const vtaAnterior = parseNumber(getColumnValue(row, headers, 'Q', ['VtaBru.Cum Anterior', 'Venta Anterior']));
      const agrupacion = getColumnValue(row, headers, 'K', ['Agrupacion', 'Agrupación']);
      const tipoEstab = getColumnValue(row, headers, 'L', ['Tipo Establecimiento']);
      const ultCompra = getColumnValue(row, headers, 'N', ['Ult.Comp.Helados', 'Ult. Comp']);

      // Calcular porcentaje cumplido real
      const pctCumplido = cuotaAnual && cuotaAnual > 0 && vtaActual !== null
        ? Math.round((vtaActual / cuotaAnual) * 100)
        : (desviacionPct !== null ? Math.round(100 - Math.abs(desviacionPct)) : null);

      let message;
      let severity;

      if (desviacionEur === null || desviacionEur === 0) {
        // Sin datos o desviación cero
        message = 'Nestle: Sin compras registradas en este periodo.';
        severity = 'warning';
      } else if (desviacionEur < 0) {
        // Por debajo del objetivo
        let pctMsg = '';
        if (desviacionPct !== null) {
          pctMsg = ` (un ${Math.abs(desviacionPct)}% MENOS de lo esperado a estas alturas del año)`;
        }
        message = `Nestle: Llevamos vendiendo ${fmtEur(desviacionEur)}EUR menos que el objetivo asignado${pctMsg}.`;
        severity = Math.abs(desviacionEur) > 1000 ? 'critical' : Math.abs(desviacionEur) > 500 ? 'warning' : 'info';
      } else {
        // Por encima del objetivo
        let pctMsg = '';
        if (desviacionPct !== null) {
          pctMsg = ` (un ${Math.abs(desviacionPct)}% por encima de lo esperado)`;
        }
        message = `Nestle: ¡Buena evolución! Ventas +${fmtEur(desviacionEur)}EUR por encima del objetivo${pctMsg}.`;
        severity = 'info';
      }

      // Línea de contexto con cifras
      const contexto = [];
      if (cuotaAnual !== null) contexto.push(`Objetivo anual: ${fmtEur(cuotaAnual)}EUR`);
      if (vtaActual !== null) contexto.push(`Vendido actual: ${fmtEur(vtaActual)}EUR`);
      if (contexto.length > 0) message += '\n' + contexto.join('  |  ');

      // Línea de comparativa con año anterior
      if (vtaAnterior !== null) {
        message += `\nEl año pasado por estas fechas llevaba: ${fmtEur(vtaAnterior)}EUR.`;
      }

      // Última compra
      if (ultCompra && ultCompra.trim()) {
        message += `\nÚltima compra de helados: ${ultCompra.trim()}`;
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'DESVIACION_VENTAS',
        severity,
        message,
        rawData: {
          cuotaAnual, vtaActual, vtaAnterior, desviacionEur, desviacionPct,
          pctCumplido, agrupacion, tipoEstab, ultCompra,
          ...extractCommonFields(row, headers),
        },
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
// Columnas reales: Canal (HELADO/FROZEN FOOD/BEBIBLES), Cuota Anual,
//                  Cuota Mes, Venta Mes, Dif Mes, Cuota Cum, Venta Cum, Dif Cum
// NOTA: Un mismo cliente puede aparecer varias veces (una por canal).
// ============================================================
function processCuotaSinCompra(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'F', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const canal = getColumnValue(row, headers, 'G', ['Canal']) || 'Helados';
      const cuotaAnual = parseNumber(getColumnValue(row, headers, 'H', ['Cuota Anual']));
      const cuotaMes = parseNumber(getColumnValue(row, headers, 'I', ['Cuota Mes']));
      const ventaMes = parseNumber(getColumnValue(row, headers, 'J', ['Venta Mes']));
      const cuotaCum = parseNumber(getColumnValue(row, headers, 'L', ['Cuota Cum']));
      const ventaCum = parseNumber(getColumnValue(row, headers, 'M', ['Venta Cum']));
      const difCum = parseNumber(getColumnValue(row, headers, 'N', ['Dif. Cum', 'Dif Cum']));

      // Canal formateado limpio
      const canalLabel = canal.trim().toUpperCase() === 'HELADO' ? 'Helados' :
        canal.trim().toUpperCase() === 'FROZEN FOOD' ? 'Frozen Food (Congelados)' :
          canal.trim().charAt(0).toUpperCase() + canal.trim().slice(1).toLowerCase();

      let message = `Nestle: Este cliente tiene un objetivo asignado para la familia [${canalLabel}], pero todavía NO HA HECHO NI UN SOLO PEDIDO en todo el año.`;

      // Cuota anual
      if (cuotaAnual !== null) {
        message += `\nSu objetivo anual para ${canalLabel} es de ${fmtEur(cuotaAnual)}EUR.`;
      }

      // Pendiente acumulado
      if (difCum !== null && difCum > 0) {
        message += `\nPara ir bien, a estas alturas ya debería haber pedido al menos ${fmtEur(difCum)}EUR acumulados.`;
      } else if (cuotaCum !== null) {
        message += `\nPara ir bien, a estas alturas ya debería haber pedido al menos ${fmtEur(cuotaCum)}EUR acumulados.`;
      }

      // Severidad basada en cuota
      const severity = cuotaAnual !== null && cuotaAnual > 2000 ? 'critical'
        : cuotaAnual !== null && cuotaAnual > 500 ? 'warning' : 'info';

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'CUOTA_SIN_COMPRA',
        severity,
        message,
        rawData: {
          canal, cuotaAnual, cuotaMes, ventaMes, cuotaCum, ventaCum, difCum,
          ...extractCommonFields(row, headers),
        },
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
// Columnas reales: Ref.Cum Actual, Ref.Cum Anterior, Desviación,
//                  Ref.Tot Anterior, 3x Ref.SinCompra
// ============================================================
function processDesviacionReferenciacion(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacion = parseNumber(getColumnValue(row, headers, 'Q', ['Desviación', 'Desviacion']));
      const refActual = parseNumber(getColumnValue(row, headers, 'O', ['Ref.Cum Actual', 'Ref Actual']));
      const refAnterior = parseNumber(getColumnValue(row, headers, 'P', ['Ref.Cum Anterior', 'Ref Anterior']));
      const refTotAnterior = parseNumber(getColumnValue(row, headers, 'R', ['Ref.Tot Anterior']));

      const ref1 = getColumnValue(row, headers, 'S', ['Ref.SinCompra 1', 'SinCompra 1']);
      const ref2 = getColumnValue(row, headers, 'T', ['Ref.SinCompra 2', 'SinCompra 2']);
      const ref3 = getColumnValue(row, headers, 'U', ['Ref.SinCompra 3', 'SinCompra 3']);

      const refs = [ref1, ref2, ref3].filter((r) => r && r.trim().length > 0);
      const faltantes = desviacion !== null ? Math.abs(desviacion) : 0;
      const esperados = refAnterior || refTotAnterior || 0;
      const actuales = refActual || (esperados - faltantes);

      // Mensaje principal con conteo claro
      let message;
      if (faltantes > 0 && esperados > 0) {
        message = `Nestle: Debería estar comprando ${fmtInt(esperados)} productos distintos, pero solo compra ${fmtInt(actuales)} (Le faltan ${fmtInt(faltantes)} productos vitales).`;
      } else if (faltantes > 0) {
        message = `Nestle: A este cliente le faltan ${fmtInt(faltantes)} productos clave por comprar.`;
      } else {
        message = 'Nestle: Desviación en productos referenciados.';
      }

      // Lista de productos sugeridos
      if (refs.length > 0) {
        message += '\nEl sistema de Nestlé nos sugiere que le ofrezcamos principalmente estos:';
        refs.forEach((r) => {
          message += `\n  👉 ${r.trim()}`;
        });
        // Si faltan más de los 3 que muestra el CSV
        if (faltantes > refs.length) {
          message += `\n  ... (y otros ${faltantes - refs.length} productos más)`;
        }
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'DESVIACION_REFERENCIACION',
        severity: faltantes >= 5 ? 'warning' : 'info',
        message,
        rawData: {
          desviacion, refActual, refAnterior, refTotAnterior, refs,
          ...extractCommonFields(row, headers),
        },
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
// Columnas reales: Msg.Marketing (texto libre)
// ============================================================
function processPromociones(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['Cod.Interno', 'CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      const msgMarketing = getColumnValue(row, headers, 'O', ['Msg.Marketing', 'MsgMarketing', 'Marketing']);
      if (!msgMarketing || msgMarketing.trim().length === 0) continue;

      const message = `Nestle nos indica que este cliente es candidato ideal para la siguiente promoción:\n\n👉 [${msgMarketing.trim()}]\n\n¡Recuerda ofrecérsela en tu próxima visita!`;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'PROMOCION',
        severity: 'info',
        message,
        rawData: {
          promocion: msgMarketing.trim(),
          ...extractCommonFields(row, headers),
        },
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
// Columnas reales: Cuo.Anual, VtaBru.Cum Actual, Cuo.Cum,
//                  Desviación €, Desviación %, Fecha Alta
// ============================================================
function processAltasClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Cod.Interno', 'Codigo Interno']);
      if (!clientCode) continue;

      const desviacionEur = parseNumber(getColumnValue(row, headers, 'R', ['Desviación €', 'Desviacion €']));
      const desviacionPct = parseNumber(getColumnValue(row, headers, 'S', ['Desviación %', 'Desviacion %']));
      const cuotaAnual = parseNumber(getColumnValue(row, headers, 'O', ['Cuo.Anual', 'Cuo.Anual Helados', 'Cuota Anual']));
      const vtaActual = parseNumber(getColumnValue(row, headers, 'P', ['VtaBru.Cum Actual', 'VtaBru.Cum']));
      const cuotaCum = parseNumber(getColumnValue(row, headers, 'Q', ['Cuo.Cum', 'Cuota Cum']));
      const fechaAlta = getColumnValue(row, headers, 'M', ['Fecha Alta']);
      const ultCompra = getColumnValue(row, headers, 'N', ['Ult.Comp.Helados', 'Ult. Comp']);

      // Calcular % cumplido
      const pctCumplido = cuotaAnual && cuotaAnual > 0 && vtaActual !== null
        ? Math.round((vtaActual / cuotaAnual) * 100)
        : (desviacionPct !== null ? Math.round(100 - Math.abs(desviacionPct)) : null);

      let message;
      let severity;

      if (desviacionEur !== null && desviacionEur < 0) {
        message = `Cliente nuevo Nestle: Su arranque es lento, lleva ${fmtEur(desviacionEur)}EUR vendidos POR DEBAJO de su objetivo.`;
        severity = Math.abs(desviacionEur) > 500 ? 'critical' : 'warning';
      } else if (desviacionEur !== null && desviacionEur > 0) {
        message = `Cliente nuevo Nestle: ¡Gran arranque! Lleva +${fmtEur(desviacionEur)}EUR POR ENCIMA de su objetivo.`;
        severity = 'info';
      } else {
        message = 'Cliente nuevo Nestle: Sin datos de evolución todavía.';
        severity = 'info';
      }

      // Contexto
      const contexto = [];
      if (cuotaAnual !== null) contexto.push(`Objetivo anual: ${fmtEur(cuotaAnual)}EUR`);
      if (vtaActual !== null) contexto.push(`Vendido actual: ${fmtEur(vtaActual)}EUR`);
      if (contexto.length > 0) message += '\n' + contexto.join('  |  ');

      // Fecha de alta
      if (fechaAlta && fechaAlta.trim()) {
        message += `\nDado de alta el: ${fechaAlta.trim()}`;
      }
      if (ultCompra && ultCompra.trim()) {
        message += ` | Última compra: ${ultCompra.trim()}`;
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'ALTA_CLIENTE',
        severity,
        message,
        rawData: {
          desviacionEur, desviacionPct, cuotaAnual, vtaActual, cuotaCum,
          pctCumplido, fechaAlta, ultCompra,
          ...extractCommonFields(row, headers),
        },
        sourceFile: 'Altas_Clientes.csv',
      });
    } catch (err) {
      logger.warn(`[kpi:rules] Error procesando fila AltasClientes: ${err.message}`);
    }
  }

  return alerts;
}

// ============================================================
// 6. Mensajes_Clientes.csv (Avisos operativos)
// Columnas reales: AVISO (texto libre tipo "Con Vitrina Sin Compra La Lechera")
// ============================================================
function processMensajesClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'H', ['CodigoInterno', 'Codigo Interno']);
      if (!clientCode) continue;

      let aviso = getColumnValue(row, headers, 'N', ['AVISO', 'Aviso']);
      if (!aviso || aviso.trim().length === 0) {
        aviso = getColumnValue(row, headers, 'O', ['AVISO', 'Aviso']);
      }
      if (!aviso || aviso.trim().length === 0) continue;

      const avisoClean = aviso.trim();
      const message = `Nestle ha detectado una incidencia operativa:\n\n👉 [${avisoClean}]\n\nPor favor, revísalo o soluciónalo en tu próxima visita al cliente.`;

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'AVISO',
        severity: 'info',
        message,
        rawData: {
          aviso: avisoClean,
          ...extractCommonFields(row, headers),
        },
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
// Columnas reales: Total Medios, Armarios, Conservadoras, Vitrinas, Otros,
//                  Tipo Establecimiento, Ult.Comp.Helados
// NOTA: No tiene Periodo — estructura diferente a los demás CSVs
// ============================================================
function processMediosClientes(rows, headers) {
  const alerts = [];

  for (const row of rows) {
    try {
      const clientCode = getColumnValue(row, headers, 'G', ['Cd.Interno', 'Cod.Interno', 'CodigoInterno', 'Interno']);
      if (!clientCode) continue;

      const totalMedios = parseNumber(getColumnValue(row, headers, 'N', ['Total Medios']));
      if (totalMedios === null || totalMedios <= 0) continue;

      const armarios = parseNumber(getColumnValue(row, headers, 'O', ['Armarios']));
      const conservadoras = parseNumber(getColumnValue(row, headers, 'P', ['Conservadoras']));
      const vitrinas = parseNumber(getColumnValue(row, headers, 'Q', ['Vitrinas']));
      const otros = parseNumber(getColumnValue(row, headers, 'R', ['Otros']));
      const tipoEstab = getColumnValue(row, headers, 'K', ['Tipo Establecimiento']);
      const agrupacion = getColumnValue(row, headers, 'J', ['Agrupacion', 'Agrupación']);
      const ultCompra = getColumnValue(row, headers, 'M', ['Ult.Comp.Helados', 'Ult. Comp']);

      // Mensaje principal
      let message = `El cliente dispone del siguiente equipamiento frío cedido por Nestle (${Math.round(totalMedios)} en total):`;

      // Desglose detallado
      const desglose = [];
      if (armarios && armarios > 0) desglose.push(`  ❄️ ${armarios} Armario${armarios > 1 ? 's' : ''} (Congelador vertical acristalado)`);
      if (conservadoras && conservadoras > 0) desglose.push(`  🧊 ${conservadoras} Conservadora${conservadoras > 1 ? 's' : ''} (Arcón horizontal)`);
      if (vitrinas && vitrinas > 0) desglose.push(`  🍨 ${vitrinas} Vitrina${vitrinas > 1 ? 's' : ''} (Expositor abierto)`);
      if (otros && otros > 0) desglose.push(`  🔧 ${otros} Otro${otros > 1 ? 's' : ''} equipo${otros > 1 ? 's' : ''} auxiliar${otros > 1 ? 'es' : ''}`);

      if (desglose.length > 0) {
        message += '\n' + desglose.join('\n');
      }

      // Contexto del punto de venta
      const ctx = [];
      if (agrupacion && agrupacion.trim()) ctx.push(`Segmento: ${agrupacion.trim()}`);
      if (tipoEstab && tipoEstab.trim()) ctx.push(tipoEstab.trim());
      if (ctx.length > 0) {
        message += '\n\nEstablecimiento: ' + ctx.join(' - ');
      }

      alerts.push({
        clientCode: String(clientCode).trim(),
        alertType: 'MEDIOS_CLIENTE',
        severity: 'info',
        message,
        rawData: {
          totalMedios, armarios, conservadoras, vitrinas, otros,
          agrupacion, tipoEstab, ultCompra,
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
  'Desviacion_Ventas.csv': processDesviacionVentas,
  'Clientes_ConCuotaSinCompra.csv': processCuotaSinCompra,
  'Desviacion_Referenciacion.csv': processDesviacionReferenciacion,
  'Mensaje_Promociones.csv': processPromociones,
  'Altas_Clientes.csv': processAltasClientes,
  'Mensajes_Clientes.csv': processMensajesClientes,
  'Medios_Clientes.csv': processMediosClientes,
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
