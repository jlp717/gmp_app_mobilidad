'use strict';

const {
  comercialErpTable,
  comercialErpLiveTable,
  comercialErpSnapshotTable,
  isIsolatedCommercialTest,
} = require('../utils/comercial-erp-tables');

describe('comercial ERP table mapping', () => {
  const previous = {};
  const keys = ['REPARTO_TABLE_SET', 'COMERCIAL_ERP_READ_TEST', 'REPARTO_ENVIRONMENT', 'NODE_ENV'];

  beforeEach(() => {
    for (const key of keys) previous[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  test('production stays on DSEDAC / DSED.LACLAE', () => {
    process.env.REPARTO_TABLE_SET = 'production';
    expect(isIsolatedCommercialTest()).toBe(false);
    expect(comercialErpTable('CVC')).toBe('DSEDAC.CVC');
    expect(comercialErpTable('FPG')).toBe('DSEDAC.FPG');
    expect(comercialErpTable('LACLAE')).toBe('DSED.LACLAE');
    expect(comercialErpTable('LQD')).toBe('DSEDAC.LQD');
    expect(comercialErpTable('CLP')).toBe('DSEDAC.CLP');
    expect(comercialErpTable('LINDTO')).toBe('DSEDAC.LINDTO');
    expect(comercialErpTable('CDVI')).toBe('DSEDAC.CDVI');
  });

  test('isolated_test operational reads stay on live DSEDAC/DSED', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    delete process.env.COMERCIAL_ERP_READ_TEST;
    expect(comercialErpTable('CVC')).toBe('DSEDAC.CVC');
    expect(comercialErpTable('FPG')).toBe('DSEDAC.FPG');
    expect(comercialErpTable('CAC')).toBe('DSEDAC.CAC');
    expect(comercialErpTable('CPC')).toBe('DSEDAC.CPC');
    expect(comercialErpTable('LQD')).toBe('DSEDAC.LQD');
    expect(comercialErpTable('CLX')).toBe('DSEDAC.CLX');
    expect(comercialErpTable('VDDX')).toBe('DSEDAC.VDDX');
    expect(comercialErpTable('LACLAE')).toBe('DSED.LACLAE');
    expect(comercialErpTable('PMR')).toBe('DSEDAC.PMR');
    expect(comercialErpTable('ART')).toBe('DSEDAC.ART');
    expect(comercialErpTable('CLI')).toBe('DSEDAC.CLI');
    expect(comercialErpTable('ARA')).toBe('DSEDAC.ARA');
    expect(comercialErpTable('LAC')).toBe('DSEDAC.LAC');
    expect(comercialErpTable('LPC')).toBe('DSEDAC.LPC');
    expect(comercialErpTable('CFC')).toBe('DSEDAC.CFC');
    expect(comercialErpTable('OPP')).toBe('DSEDAC.OPP');
    expect(comercialErpTable('CLP')).toBe('DSEDAC.CLP');
    expect(comercialErpTable('LINDTO')).toBe('DSEDAC.LINDTO');
    expect(comercialErpTable('CDVI')).toBe('DSEDAC.CDVI');
    expect(comercialErpTable('VDD')).toBe('DSEDAC.VDD');
    expect(comercialErpTable('PES')).toBe('DSEDAC.PES');
    expect(comercialErpLiveTable('LACLAE')).toBe('DSED.LACLAE');
    expect(comercialErpSnapshotTable('LACLAE')).toBe('JAVIER.TEST_LACLAE');
    expect(comercialErpSnapshotTable('LAC')).toBe('JAVIER.TEST_LAC');
    const fs = require('fs');
    const path = require('path');
    const facturas = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturas/infrastructure/db2-facturas-repository.js'),
      'utf8',
    );
    expect(facturas).toMatch(/comercialErpTable\('CAC'\)/);
    expect(facturas).toMatch(/comercialErpTable\('CLI'\)/);
    expect(facturas).toMatch(/comercialErpTable\('LAC'\)/);
    const planner = fs.readFileSync(path.join(__dirname, '../routes/planner.js'), 'utf8');
    expect(planner).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(planner).toMatch(/comercialErpTable\('CLI'\)/);
    expect(planner).toMatch(/comercialErpTable\('CPC'\)/);
    expect(planner).not.toMatch(/FROM DSED\.LACLAE/);
    expect(planner).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(planner).not.toMatch(/FROM DSEDAC\.CPC/);
    const facturasService = fs.readFileSync(path.join(__dirname, '../services/facturas.service.js'), 'utf8');
    expect(facturasService).toMatch(/comercialErpTable\('LAC'\)/);
    expect(facturasService).toMatch(/comercialErpTable\('CAC'\)/);
    expect(facturasService).toMatch(/comercialErpTable\('CFC'\)/);
    expect(facturasService).toMatch(/comercialErpTable\('CLI'\)/);
    expect(facturasService).not.toMatch(/FROM DSEDAC\.LAC /);
    expect(facturasService).not.toMatch(/FROM DSEDAC\.CAC /);
    expect(facturasService).not.toMatch(/FROM DSEDAC\.CFC/);
    const dashboardService = fs.readFileSync(path.join(__dirname, '../src/services/dashboard.service.js'), 'utf8');
    expect(dashboardService).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(dashboardService).not.toMatch(/FROM DSED\.LACLAE/);
    const analytics = fs.readFileSync(path.join(__dirname, '../routes/analytics.js'), 'utf8');
    expect(analytics).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(analytics).not.toMatch(/FROM DSED\.LACLAE/);
    const commissionsPdf = fs.readFileSync(path.join(__dirname, '../services/commissions-pdf.service.js'), 'utf8');
    expect(commissionsPdf).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(commissionsPdf).not.toMatch(/FROM DSED\.LACLAE/);
    const chatbotTools = fs.readFileSync(path.join(__dirname, '../src/chatbot/chatbot_tools.js'), 'utf8');
    expect(chatbotTools).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(chatbotTools).not.toMatch(/FROM DSED\.LACLAE/);
    expect(chatbotTools).not.toMatch(/FROM DSEDAC\.CFC/);
    const ruteroWeek = fs.readFileSync(path.join(__dirname, '../src/repositories/rutero.repository.js'), 'utf8');
    expect(ruteroWeek).toMatch(/comercialErpTable\('OPP'\)/);
    expect(ruteroWeek).toMatch(/comercialErpTable\('CPC'\)/);
    expect(ruteroWeek).not.toMatch(/FROM DSEDAC\.OPP/);
    expect(ruteroWeek).not.toMatch(/FROM DSEDAC\.CPC/);
    const ruteroRepo = fs.readFileSync(
      path.join(__dirname, '../src/modules/rutero/infrastructure/db2-rutero-repository.js'),
      'utf8',
    );
    expect(ruteroRepo).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(ruteroRepo).toMatch(/comercialErpTable\('CLI'\)/);
    expect(ruteroRepo).not.toMatch(/FROM DSED\.LACLAE/);
    const objectives = fs.readFileSync(path.join(__dirname, '../routes/objectives.js'), 'utf8');
    expect(objectives).toMatch(/comercialErpTable\('CLI'\)/);
    expect(objectives).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(objectives).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
    const dddAdapters = fs.readFileSync(path.join(__dirname, '../src/shared/routes/ddd-adapters.js'), 'utf8');
    expect(dddAdapters).toMatch(/comercialErpTable\('CLI'\)/);
    expect(dddAdapters).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(dddAdapters).not.toMatch(/SELECT 1 FROM DSEDAC\.CLI/);
    const clientRepo = fs.readFileSync(
      path.join(__dirname, '../src/modules/clients/infrastructure/db2-client-repository.js'),
      'utf8',
    );
    expect(clientRepo).toMatch(/comercialErpTable\('CLI'\)/);
    expect(clientRepo).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(clientRepo).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(clientRepo).not.toMatch(/FROM DSED\.LACLAE/);
    const kpiRoutes = fs.readFileSync(path.join(__dirname, '../kpi/routes.js'), 'utf8');
    expect(kpiRoutes).toMatch(/comercialErpTable\('CLI'\)/);
    expect(kpiRoutes).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(kpiRoutes).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(kpiRoutes).not.toMatch(/FROM DSED\.LACLAE/);
    const cobrosRepo = fs.readFileSync(
      path.join(__dirname, '../src/modules/cobros/infrastructure/db2-cobros-repository.js'),
      'utf8',
    );
    expect(cobrosRepo).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(cobrosRepo).not.toMatch(/FROM DSED\.LACLAE/);
    const cobrosRoutes = fs.readFileSync(path.join(__dirname, '../routes/cobros.js'), 'utf8');
    expect(cobrosRoutes).toMatch(/comercialErpTable\('CLI'\)/);
    expect(cobrosRoutes).not.toMatch(/FROM DSEDAC\.CLI/);
    const kpiAlerts = fs.readFileSync(
      path.join(__dirname, '../src/modules/kpi-alerts/infrastructure/db2-kpi-alert-repository.js'),
      'utf8',
    );
    expect(kpiAlerts).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(kpiAlerts).not.toMatch(/FROM DSED\.LACLAE/);
    const pedidosRoutes = fs.readFileSync(path.join(__dirname, '../routes/pedidos.js'), 'utf8');
    expect(pedidosRoutes).toMatch(/comercialErpTable\('CLI'\)/);
    expect(pedidosRoutes).toMatch(/comercialErpTable\('LACLAE'\)/);
    expect(pedidosRoutes).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(pedidosRoutes).not.toMatch(/FROM DSED\.LACLAE/);
    const pedidosIndex = fs.readFileSync(path.join(__dirname, '../services/pedidos/index.js'), 'utf8');
    expect(pedidosIndex).toMatch(/comercialErpTable\('CLI'\)/);
    expect(pedidosIndex).toMatch(/comercialErpTable\('CLP'\)/);
    expect(pedidosIndex).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(pedidosIndex).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
    expect(pedidosIndex).not.toMatch(/FROM DSEDAC\.CLP/);
    expect(pedidosIndex).toMatch(/FROM \$\{comercialErpTable\('ARO'\)\} ARO/);
    expect(pedidosIndex).toMatch(/JOIN \$\{comercialErpTable\('ALM'\)\} ALM ON/);
    expect(pedidosIndex).not.toMatch(/JOIN \$\{comercialErpTable\('ALM'\)\} ON ARO\./);
    const commonJs = fs.readFileSync(path.join(__dirname, '../utils/common.js'), 'utf8');
    expect(commonJs).toMatch(/comercialErpTable\('CLP'\)/);
    expect(commonJs).not.toMatch(/FROM DSEDAC\.CLP/);
    expect(clientRepo).toMatch(/comercialErpTable\('CLP'\)/);
    expect(clientRepo).not.toMatch(/FROM DSEDAC\.CLP/);
    expect(kpiRoutes).toMatch(/comercialErpTable\('CLP'\)/);
    expect(kpiRoutes).not.toMatch(/FROM DSEDAC\.CLP/);
    expect(cobrosRepo).toMatch(/comercialErpTable\('CLP'\)/);
    expect(cobrosRepo).not.toMatch(/FROM DSEDAC\.CLP/);
    const evolution = fs.readFileSync(path.join(__dirname, '../services/evolution.service.js'), 'utf8');
    expect(evolution).toMatch(/comercialErpTable\('ART'\)/);
    expect(evolution).toMatch(/comercialErpTable\('CLI'\)/);
    expect(evolution).not.toMatch(/LEFT JOIN DSEDAC\.ART/);
    expect(evolution).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
    expect(commissionsPdf).toMatch(/comercialErpTable\('VDD'\)/);
    expect(commissionsPdf).not.toMatch(/LEFT JOIN DSEDAC\.VDD/);
    const staffEmail = fs.readFileSync(path.join(__dirname, '../services/staff-email-directory-service.js'), 'utf8');
    expect(staffEmail).toMatch(/comercialErpTable\('VDDX'\)/);
    expect(staffEmail).toMatch(/comercialErpTable\('VDD'\)/);
    expect(staffEmail).toMatch(/comercialErpTable\('CLX'\)/);
    expect(staffEmail).toMatch(/comercialErpTable\('CPC'\)/);
    expect(staffEmail).not.toMatch(/FROM DSEDAC\.VDDX/);
    expect(staffEmail).not.toMatch(/FROM DSEDAC\.CLX/);
    expect(staffEmail).not.toMatch(/INNER JOIN DSEDAC\.CPC/);
    const commissionRepo = fs.readFileSync(
      path.join(__dirname, '../src/modules/commissions/infrastructure/db2-commission-repository.js'),
      'utf8',
    );
    expect(commissionRepo).toMatch(/comercialErpTable\('LAC'\)/);
    expect(commissionRepo).toMatch(/comercialErpTable\('CLI'\)/);
    expect(commissionRepo).not.toMatch(/FROM DSEDAC\.LAC/);
    expect(commissionRepo).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
  });

  test('COMERCIAL_ERP_READ_TEST=true opts into JAVIER.TEST_* snapshot reads', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    process.env.COMERCIAL_ERP_READ_TEST = 'true';
    expect(comercialErpTable('CVC')).toBe('JAVIER.TEST_CVC');
    expect(comercialErpTable('LACLAE')).toBe('JAVIER.TEST_LACLAE');
    expect(comercialErpTable('LAC')).toBe('JAVIER.TEST_LAC');
    expect(comercialErpTable('CFC')).toBe('JAVIER.TEST_CFC');
  });

  test('COMERCIAL_ERP_READ_TEST=false stays on live DSEDAC SELECT', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    process.env.COMERCIAL_ERP_READ_TEST = 'false';
    expect(comercialErpTable('CVC')).toBe('DSEDAC.CVC');
    expect(comercialErpTable('LACLAE')).toBe('DSED.LACLAE');
  });
});
