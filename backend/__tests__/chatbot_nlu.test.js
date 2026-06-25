'use strict';

const {
  analyzeCommercialQuery,
  buildCapabilityText,
  buildClarifyingResponse,
  buildFollowUps,
  normalizeText,
} = require('../src/chatbot/chatbot_nlu');

describe('chatbot commercial NLU', () => {
  test('normalizes accents and common commercial typos', () => {
    const analysis = analyzeCommercialQuery('facutra pdf del clinte central');

    expect(analysis.normalized).toContain('factura');
    expect(analysis.normalized).toContain('cliente');
    expect(analysis.domains.map((domain) => domain.id)).toContain('facturas');
    expect(analysis.domains.map((domain) => domain.id)).toContain('clientes');
  });

  test('detects product intent from incomplete product phrase', () => {
    const analysis = analyzeCommercialQuery('dime el producto de migass');

    expect(analysis.normalized).toContain('migas');
    expect(analysis.topDomain.id).toBe('productos');
    expect(analysis.intents).toContain('product_search');
    expect(analysis.entityHints.productName).toBe('migas');
  });

  test('builds useful catalog and clarification responses', () => {
    const analysis = analyzeCommercialQuery('no se como va esto');

    expect(normalizeText('Márgen Glacius')).toBe('margen glacius');
    expect(buildCapabilityText()).toMatch(/Copiloto GMP/);
    expect(buildClarifyingResponse(analysis)).toMatch(/Prueba asi/i);
    expect(buildFollowUps(analysis).length).toBeGreaterThan(0);
  });
});
