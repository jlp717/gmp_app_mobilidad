'use strict';

const crypto = require('crypto');
const { AuthClaimsError } = require('./auth-claims-resolver');

function normalizeUsername(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9 ]+$/.test(normalized) ? normalized : '';
}

function publicUser(claims) {
  return {
    id: claims.id,
    code: claims.user,
    name: claims.name,
    company: 'GMP',
    vendedorCode: claims.user,
    role: claims.role,
    availableRoles: [...claims.availableRoles],
    activeMode: claims.activeMode,
    availableModes: [...claims.availableModes],
    isJefeVentas: claims.isJefeVentas,
    isRepartidor: claims.isRepartidor,
    codigoConductor: claims.codigoConductor,
    matricula: claims.matricula,
    vendorCodes: [...claims.vendorCodes],
    vendedorCodes: [...claims.vendedorCodes],
    repartidorCodes: Array.isArray(claims.repartidorCodes) ? [...claims.repartidorCodes] : [],
    tipoVendedor: claims.tipoVendedor,
    TIPOVENDEDOR: claims.tipoVendedor,
    showCommissions: claims.showCommissions,
    claimsVersion: claims.claimsVersion,
  };
}

function sendError(res, error) {
  if (error instanceof AuthClaimsError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.code === 'AUTH_AUDIT_UNAVAILABLE') {
    return res.status(503).json({
      error: 'Auditoria de autenticacion no disponible',
      code: 'AUTH_AUDIT_UNAVAILABLE',
    });
  }
  if (error?.code === 'AUTH_SESSION_STORE_UNAVAILABLE') {
    return res.status(503).json({
      error: 'Almacen de sesiones no disponible',
      code: 'AUTH_SESSION_STORE_UNAVAILABLE',
    });
  }
  if (error?.code === 'AUTH_SESSION_LIMIT_REACHED') {
    return res.status(409).json({
      error: 'Limite de sesiones activas alcanzado. Cierra sesion en otro dispositivo e intentalo de nuevo.',
      code: 'AUTH_SESSION_LIMIT_REACHED',
    });
  }
  return res.status(503).json({
    error: 'Perfil de autorizaci\u00f3n no disponible',
    code: 'AUTH_PROFILE_UNAVAILABLE',
  });
}

async function requireLoginAudit(authRepository, userId, success, ip) {
  const result = await authRepository.logLoginAttempt?.(userId, success, ip);
  if (result?.ok !== true) {
    const error = new Error('auth audit unavailable');
    error.code = 'AUTH_AUDIT_UNAVAILABLE';
    throw error;
  }
}

function usableCredential(profile) {
  return Boolean(profile && profile.isActive === true && profile._passwordHash);
}

async function resolveNameLoginProfile({
  authRepository,
  verifyVendorPin,
  username,
  password,
  requestId,
}) {
  if (typeof authRepository.findNameLoginCandidates !== 'function') return null;
  const candidates = await authRepository.findNameLoginCandidates(username, { limit: 10 });
  const usable = (Array.isArray(candidates) ? candidates : []).filter(usableCredential);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const matches = [];
  for (const candidate of usable) {
    const probe = await verifyVendorPin({
      vendedorCode: candidate.code,
      candidatePin: password,
      dbPin: candidate._passwordHash,
      requestId,
      skipLockout: true,
    });
    if (probe?.valid) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : null;
}
function createAuthClaimsLoginHandler({
  authRepository,
  authClaimsResolver,
  verifyVendorPin,
  tokenService,
  createId = crypto.randomUUID,
} = {}) {
  if (!authRepository || !authClaimsResolver || typeof verifyVendorPin !== 'function' || !tokenService) {
    throw new TypeError('complete auth login dependencies are required');
  }

  return async function authClaimsLoginHandler(req, res) {
    const rawUsername = String(req.body?.username || '').trim();
    const username = normalizeUsername(rawUsername);
    const password = String(req.body?.password || '').trim();
    if (!rawUsername || !password) {
      return res.status(400).json({
        error: 'Usuario y contrasena requeridos',
        code: 'MISSING_CREDENTIALS',
      });
    }
    if (!username || username.length > 50) {
      return res.status(400).json({ error: 'Usuario invalido', code: 'INVALID_USERNAME' });
    }

    let credentialProfile;
    try {
      credentialProfile = await authRepository.findByCode(username);
      if (!usableCredential(credentialProfile)) {
        const named = await resolveNameLoginProfile({
          authRepository,
          verifyVendorPin,
          username,
          password,
          requestId: req.requestId || 'AUTH',
        });
        if (named) credentialProfile = named;
      }
    } catch (error) {
      return sendError(res, error);
    }
    if (!credentialProfile || credentialProfile.isActive !== true || !credentialProfile._passwordHash) {
      try {
        await verifyVendorPin({
          vendedorCode: '__none__',
          candidatePin: password,
          dbPin: '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV',
          requestId: req.requestId || 'AUTH',
        });
      } catch (_) {
        // Dummy compare for A-12 timing; ignore hash format errors.
      }
      try {
        await requireLoginAudit(authRepository, credentialProfile?.id || null, false, req.ip);
      } catch (error) {
        return sendError(res, error);
      }
      return res.status(401).json({ error: 'Credenciales invalidas', code: 'INVALID_CREDENTIALS' });
    }

    let pinVerification;
    try {
      pinVerification = await verifyVendorPin({
        vendedorCode: credentialProfile.code,
        candidatePin: password,
        dbPin: credentialProfile._passwordHash,
        requestId: req.requestId || 'AUTH',
      });
    } catch (error) {
      return sendError(res, error);
    }
    if (!pinVerification?.valid) {
      try {
        await requireLoginAudit(authRepository, credentialProfile.id, false, req.ip);
      } catch (error) {
        return sendError(res, error);
      }
      return res.status(401).json({ error: 'Credenciales invalidas', code: 'INVALID_CREDENTIALS' });
    }

    let resolvedClaims;
    try {
      resolvedClaims = await authClaimsResolver.resolve({ code: credentialProfile.code });
      await requireLoginAudit(authRepository, resolvedClaims.id, true, req.ip);
      const sid = createId();
      const accessJti = createId();
      const refreshJti = createId();
      const tokenClaims = { ...resolvedClaims, sub: resolvedClaims.id, sid };
      const accessToken = tokenService.signAccessToken({ ...tokenClaims, jti: accessJti });
      const refreshToken = tokenService.signRefreshToken({ ...tokenClaims, jti: refreshJti });
      try {
        await tokenService.registerSession(
          resolvedClaims.id,
          refreshToken,
          req.get?.('user-agent') || 'unknown',
          req.ip || 'unknown',
          { sid, accessJti, refreshJti },
        );
      } catch (error) {
        try {
          await tokenService.revokeSession?.(sid, { userId: resolvedClaims.id });
        } catch (_revokeError) {
          // Best-effort compensation only; preserve the original register failure.
        }
        throw error;
      }

      return res.json({
        success: true,
        user: publicUser(resolvedClaims),
        role: resolvedClaims.role,
        availableRoles: [...resolvedClaims.availableRoles],
        activeMode: resolvedClaims.activeMode,
        availableModes: [...resolvedClaims.availableModes],
        isJefeVentas: resolvedClaims.isJefeVentas,
        isRepartidor: resolvedClaims.isRepartidor,
        codigoConductor: resolvedClaims.codigoConductor,
        matricula: resolvedClaims.matricula,
        vendorCodes: [...resolvedClaims.vendorCodes],
        vendedorCodes: [...resolvedClaims.vendedorCodes],
        repartidorCodes: Array.isArray(resolvedClaims.repartidorCodes) ? [...resolvedClaims.repartidorCodes] : [],
        tipoVendedor: resolvedClaims.tipoVendedor,
        showCommissions: resolvedClaims.showCommissions,
        claimsVersion: resolvedClaims.claimsVersion,
        latestVersion: '3.3.1',
        token: accessToken,
        refreshToken,
        tokenExpiresIn: Math.floor(tokenService.ACCESS_TTL_MS / 1000),
        refreshExpiresIn: Math.floor(tokenService.REFRESH_TTL_MS / 1000),
      });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

module.exports = {
  createAuthClaimsLoginHandler,
};
