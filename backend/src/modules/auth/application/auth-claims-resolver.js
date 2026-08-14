'use strict';

const AUTH_CLAIMS_VERSION = 3;
const COMERCIAL = 'COMERCIAL';
const ADMIN = 'ADMIN';
const JEFE_VENTAS = 'JEFE_VENTAS';
const REPARTIDOR = 'REPARTIDOR';
const ALMACEN = 'ALMACEN';

class AuthClaimsError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AuthClaimsError';
    this.code = code;
    this.status = status;
  }
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function freezeList(values) {
  return Object.freeze([...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeCode)
      .filter(Boolean),
  )]);
}

function subjectInvalid() {
  return new AuthClaimsError('Sujeto de autenticacion invalido', 'AUTH_SUBJECT_INVALID', 401);
}

function profileUnavailable() {
  return new AuthClaimsError('Perfil de autorizaci\u00f3n no disponible', 'AUTH_PROFILE_UNAVAILABLE', 503);
}

function createAuthClaimsResolver({ authRepository } = {}) {
  if (!authRepository
    || typeof authRepository.findByCode !== 'function'
    || typeof authRepository.findRepartidorAssociation !== 'function'
    || typeof authRepository.getVendorVisibilityScope !== 'function') {
    throw new TypeError('authRepository must implement the complete auth claims profile contract');
  }

  return Object.freeze({
    async resolve({ code, selectedRole, selectedMode } = {}) {
      const requestedCode = normalizeCode(code);
      if (!requestedCode) throw subjectInvalid();

      let profile;
      try {
        profile = await authRepository.findByCode(requestedCode);
      } catch (_error) {
        throw profileUnavailable();
      }
      if (!profile || profile.isActive !== true) throw subjectInvalid();

      const canonicalCode = normalizeCode(profile.code);
      if (!canonicalCode) throw subjectInvalid();
      const normalizedTipoVendedor = normalizeCode(profile.tipoVendedor);

      let repartoAssociation;
      try {
        repartoAssociation = await authRepository.findRepartidorAssociation(canonicalCode);
      } catch (_error) {
        throw profileUnavailable();
      }

      // COMERCIAL comes from the authenticated VDC/VDD profile. ADMIN comes from
      // its normalized type, JEFE from VDDX, and REPARTIDOR from the DB association.
      const hasAdminRole = normalizedTipoVendedor === ADMIN;
      const hasManagerRole = profile.isJefeVentas === true;
      const hasDriverRole = repartoAssociation?.isRepartidor === true
        && normalizeCode(repartoAssociation.codigoConductor) === canonicalCode;
      const supervisionRole = hasAdminRole ? ADMIN : (hasManagerRole ? JEFE_VENTAS : null);
      const availableRoles = [COMERCIAL];
      if (hasAdminRole) availableRoles.push(ADMIN);
      if (hasManagerRole) availableRoles.push(JEFE_VENTAS);
      if (hasDriverRole && !hasAdminRole) availableRoles.push(REPARTIDOR);

      // ALMACEN and REPARTIDOR UI modes are supervision surfaces, not a change
      // of the underlying ADMIN or JEFE_VENTAS authorization role.
      const availableModes = [COMERCIAL];
      if (supervisionRole) {
        availableModes.push(ALMACEN, REPARTIDOR);
      } else if (hasDriverRole) {
        availableModes.push(REPARTIDOR);
      }

      const defaultRole = supervisionRole || COMERCIAL;
      const requestedMode = normalizeCode(selectedMode);
      const warehouseMode = requestedMode === ALMACEN
        || (!requestedMode && normalizeCode(selectedRole) === ALMACEN);
      const repartoSupervisionMode = supervisionRole && (hasAdminRole || !hasDriverRole) && (
        requestedMode === REPARTIDOR
        || (!requestedMode && normalizeCode(selectedRole) === REPARTIDOR)
      );
      const requestedRole = (warehouseMode || repartoSupervisionMode) ? supervisionRole : selectedRole;
      const role = requestedRole === undefined || requestedRole === null || requestedRole === ''
        ? defaultRole
        : normalizeCode(requestedRole);
      if (!availableRoles.includes(role)) {
        throw new AuthClaimsError('Rol no asociado al sujeto', 'ROLE_NOT_ASSOCIATED', 403);
      }

      const activeMode = requestedMode
        || (warehouseMode ? ALMACEN : null)
        || (repartoSupervisionMode ? REPARTIDOR : null)
        || ([ADMIN, JEFE_VENTAS].includes(role) ? COMERCIAL : role);
      const modeMatchesRole = (activeMode === ALMACEN && role === supervisionRole)
        || (activeMode === COMERCIAL && [COMERCIAL, ADMIN, JEFE_VENTAS].includes(role))
        // ADMIN supervision takes precedence; JEFE supervision requires no driver association.
        || (activeMode === REPARTIDOR && role === supervisionRole && repartoSupervisionMode)
        || (activeMode === REPARTIDOR && role === REPARTIDOR && hasDriverRole);
      if (!availableModes.includes(activeMode) || !modeMatchesRole) {
        throw new AuthClaimsError('Modo no asociado al sujeto', 'ROLE_NOT_ASSOCIATED', 403);
      }

      let vendorCodes;
      try {
        vendorCodes = role === REPARTIDOR
          ? freezeList([canonicalCode])
          : freezeList(await authRepository.getVendorVisibilityScope(canonicalCode, {
            role: role === ADMIN ? JEFE_VENTAS : role,
          }));
      } catch (_error) {
        throw profileUnavailable();
      }
      if (vendorCodes.length === 0) throw profileUnavailable();

      const projectedDriver = role === REPARTIDOR;
      const claims = {
        id: `V${canonicalCode}`,
        user: canonicalCode,
        name: String(profile.name || '').trim(),
        role,
        availableRoles: freezeList(availableRoles),
        activeMode,
        availableModes: freezeList(availableModes),
        isJefeVentas: role === JEFE_VENTAS || (role === ADMIN && hasManagerRole),
        isRepartidor: projectedDriver,
        codigoConductor: projectedDriver ? canonicalCode : null,
        matricula: projectedDriver
          ? String(repartoAssociation.matricula || '').trim() || null
          : null,
        vendorCodes,
        vendedorCodes: freezeList(vendorCodes),
        tipoVendedor: String(profile.tipoVendedor || '-').trim() || '-',
        showCommissions: profile.showCommissions !== false,
        claimsVersion: AUTH_CLAIMS_VERSION,
      };
      return Object.freeze(claims);
    },
  });
}

module.exports = {
  AUTH_CLAIMS_VERSION,
  AuthClaimsError,
  createAuthClaimsResolver,
};
