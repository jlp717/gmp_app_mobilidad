'use strict';

const fs = require('fs');
const path = require('path');

function readFromRepo(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
}

describe('ERP mobility role source contract', () => {
  test('legacy login reads VDDX flags and does not infer roles by identity or activity', () => {
    const source = readFromRepo('routes', 'auth.ts');

    expect(source).toMatch(/X\.PERMITEPREVENTASN/i);
    expect(source).toMatch(/X\.PERMITEREPARTOSN/i);
    expect(source).toMatch(/const isJefeVentas = String\(vendor\.JEFEVENTASSN/i);
    expect(source).toMatch(/const permitePreventa = String\(vendor\.PERMITEPREVENTASN/i);
    expect(source).toMatch(/const isRepartidor = hasRepartidorPermission && !permitePreventa && !isJefeVentas/i);
    expect(source).not.toContain('normalizedLoginCode');
    expect(source).not.toContain('oppCheck');
    expect(source).not.toContain("TRIM(CODIGOCONDUCTOR) <> '98'");
  });

  test('TypeScript role fallback uses VDDX as its only mobility source', () => {
    const source = readFromRepo('src', 'services', 'roles.service.ts');

    expect(source).toMatch(/FROM DSEDAC\.VDDX/i);
    expect(source).toMatch(/PERMITEPREVENTASN/i);
    expect(source).toMatch(/PERMITEREPARTOSN/i);
    expect(source).toMatch(/JEFEVENTASSN/i);
    expect(source).toMatch(/FROM DSEDAC\.VDDX X/i);
    expect(source).toMatch(/X\.PERMITEREPARTOSN/i);
    expect(source).toMatch(/permiteReparto && !permitePreventa/i);
    expect(source).not.toContain('CODIGOS_JEFES');
    expect(source).not.toContain('APP_USERS');
    expect(source).not.toContain('DSEDAC.VEH');
  });

  test('Flutter navigation and scope utilities have no vendor-ID role exception', () => {
    const shell = readFromRepo('..', 'lib', 'features', 'dashboard', 'presentation', 'pages', 'main_shell.dart');
    const scope = readFromRepo('..', 'lib', 'core', 'utils', 'vendor_scope.dart');
    const commissions = readFromRepo('..', 'lib', 'features', 'commissions', 'presentation', 'pages', 'commissions_page.dart');

    expect(shell).not.toMatch(/isCommercial80|normalizedUserCode/);
    expect(scope).not.toMatch(/commercial80|isCommercial80/i);
    expect(shell).toMatch(/final showCommissions = user\?\.showCommissions/);
    expect(scope).toMatch(/hasScopedVendorAccess/);
    expect(commissions).not.toMatch(/normalizedCode\s*==\s*'98'|curCode\s*==\s*'98'|isDiego|specifically DIEGO/i);
    expect(commissions).toMatch(/showCommissions/);
    expect(commissions).toMatch(/isJefeVentas/);
  });
});
