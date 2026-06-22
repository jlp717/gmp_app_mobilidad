/**
 * Expected RBAC contract for chatbot client-code usage.
 *
 * RED test for Node-Express-Specialist:
 * implement backend/src/chatbot/chatbot_authorization.js exporting
 * authorizeChatbotClientScope(userContext, clientContext).
 */

'use strict';

function loadAuthorizeChatbotClientScope() {
  try {
    return require('../src/chatbot/chatbot_authorization').authorizeChatbotClientScope;
  } catch (error) {
    throw new Error(
      'Expected backend/src/chatbot/chatbot_authorization.js to export authorizeChatbotClientScope(userContext, clientContext)'
    );
  }
}

describe('chatbot client RBAC policy contract', () => {
  test('exports authorizeChatbotClientScope helper', () => {
    expect(loadAuthorizeChatbotClientScope()).toEqual(expect.any(Function));
  });

  test('rejects COMERCIAL 80 when requested client belongs to another vendor', () => {
    const authorizeChatbotClientScope = loadAuthorizeChatbotClientScope();

    const result = authorizeChatbotClientScope(
      { userCode: '80', role: 'COMERCIAL', isJefeVentas: false },
      { clientCode: 'C-AJENO', vendorCode: '03' }
    );

    expect(result).toMatchObject({
      allowed: false,
      code: 'FORBIDDEN_CLIENT_SCOPE',
    });
  });

  test('allows JEFE_VENTAS to query any resolved client', () => {
    const authorizeChatbotClientScope = loadAuthorizeChatbotClientScope();

    const result = authorizeChatbotClientScope(
      { userCode: '01', role: 'JEFE_VENTAS', isJefeVentas: true },
      { clientCode: 'C-OTRO', vendorCode: '03' }
    );

    expect(result).toMatchObject({ allowed: true });
  });

  test('allows GERENTE to query any resolved client', () => {
    const authorizeChatbotClientScope = loadAuthorizeChatbotClientScope();

    const result = authorizeChatbotClientScope(
      { userCode: '01', role: 'GERENTE', isJefeVentas: false },
      { clientCode: 'C-OTRO', vendorCode: '03' }
    );

    expect(result).toMatchObject({ allowed: true });
  });

  test('rejects direct clientCode when client owner has not been resolved', () => {
    const authorizeChatbotClientScope = loadAuthorizeChatbotClientScope();

    const result = authorizeChatbotClientScope(
      { userCode: '80', role: 'COMERCIAL', isJefeVentas: false },
      { clientCode: 'C-SIN-OWNER' }
    );

    expect(result).toMatchObject({
      allowed: false,
      code: 'CLIENT_SCOPE_UNVERIFIED',
    });
  });

  test('resolveChatbotClientOwner uses CLP/LAC/LACLAE columns not LAC.LCCDVD', async () => {
    const { resolveChatbotClientOwner } = require('../src/chatbot/chatbot_authorization');
    let capturedSql = '';
    const conn = {
      query: jest.fn(async (sql) => {
        capturedSql = sql;
        return [{ VENDEDOR: '80' }];
      }),
    };

    const owner = await resolveChatbotClientOwner(conn, 'CLI001');

    expect(owner).toMatchObject({ clientCode: 'CLI001', vendorCode: '80', verified: true });
    expect(capturedSql).toMatch(/CLP\.VENDEDORCOMERCIAL/);
    expect(capturedSql).toMatch(/L\.CODIGOVENDEDOR/);
    expect(capturedSql).toMatch(/DSED\.LACLAE/);
    const lacBlock =
      capturedSql.match(/FROM DSEDAC\.LAC[\s\S]*?(?=UNION ALL|OWNERS)/i)?.[0] || '';
    expect(lacBlock).toMatch(/CODIGOVENDEDOR/);
    expect(lacBlock).not.toMatch(/LCCDVD/);
  });
});
