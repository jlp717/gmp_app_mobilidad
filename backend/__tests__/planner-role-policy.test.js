'use strict';

const {
  PlannerRoleError,
  resolvePlannerRole,
} = require('../src/modules/planner/domain/planner-role-policy');

describe('planner role policy', () => {
  test('rejects a preventista forcing the repartidor scope', () => {
    expect(() => resolvePlannerRole({
      role: 'COMERCIAL',
      code: '02',
      isJefeVentas: false,
      repartidorCodes: [],
    }, 'repartidor')).toThrow(expect.objectContaining({
      code: 'INSUFFICIENT_ROLE',
      statusCode: 403,
    }));
  });

  test('allows a jefe to request reparto only inside signed fleet claims', () => {
    expect(resolvePlannerRole({
      role: 'JEFE_VENTAS',
      code: '98',
      isJefeVentas: true,
      repartidorCodes: ['44', '45'],
    }, 'repartidor')).toEqual({
      role: 'repartidor',
      privileged: true,
      repartidorCodes: ['44', '45'],
    });
  });

  test('derives the regular repartidor scope from the master role', () => {
    expect(resolvePlannerRole({
      role: 'REPARTIDOR',
      code: '44',
    })).toMatchObject({
      role: 'repartidor',
      repartidorCodes: ['44'],
    });
  });

  test('rejects an unknown requested planner role', () => {
    expect(() => resolvePlannerRole({ role: 'COMERCIAL', code: '01' }, 'preventista'))
      .toThrow(PlannerRoleError);
  });
});
