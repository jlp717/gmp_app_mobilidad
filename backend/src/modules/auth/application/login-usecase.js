/**
 * Login Use Case - Auth Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const { User } = require('../domain/user');

class LoginUseCase extends UseCase {
  constructor(authRepository, hashUtils, tokenUtils) {
    super();
    this._authRepository = authRepository;
    this._hashUtils = hashUtils;
    this._tokenUtils = tokenUtils;
  }

  async execute({ username, password, ip, userAgent }) {
    const user = await this._authRepository.findByCode(username);
    if (!user) {
      await this._authRepository.logLoginAttempt(null, false, ip);
      throw new AuthError('Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AuthError('Usuario desactivado', 'USER_INACTIVE');
    }

    const passwordValid = await this._hashUtils.verifyPassword(password, user._passwordHash);
    if (!passwordValid) {
      await this._authRepository.logLoginAttempt(user.id, false, ip);
      throw new AuthError('Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    const accessToken = this._tokenUtils.signAccessToken({
      id: user.id,
      user: user.code,
      role: user.role,
      isJefeVentas: user.isJefeVentas
    });

    const refreshToken = this._tokenUtils.signRefreshToken({
      id: user.id,
      user: user.code,
      role: user.role,
      isJefeVentas: user.isJefeVentas
    });

    await this._authRepository.logLoginAttempt(user.id, true, ip);

    return {
      user: {
        id: user.id,
        code: user.code,
        name: user.name,
        role: user.role,
        isJefeVentas: user.isJefeVentas
      },
      accessToken,
      refreshToken,
      expiresIn: 3600
    };
  }
}

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

module.exports = { LoginUseCase, AuthError };
