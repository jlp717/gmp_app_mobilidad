// alert_rules.test.js: Tests de las reglas de generación de alertas por CSV
'use strict';

const path = require('path');
const { parseCSV } = require('../services/csv_parser');
const {
  processDesviacionVentas,
  processCuotaSinCompra,
  processDesviacionReferenciacion,
  processPromociones,
  processAltasClientes,
  processMensajesClientes,
  processMediosClientes,
} = require('../services/alert_rules');

const SAMPLES_DIR = path.join(__dirname, '..', 'csv_samples');

describe('processDesviacionVentas', () => {
  let rows, headers;
  beforeAll(() => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Desviacion_Ventas.csv'), 'Desviacion_Ventas.csv');
    rows = result.rows;
    headers = result.headers;
  });

  test('genera alertas para todas las filas del CSV (sin filtro propio)', () => {
    const alerts = processDesviacionVentas(rows, headers);
    // Glacius pre-filtra: cada fila genera alerta
    expect(alerts.length).toBe(rows.length);

    for (const alert of alerts) {
      expect(alert.alertType).toBe('DESVIACION_VENTAS');
      expect(alert.sourceFile).toBe('Desviacion_Ventas.csv');
      expect(alert.clientCode).toBeTruthy();
      expect(alert.message).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
    }
  });

  test('mensajes negativos incluyen texto pedagogico con EUR', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const negativos = alerts.filter(a => a.rawData.desviacionEur < 0);
    for (const alert of negativos) {
      expect(alert.message).toMatch(/Nestle:.*vendiendo.*EUR.*menos.*objetivo/i);
    }
  });

  test('genera alerta critical para desviación > 1000EUR', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const critical = alerts.find(a => a.clientCode === '11305'); // -3802.02
    expect(critical).toBeDefined();
    expect(critical.severity).toBe('critical');
  });

  test('incluye contexto con objetivo anual y vendido actual', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const withCtx = alerts.filter(a => a.rawData.cuotaAnual !== null && a.rawData.vtaActual !== null);
    for (const alert of withCtx) {
      expect(alert.message).toMatch(/Objetivo anual:.*EUR/);
      expect(alert.message).toMatch(/Vendido actual:.*EUR/);
    }
  });
});

describe('processCuotaSinCompra', () => {
  test('genera alertas para todas las filas con mensaje pedagogico', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Clientes_ConCuotaSinCompra.csv'), 'Clientes_ConCuotaSinCompra.csv');
    const alerts = processCuotaSinCompra(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('CUOTA_SIN_COMPRA');
      expect(alert.message).toMatch(/NO HA HECHO NI UN SOLO PEDIDO/);
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
    }
  });

  test('severity critical para cuota > 2000EUR', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Clientes_ConCuotaSinCompra.csv'), 'Clientes_ConCuotaSinCompra.csv');
    const alerts = processCuotaSinCompra(result.rows, result.headers);
    const criticals = alerts.filter(a => a.severity === 'critical');
    for (const c of criticals) {
      expect(c.rawData.cuotaAnual).toBeGreaterThan(2000);
    }
  });
});

describe('processDesviacionReferenciacion', () => {
  test('genera alertas con lista de productos faltantes', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Desviacion_Referenciacion.csv'), 'Desviacion_Referenciacion.csv');
    const alerts = processDesviacionReferenciacion(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('DESVIACION_REFERENCIACION');
      expect(alert.message).toMatch(/Nestle:/);
      // Alertas con refs deben incluir lista de productos sugeridos
      if (alert.rawData.refs && alert.rawData.refs.length > 0) {
        expect(alert.message).toMatch(/👉/);
      }
    }
  });
});

describe('processPromociones', () => {
  test('genera alertas con mensaje de promocion Nestle', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Mensaje_Promociones.csv'), 'Mensaje_Promociones.csv');
    const alerts = processPromociones(result.rows, result.headers);

    expect(alerts.length).toBe(5);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('PROMOCION');
      expect(alert.severity).toBe('info');
      expect(alert.message).toMatch(/Nestle nos indica.*promoción/i);
      expect(alert.message).toMatch(/👉/);
    }
  });
});

describe('processAltasClientes', () => {
  test('genera alertas de seguimiento de clientes nuevos', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Altas_Clientes.csv'), 'Altas_Clientes.csv');
    const alerts = processAltasClientes(result.rows, result.headers);

    expect(alerts.length).toBe(5);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('ALTA_CLIENTE');
      expect(alert.message).toMatch(/Cliente nuevo Nestle:/);
      expect(alert.message).toMatch(/EUR/);
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
    }
  });
});

describe('processMensajesClientes', () => {
  test('genera alertas con texto de avisos operativos Nestle', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Mensajes_Clientes.csv'), 'Mensajes_Clientes.csv');
    const alerts = processMensajesClientes(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThanOrEqual(5);
    expect(alerts[0].message).toMatch(/incidencia operativa/i);
    expect(alerts[0].message).toMatch(/👉/);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('AVISO');
      expect(alert.severity).toBe('info');
    }
  });
});

describe('processMediosClientes', () => {
  test('genera alertas con detalle de equipamiento frio', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Medios_Clientes.csv'), 'Medios_Clientes.csv');
    const alerts = processMediosClientes(result.rows, result.headers);

    expect(alerts.length).toBe(8);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('MEDIOS_CLIENTE');
      expect(alert.severity).toBe('info');
      expect(alert.message).toMatch(/equipamiento.*Nestle/i);
      expect(alert.rawData.totalMedios).toBeGreaterThan(0);
    }
    // Verificar que tiene desglose con iconos
    const withArmarios = alerts.find(a => a.rawData.armarios > 0);
    if (withArmarios) {
      expect(withArmarios.message).toMatch(/❄️/);
    }
  });
});
