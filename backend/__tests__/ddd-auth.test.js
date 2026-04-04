/**
 * DDD Auth Module - Unit Tests
 * =============================
 * Tests for Db2AuthRepository, LoginUseCase, AuthError, and password validation
 */

'use strict';

// Mock DB connection pool before requiring any module that imports it
const mockExecuteParams = jest.fn();
jest.mock('../../src/core/infrastructure/database/db2-connection-pool', () => ({
  Db2ConnectionPool: jest.fn().mockImplementation(() => ({
    executeParams: mockExecuteParams,
    execute: jest.fn(),
    executeSilent: jest.fn(),
    executeParamsSilent: jest.fn(),
    transaction: jest.fn(),
    getConnection: jest.fn(),
    getPool: jest.fn(),
    initialize: jest.fn().mockResolvedValue({}),
    isInitialized: jest.fn().mockReturnValue(true),
  })),
}));

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { Db2AuthRepository } = require('../../src/modules/auth/infrastructure/db2-auth-repository');
const { LoginUseCase, AuthError } = require('../../src/modules/auth/application/login-usecase');
const { User } = require('../../src/modules/auth/domain/user');
const { validatePasswordStrength, verifyPassword } = require('../../middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteParams.mockReset();
});

// =============================================================================
// Db2AuthRepository
// =============================================================================

describe('Db2AuthRepository', () => {
  describe('findByCode', () => {
    test('should return User when DB returns a matching row', async () => {
      const dbRow = {
        USUARIO: '01',
        NOMBRE: 'Juan Pérez',
        ROL: 'COMERCIAL',
        EMAIL: 'juan@example.com',
        PASSWORD_HASH: '$2b$12$fakehash',
        ACTIVO: 1,
      };
      mockExecuteParams.mockResolvedValue([dbRow]);

      const repo = new Db2AuthRepository();
      const result = await repo.findByCode('01');

      expect(result).toBeInstanceOf(User);
      expect(result.code).toBe('01');
      expect(result.name).toBe('Juan Pérez');
      expect(result.role).toBe('COMERCIAL');
      expect(result.isActive).toBe(true);
      expect(result.email).toBe('juan@example.com');
      expect(mockExecuteParams).toHaveBeenCalledTimes(1);
      const callArgs = mockExecuteParams.mock.calls[0];
      expect(callArgs[0]).toContain('JAVIER.APP_USUARIOS');
      expect(callArgs[1]).toEqual(['01']);
    });

    test('should return null when no user found', async () => {
      mockExecuteParams.mockResolvedValue([]);

      const repo = new Db2AuthRepository();
      const result = await repo.findByCode('999');

      expect(result).toBeNull();
    });

    test('should return null when DB returns undefined', async () => {
      mockExecuteParams.mockResolvedValue(undefined);

      const repo = new Db2AuthRepository();
      const result = await repo.findByCode('01');

      expect(result).toBeNull();
    });

    test('should map JEFE_VENTAS role correctly', async () => {
      const dbRow = {
        USUARIO: 'JV01',
        NOMBRE: 'Jefe Ventas',
        ROL: 'JEFE_VENTAS',
        EMAIL: 'jefe@example.com',
        PASSWORD_HASH: '$2b$12$hash',
        ACTIVO: 1,
      };
      mockExecuteParams.mockResolvedValue([dbRow]);

      const repo = new Db2AuthRepository();
      const result = await repo.findByCode('JV01');

      expect(result.isJefeVentas).toBe(true);
      expect(result.role).toBe('JEFE_VENTAS');
    });

    test('should handle inactive user (ACTIVO=0)', async () => {
      const dbRow = {
        USUARIO: '02',
        NOMBRE: 'Inactive User',
        ROL: 'COMERCIAL',
        EMAIL: 'inactive@example.com',
        PASSWORD_HASH: '$2b$12$hash',
        ACTIVO: 0,
      };
      mockExecuteParams.mockResolvedValue([dbRow]);

      const repo = new Db2AuthRepository();
      const result = await repo.findByCode('02');

      expect(result.isActive).toBe(false);
    });
  });

  describe('logLoginAttempt', () => {
    test('should insert log entry on success', async () => {
      mockExecuteParams.mockResolvedValue([]);

      const repo = new Db2AuthRepository();
      await repo.logLoginAttempt('01', true, '192.168.1.1');

      expect(mockExecuteParams).toHaveBeenCalledTimes(1);
      const callArgs = mockExecuteParams.mock.calls[0];
      expect(callArgs[0]).toContain('JAVIER.APP_LOGIN_LOG');
      expect(callArgs[1]).toEqual(['01', 1, '192.168.1.1']);
    });

    test('should insert log entry on failure', async () => {
      mockExecuteParams.mockResolvedValue([]);

      const repo = new Db2AuthRepository();
      await repo.logLoginAttempt('01', false, '10.0.0.1');

      const callArgs = mockExecuteParams.mock.calls[0];
      expect(callArgs[1]).toEqual(['01', 0, '10.0.0.1']);
    });

    test('should use UNKNOWN for null userId', async () => {
      mockExecuteParams.mockResolvedValue([]);

      const repo = new Db2AuthRepository();
      await repo.logLoginAttempt(null, false, '10.0.0.1');

      const callArgs = mockExecuteParams.mock.calls[0];
      expect(callArgs[1][0]).toBe('UNKNOWN');
    });

    test('should not throw when log table does not exist', async () => {
      mockExecuteParams.mockRejectedValue(new Error('Table not found'));

      const repo = new Db2AuthRepository();
      await expect(repo.logLoginAttempt('01', true, '1.2.3.4')).resolves.not.toThrow();
    });
  });
});

// =============================================================================
// LoginUseCase
// =============================================================================

describe('LoginUseCase', () => {
  function buildMocks() {
    const mockAuthRepo = {
      findByCode: jest.fn(),
      logLoginAttempt: jest.fn(),
    };
    const mockHashUtils = {
      verifyPassword: jest.fn(),
    };
    const mockTokenUtils = {
      signAccessToken: jest.fn().mockReturnValue('mock-access-token'),
      signRefreshToken: jest.fn().mockReturnValue('mock-refresh-token'),
    };
    const useCase = new LoginUseCase(mockAuthRepo, mockHashUtils, mockTokenUtils);
    return { useCase, mockAuthRepo, mockHashUtils, mockTokenUtils };
  }

  test('should return tokens and user info on successful login', async () => {
    const { useCase, mockAuthRepo, mockHashUtils, mockTokenUtils } = buildMocks();
    const user = new User({
      id: '01',
      code: '01',
      name: 'Juan Pérez',
      role: 'COMERCIAL',
      isJefeVentas: false,
      email: 'juan@example.com',
      passwordHash: '$2b$12$hash',
      active: true,
    });
    mockAuthRepo.findByCode.mockResolvedValue(user);
    mockHashUtils.verifyPassword.mockResolvedValue(true);

    const result = await useCase.execute({
      username: '01',
      password: 'correctPassword',
      ip: '192.168.1.1',
      userAgent: 'GMP-App/1.0',
    });

    expect(result.user.code).toBe('01');
    expect(result.user.name).toBe('Juan Pérez');
    expect(result.user.role).toBe('COMERCIAL');
    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toBe('mock-refresh-token');
    expect(result.expiresIn).toBe(3600);
    expect(mockAuthRepo.logLoginAttempt).toHaveBeenCalledWith('01', true, '192.168.1.1');
  });

  test('should throw AuthError with INVALID_CREDENTIALS when user not found', async () => {
    const { useCase, mockAuthRepo } = buildMocks();
    mockAuthRepo.findByCode.mockResolvedValue(null);

    await expect(
      useCase.execute({
        username: 'nonexistent',
        password: 'any',
        ip: '1.2.3.4',
        userAgent: 'GMP-App/1.0',
      })
    ).rejects.toThrow(AuthError);

    await expect(
      useCase.execute({
        username: 'nonexistent',
        password: 'any',
        ip: '1.2.3.4',
        userAgent: 'GMP-App/1.0',
      })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(mockAuthRepo.logLoginAttempt).toHaveBeenCalledWith(null, false, '1.2.3.4');
  });

  test('should throw AuthError with USER_INACTIVE when user is deactivated', async () => {
    const { useCase, mockAuthRepo } = buildMocks();
    const inactiveUser = new User({
      id: '02',
      code: '02',
      name: 'Inactive User',
      role: 'COMERCIAL',
      isJefeVentas: false,
      email: 'inactive@example.com',
      passwordHash: '$2b$12$hash',
      active: false,
    });
    mockAuthRepo.findByCode.mockResolvedValue(inactiveUser);

    await expect(
      useCase.execute({
        username: '02',
        password: 'any',
        ip: '1.2.3.4',
        userAgent: 'GMP-App/1.0',
      })
    ).rejects.toThrow(AuthError);

    await expect(
      useCase.execute({
        username: '02',
        password: 'any',
        ip: '1.2.3.4',
        userAgent: 'GMP-App/1.0',
      })
    ).rejects.toMatchObject({ code: 'USER_INACTIVE' });
  });

  test('should throw AuthError with INVALID_CREDENTIALS when password is wrong', async () => {
    const { useCase, mockAuthRepo, mockHashUtils } = buildMocks();
    const user = new User({
      id: '01',
      code: '01',
      name: 'Juan Pérez',
      role: 'COMERCIAL',
      isJefeVentas: false,
      email: 'juan@example.com',
      passwordHash: '$2b$12$hash',
      active: true,
    });
    mockAuthRepo.findByCode.mockResolvedValue(user);
    mockHashUtils.verifyPassword.mockResolvedValue(false);

    await expect(
      useCase.execute({
        username: '01',
        password: 'wrongPassword',
        ip: '1.2.3.4',
        userAgent: 'GMP-App/1.0',
      })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(mockAuthRepo.logLoginAttempt).toHaveBeenCalledWith('01', false, '1.2.3.4');
  });

  test('should include JEFE_VENTAS flag in token payload', async () => {
    const { useCase, mockAuthRepo, mockHashUtils, mockTokenUtils } = buildMocks();
    const jefeUser = new User({
      id: 'JV01',
      code: 'JV01',
      name: 'Jefe Ventas',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      email: 'jefe@example.com',
      passwordHash: '$2b$12$hash',
      active: true,
    });
    mockAuthRepo.findByCode.mockResolvedValue(jefeUser);
    mockHashUtils.verifyPassword.mockResolvedValue(true);

    await useCase.execute({
      username: 'JV01',
      password: 'correctPassword',
      ip: '1.2.3.4',
      userAgent: 'GMP-App/1.0',
    });

    const accessTokenPayload = mockTokenUtils.signAccessToken.mock.calls[0][0];
    expect(accessTokenPayload.isJefeVentas).toBe(true);
    expect(accessTokenPayload.role).toBe('JEFE_VENTAS');
  });
});

// =============================================================================
// validatePasswordStrength
// =============================================================================

describe('validatePasswordStrength', () => {
  test('should return valid for strong password', () => {
    const result = validatePasswordStrength('Str0ngPass');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('should reject password shorter than 8 characters', () => {
    const result = validatePasswordStrength('Sh0rt');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters');
  });

  test('should reject password longer than 100 characters', () => {
    const longPassword = 'A'.repeat(101) + '1';
    const result = validatePasswordStrength(longPassword);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be less than 100 characters');
  });

  test('should reject password without uppercase letter', () => {
    const result = validatePasswordStrength('lowercase1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one uppercase letter');
  });

  test('should reject password without lowercase letter', () => {
    const result = validatePasswordStrength('ALLUPPER1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one lowercase letter');
  });

  test('should reject password without number', () => {
    const result = validatePasswordStrength('NoNumber');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one number');
  });

  test('should accumulate multiple errors', () => {
    const result = validatePasswordStrength('a');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test('should accept password with special characters', () => {
    const result = validatePasswordStrength('Str0ng!Pass@');
    expect(result.valid).toBe(true);
  });
});
