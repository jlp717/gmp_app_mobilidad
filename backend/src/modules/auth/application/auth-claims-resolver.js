'use strict';

const AUTH_CLAIMS_VERSION = 4;
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

function codesMatch(left, right) {
  const leftCode = normalizeCode(left);
  const rightCode = normalizeCode(right);
  if (leftCode === rightCode) return true;
  if (!/^\d+$/.test(leftCode) || !/^\d+$/.test(rightCode)) return false;
  return (leftCode.replace(/^0+/, '') || '0') === (rightCode.replace(/^0+/, '') || '0');
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

      // ERP mobility flags (DSEDAC.VDDX): Preventista, Jefe de ventas, Repartidor.
      const hasCommercialRole = profile.permitePreventa === true;
      const hasManagerRole = profile.isJefeVentas === true;
      const hasDriverRole = profile.permiteReparto === true;
      const hasAdminRole = normalizedTipoVendedor === ADMIN;
      const supervisionRole = hasAdminRole ? ADMIN : (hasManagerRole ? JEFE_VENTAS : null);

      const availableRoles = [];
      if (hasCommercialRole) availableRoles.push(COMERCIAL);
      if (hasAdminRole) availableRoles.push(ADMIN);
      if (hasManagerRole) availableRoles.push(JEFE_VENTAS);
      if (hasDriverRole && !supervisionRole) availableRoles.push(REPARTIDOR);
      if (availableRoles.length === 0) availableRoles.push(COMERCIAL);

      const availableModes = [COMERCIAL];
      if (supervisionRole) {
        availableModes.push(ALMACEN, REPARTIDOR);
      } else if (hasDriverRole) {
        availableModes.push(REPARTIDOR);
      }

      const defaultRole = supervisionRole
        || (hasDriverRole && !hasCommercialRole ? REPARTIDOR : null)
        || (hasCommercialRole ? COMERCIAL : null)
        || (hasDriverRole ? REPARTIDOR : COMERCIAL);
      const requestedMode = normalizeCode(selectedMode);
      const warehouseMode = requestedMode === ALMACEN
        || (!requestedMode && normalizeCode(selectedRole) === ALMACEN);
      const repartoSupervisionMode = Boolean(supervisionRole) && (
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

      let repartidorCodes = freezeList([]);
      const repartoProfile = activeMode === REPARTIDOR
        && [REPARTIDOR, JEFE_VENTAS, ADMIN].includes(role);
      if (repartoProfile) {
        if (typeof authRepository.listRepartidorFleet !== 'function') throw profileUnavailable();
        let fleet;
        try {
          fleet = await authRepository.listRepartidorFleet();
        } catch (_error) {
          throw profileUnavailable();
        }
        const fleetCodes = freezeList((Array.isArray(fleet) ? fleet : [])
          .map((entry) => entry?.code ?? entry?.CODE));
        if (fleetCodes.length === 0) throw profileUnavailable();
        if (role === REPARTIDOR) {
          const verifiedSelf = fleetCodes.find((entry) => codesMatch(entry, canonicalCode));
          if (!verifiedSelf) throw profileUnavailable();
          repartidorCodes = freezeList([verifiedSelf]);
        } else {
          repartidorCodes = fleetCodes;
        }
      }

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
          ? String(profile.matricula || '').trim() || null
          : null,
        vendorCodes,
        vendedorCodes: freezeList(vendorCodes),
        repartidorCodes,
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
