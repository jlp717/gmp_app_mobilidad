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

  test('genera alertas solo para cuota > 1000 y desviación < -250', () => {
    const alerts = processDesviacionVentas(rows, headers);
    // De los 10 clientes, verificar que filtra correctamente
    expect(alerts.length).toBeGreaterThan(0);

    for (const alert of alerts) {
      expect(alert.alertType).toBe('DESVIACION_VENTAS');
      expect(alert.message).toMatch(/Desviado en Ventas:/);
      expect(alert.message).toMatch(/€/);
      expect(alert.message).toMatch(/%/);
      // Verificar formato: € con 2 decimales
      const eurMatch = alert.message.match(/([-\d.]+)€/);
      expect(eurMatch).toBeTruthy();
      const eurParts = eurMatch[1].split('.');
      expect(eurParts[1]?.length).toBe(2); // 2 decimales
      // Verificar formato: % entero
      const pctMatch = alert.message.match(/(\d+)%/);
      expect(pctMatch).toBeTruthy();
      expect(pctMatch[1]).not.toContain('.');
    }
  });

  test('no genera alerta para cliente 5 (desviación -206.99, < 250)', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const client5 = alerts.find(a => a.clientCode === '1863');
    expect(client5).toBeUndefined();
  });

  test('no genera alerta para cliente 8 (desviación -87.75, < 250)', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const client8 = alerts.find(a => a.clientCode === '9683');
    expect(client8).toBeUndefined();
  });

  test('genera alerta critical para desviación > 1000€', () => {
    const alerts = processDesviacionVentas(rows, headers);
    const critical = alerts.find(a => a.clientCode === '11305'); // -3802.02
    expect(critical).toBeDefined();
    expect(critical.severity).toBe('critical');
  });
});

describe('processCuotaSinCompra', () => {
  test('genera alertas para todos los clientes con cuota > 400', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Clientes_ConCuotaSinCompra.csv'), 'Clientes_ConCuotaSinCompra.csv');
    const alerts = processCuotaSinCompra(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('CUOTA_SIN_COMPRA');
      expect(alert.message).toBe('Con cuota sin compra.');
      expect(alert.severity).toBe('warning');
    }
  });
});

describe('processDesviacionReferenciacion', () => {
  test('genera alertas con lista de referencias', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Desviacion_Referenciacion.csv'), 'Desviacion_Referenciacion.csv');
    const alerts = processDesviacionReferenciacion(result.rows, result.headers);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('DESVIACION_REFERENCIACION');
      expect(alert.message).toMatch(/Desviado en referencias: \d+ menos/);
      // Verificar que incluye lista de refs
      if (alert.rawData.refs && alert.rawData.refs.length > 0) {
        expect(alert.message).toContain('- ');
      }
    }
  });
});

describe('processPromociones', () => {
  test('genera alertas con mensaje directo de Msg.Marketing', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Mensaje_Promociones.csv'), 'Mensaje_Promociones.csv');
    const alerts = processPromociones(result.rows, result.headers);

    expect(alerts.length).toBe(5);
    expect(alerts[0].message).toBe('Potencial Promo Mochila');
    expect(alerts[2].message).toBe('Potencial Promo Despertador 12 + 3');
    for (const alert of alerts) {
      expect(alert.alertType).toBe('PROMOCION');
      expect(alert.severity).toBe('info');
    }
  });
});

describe('processAltasClientes', () => {
  test('genera alertas con formato Evolución Captación', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Altas_Clientes.csv'), 'Altas_Clientes.csv');
    const alerts = processAltasClientes(result.rows, result.headers);

    expect(alerts.length).toBe(5);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('ALTA_CLIENTE');
      expect(alert.message).toMatch(/Evolución Captación:/);
      expect(alert.message).toMatch(/€/);
      expect(alert.message).toMatch(/%/);
    }
  });
});

describe('processMensajesClientes', () => {
  test('genera alertas con texto directo de columna AVISO (N)', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Mensajes_Clientes.csv'), 'Mensajes_Clientes.csv');
    const alerts = processMensajesClientes(result.rows, result.headers);

    expect(alerts.length).toBe(6);
    expect(alerts[0].message).toContain('Vitrina');
    expect(alerts[3].message).toBe('Sin Compra Impulso');
    for (const alert of alerts) {
      expect(alert.alertType).toBe('AVISO');
      expect(alert.severity).toBe('info');
    }
  });
});

describe('processMediosClientes', () => {
  test('genera alertas con total de medios (columna G=Cod.Interno)', () => {
    const result = parseCSV(path.join(SAMPLES_DIR, 'Medios_Clientes.csv'), 'Medios_Clientes.csv');
    const alerts = processMediosClientes(result.rows, result.headers);

    expect(alerts.length).toBe(8);
    expect(alerts[0].message).toMatch(/Cliente con \d+ medios/);
    // Verificar datos de medios en rawData
    expect(alerts[1].rawData.totalMedios).toBe(4);
    for (const alert of alerts) {
      expect(alert.alertType).toBe('MEDIOS_CLIENTE');
      expect(alert.severity).toBe('info');
    }
  });
});
