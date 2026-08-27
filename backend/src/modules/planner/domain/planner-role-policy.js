'use strict';

class PlannerRoleError extends Error {
  constructor(message, { code = 'INSUFFICIENT_ROLE', statusCode = 403 } = {}) {
    super(message);
    this.name = 'PlannerRoleError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (!role) return '';
  if (role === 'repartidor' || role === 'comercial') return role;
  throw new PlannerRoleError('Rol de rutero no valido', {
    code: 'INVALID_PLANNER_ROLE',
    statusCode: 400,
  });
}

function normalizeCode(value) {
  return String(value || '').trim();
}

function plannerRepartidorCodes(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  const own = normalizeCode(user?.code || user?.codigovendedor);
  const claimed = Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : [];
  const values = role === 'REPARTIDOR' ? [own, ...claimed] : claimed;
  return [...new Set(values.map(normalizeCode).filter(Boolean))];
}

function resolvePlannerRole(user = {}, requestedRole) {
  const masterRole = String(user.role || '').trim().toUpperCase();
  const privileged = user.isJefeVentas === true || ['JEFE_VENTAS', 'ADMIN'].includes(masterRole);
  const requested = normalizeRole(requestedRole);
  const role = requested || (masterRole === 'REPARTIDOR' ? 'repartidor' : 'comercial');
  const repartidorCodes = plannerRepartidorCodes(user);

  if (role === 'repartidor') {
    if ((masterRole !== 'REPARTIDOR' && !privileged) || repartidorCodes.length === 0) {
      throw new PlannerRoleError('El usuario no tiene permiso maestro de reparto');
    }
  }
  if (role === 'comercial' && masterRole === 'REPARTIDOR' && !privileged) {
    throw new PlannerRoleError('Un repartidor no puede consultar el rutero comercial');
  }

  return Object.freeze({ role, privileged, repartidorCodes });
}

module.exports = {
  PlannerRoleError,
  normalizeRole,
  plannerRepartidorCodes,
  resolvePlannerRole,
};
