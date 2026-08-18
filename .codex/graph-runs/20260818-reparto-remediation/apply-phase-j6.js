const fs = require('fs');

function transform(file, replacements) {
  let value = fs.readFileSync(file, 'utf8');
  for (const [before, after, expected = 1] of replacements) {
    const count = value.split(before).length - 1;
    if (count !== expected) throw new Error(`${file}: expected ${expected} matches, found ${count}`);
    value = value.split(before).join(after);
  }
  fs.writeFileSync(file, value);
}

transform('backend/routes/repartidor-finanzas.js', [[
  "const isPrivileged = user.role === 'ADMIN' || user.role === 'JEFE_VENTAS' || user.isJefeVentas === true;",
  'const isPrivileged = hasFinanceListRole(user);',
]]);
transform('backend/repositories/repartidor-route-db2-repository.js', [[
  '            FROM ${table} \n',
  '            FROM ${table}\n',
]]);
transform('backend/src/chatbot/chatbot_authorization.js', [[
  '  return Boolean(userContext.isJefeVentas);',
  '  return false;',
]]);

const financeMarker = "  test('liquidacion close guards ownership and derived client totals before the canonical service', async () => {";
const financeTest = `  test('reverse cobro never trusts an inconsistent jefe boolean or a jefe outside reparto mode', async () => {
    const spy = jest.spyOn(financeService, 'reverseCobro').mockResolvedValue({ reversed: true });
    const command = { idempotencyToken: 'reverse-gap-0002', repartidorId: '95', reason: 'Duplicado' };

    mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', isJefeVentas: true };
    let response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    mockAuthUser = { id: '7', code: '7', role: 'JEFE_VENTAS' };
    response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    mockAuthUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      repartidorId: '95', allowAcrossRepartidores: true,
    }));
  });

`;
transform('backend/__tests__/repartidor-finanzas-http-gap-coverage.test.js', [[financeMarker, financeTest + financeMarker]]);

const chatbotMarker = "  test('rejects direct clientCode when client owner has not been resolved', () => {";
const chatbotTest = `  test('does not elevate a missing role from an isolated isJefeVentas boolean', () => {
    const authorizeChatbotClientScope = loadAuthorizeChatbotClientScope();
    const result = authorizeChatbotClientScope(
      { userCode: '80', isJefeVentas: true },
      { clientCode: 'C-AJENO', vendorCode: '03' }
    );
    expect(result).toMatchObject({ allowed: false, code: 'FORBIDDEN_CLIENT_SCOPE' });
  });

`;
transform('backend/__tests__/chatbot_authorization.test.js', [[chatbotMarker, chatbotTest + chatbotMarker]]);
