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
    expect(alerts.length).toBe(rows.length);

    for (const alert of alerts) {
      expect(alert.alertType).toBe('DESVIACION_VENTAS');
      expect(alert.sourceFile).toBe('Desviacion_Ventas.csv');
      expect(alert.clientCode).toBeTruthy();
      expect(alert.message).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
    }
  });

  test('mensajes negativos incluyen texto pedagogico con accion sugerida', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const negativos = alerts.filter(a => a.rawData.desviacionEur < 0);
    for (const alert of negativos) {
      expect(alert.message).toMatch(/POR DEBAJO/);
      expect(alert.message).toMatch(/Que hacer:/);
    }
  });

  test('genera alerta critical para desviacion > 1000EUR', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const critical = alerts.find(a => a.clientCode === '11305');
    expect(critical).toBeDefined();
    expect(critical.severity).toBe('critical');
  });

  test('incluye contexto con objetivo anual y comprado hasta hoy', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const withCtx = alerts.filter(a => a.rawData.cuotaAnual !== null && a.rawData.vtaActual !== null);
    for (const alert of withCtx) {
      expect(alert.message).toMatch(/Objetivo anual Nestle:.*EUR/);
      expect(alert.message).toMatch(/Comprado hasta hoy:.*EUR/);
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
      expect(alert.message).toMatch(/NINGUN PEDIDO/);
      expect(alert.message).toMatch(/Que hacer:/);
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
      // Alertas con refs deben incluir lista numerada de productos
      if (alert.rawData.refs && alert.rawData.refs.length > 0) {
        expect(alert.message).toMatch(/\d\./);
      }
    }
  });

  test('incluye accion sugerida', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Desviacion_Referenciacion.csv'), 'Desviacion_Referenciacion.csv');
    const alerts = processDesviacionReferenciacion(result.rows, result.headers);
    for (const alert of alerts) {
      expect(alert.message).toMatch(/Que hacer:/);
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
      expect(alert.message).toMatch(/Nestle:.*candidato.*promocion/i);
      expect(alert.message).toMatch(/Que hacer:/);
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
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
    }
  });
});

describe('processMensajesClientes', () => {
  test('genera alertas con texto de avisos operativos Nestle', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Mensajes_Clientes.csv'), 'Mensajes_Clientes.csv');
    const alerts = processMensajesClientes(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThanOrEqual(5);
    expect(alerts[0].message).toMatch(/Aviso operativo/i);
    expect(alerts[0].message).toMatch(/Que hacer:/);
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
      expect(alert.message).toMatch(/equipo.*frio.*Nestle/i);
      expect(alert.rawData.totalMedios).toBeGreaterThan(0);
    }
    // Verificar que tiene desglose con listado
    const withArmarios = alerts.find(a => a.rawData.armarios > 0);
    if (withArmarios) {
      expect(withArmarios.message).toMatch(/Armario/);
    }
  });

  test('incluye recordatorio de verificacion', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Medios_Clientes.csv'), 'Medios_Clientes.csv');
    const alerts = processMediosClientes(result.rows, result.headers);
    for (const alert of alerts) {
      expect(alert.message).toMatch(/Recordatorio:/);
    }
  });
});
