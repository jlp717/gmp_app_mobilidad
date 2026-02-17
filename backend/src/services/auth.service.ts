/**
 * SERVICIO DE AUTENTICACIÓN PARA VENDEDORES/COMERCIALES
 * Autentica vendedores usando las tablas DSEDAC.VDD (datos) y DSEDAC.VDP (PINs)
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toStr } from '../utils/db-helpers';

// Constantes de seguridad
const BCRYPT_ROUNDS = config.security.bcryptRounds;

interface TokenPayload {
  codigoVendedor: string;
  nombreVendedor: string;
  tipo: 'access' | 'refresh';
  jti: string;
}

interface Vendedor {
  codigoVendedor: string;
  nombreVendedor: string;
  nif: string;
  telefono: string;
  direccion: string;
  poblacion: string;
  provincia: string;
}

interface AuthResult {
  success: boolean;
  vendedor?: Vendedor;
  error?: string;
  bloqueado?: boolean;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

class AuthService {
  /**
   * Autentica un vendedor/comercial contra las tablas VDD y VDP
   * Se puede autenticar con:
   * - código vendedor (02) + PIN (0397)
   * - nombre vendedor (BARTOLO) + PIN (0397)
   */
  async autenticarComercial(
    usuario: string,
    password: string,
    metadata: { ip: string; userAgent: string }
  ): Promise<AuthResult> {
    const startTime = Date.now();

    try {
      // Validación inicial
      if (!usuario || !password) {
        return { success: false, error: 'Usuario y contraseña son requeridos' };
      }

      // Sanitizar inputs
      usuario = usuario.trim().toUpperCase();
      password = password.trim();

      // Buscar vendedor por código o nombre
      const vendedor = await this.buscarVendedor(usuario);

      if (!vendedor) {
        await this.aplicarDelayTimingAttack(startTime);
        logger.warn(`Vendedor no encontrado: ${usuario}`, { ip: metadata.ip });
        return { success: false, error: 'Credenciales incorrectas' };
      }

      // Obtener PIN del vendedor
      const pinDB = await this.obtenerPIN(vendedor.codigoVendedor);

      if (!pinDB) {
        await this.aplicarDelayTimingAttack(startTime);
        logger.warn(`Vendedor sin PIN configurado: ${vendedor.codigoVendedor}`, { ip: metadata.ip });
        return { success: false, error: 'Credenciales incorrectas' };
      }

      // Comparar PIN
      if (password !== pinDB) {
        await this.aplicarDelayTimingAttack(startTime);
        logger.warn(`PIN incorrecto para vendedor: ${vendedor.codigoVendedor}`, { ip: metadata.ip });
        return { success: false, error: 'Credenciales incorrectas' };
      }

      await this.aplicarDelayTimingAttack(startTime);
      logger.info(`Login exitoso para vendedor ${vendedor.codigoVendedor} (${vendedor.nombreVendedor})`);

      return {
        success: true,
        vendedor,
      };
    } catch (error) {
      logger.error('Error en autenticación:', error);
      throw new Error('Error durante la autenticación');
    }
  }

  /**
   * Busca vendedor por código o por nombre (parcial)
   */
  private async buscarVendedor(usuario: string): Promise<Vendedor | null> {
    // Primero buscar por código exacto
    let resultado = await odbcPool.query<Record<string, unknown>[]>(
      `SELECT 
        CODIGOVENDEDOR, 
        TRIM(NOMBREVENDEDOR) as NOMBREVENDEDOR,
        TRIM(NIF) as NIF,
        TRIM(TELEFONO1) as TELEFONO,
        TRIM(DIRECCION) as DIRECCION,
        TRIM(POBLACION) as POBLACION,
        TRIM(PROVINCIA) as PROVINCIA
       FROM DSEDAC.VDD
       WHERE TRIM(CODIGOVENDEDOR) = ?
       FETCH FIRST 1 ROWS ONLY`,
      [usuario]
    );

    // Si no encuentra por código, buscar por nombre (parameterized LIKE)
    if (!resultado || resultado.length === 0) {
      const searchPattern = `%${usuario.toUpperCase()}%`;
      resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          CODIGOVENDEDOR,
          TRIM(NOMBREVENDEDOR) as NOMBREVENDEDOR,
          TRIM(NIF) as NIF,
          TRIM(TELEFONO1) as TELEFONO,
          TRIM(DIRECCION) as DIRECCION,
          TRIM(POBLACION) as POBLACION,
          TRIM(PROVINCIA) as PROVINCIA
         FROM DSEDAC.VDD
         WHERE UPPER(TRIM(NOMBREVENDEDOR)) LIKE ?
         FETCH FIRST 1 ROWS ONLY`,
        [searchPattern]
      );
    }

    if (!resultado || resultado.length === 0) return null;

    const row = resultado[0];
    return {
      codigoVendedor: toStr(row.CODIGOVENDEDOR),
      nombreVendedor: toStr(row.NOMBREVENDEDOR),
      nif: toStr(row.NIF),
      telefono: toStr(row.TELEFONO),
      direccion: toStr(row.DIRECCION),
      poblacion: toStr(row.POBLACION),
      provincia: toStr(row.PROVINCIA),
    };
  }

  /**
   * Obtiene el PIN de un vendedor desde VDP
   */
  private async obtenerPIN(codigoVendedor: string): Promise<string | null> {
    const resultado = await odbcPool.query<Record<string, unknown>[]>(
      `SELECT CODIGOPIN FROM DSEDAC.VDP WHERE TRIM(CODIGOVENDEDOR) = ? FETCH FIRST 1 ROWS ONLY`,
      [codigoVendedor]
    );

    if (!resultado || resultado.length === 0) return null;
    return toStr(resultado[0].CODIGOPIN);
  }

  /**
   * Genera par de tokens JWT
   */
  generarTokens(vendedor: Vendedor): TokenPair {
    const jti = uuidv4();

    const accessPayload: TokenPayload = { 
      codigoVendedor: vendedor.codigoVendedor,
      nombreVendedor: vendedor.nombreVendedor,
      tipo: 'access', 
      jti 
    };

    const refreshPayload: TokenPayload = { 
      codigoVendedor: vendedor.codigoVendedor,
      nombreVendedor: vendedor.nombreVendedor,
      tipo: 'refresh', 
      jti 
    };

    // Convertir tiempo de expiración a segundos
    const accessExpiresIn = this.parseExpiration(config.jwt.accessExpires);
    const refreshExpiresIn = this.parseExpiration(config.jwt.refreshExpires);

    const accessToken = jwt.sign(
      accessPayload,
      config.jwt.accessSecret,
      { expiresIn: accessExpiresIn }
    );

    const refreshToken = jwt.sign(
      refreshPayload,
      config.jwt.refreshSecret,
      { expiresIn: refreshExpiresIn }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
    };
  }

  /**
   * Verifica y refresca tokens
   */
  async refrescarTokens(refreshToken: string): Promise<TokenPair | null> {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as TokenPayload;

      if (decoded.tipo !== 'refresh') {
        return null;
      }

      // Buscar vendedor actual para generar nuevos tokens
      const vendedor = await this.buscarVendedor(decoded.codigoVendedor);
      if (!vendedor) return null;

      return this.generarTokens(vendedor);
    } catch {
      return null;
    }
  }

  /**
   * Verifica un access token
   */
  verificarAccessToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
      if (decoded.tipo !== 'access') {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Hash de contraseña
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  // ============================================
  // UTILIDADES
  // ============================================

  private async aplicarDelayTimingAttack(startTime: number): Promise<void> {
    const elapsedTime = Date.now() - startTime;
    const minAuthTime = 200 + Math.random() * 100;
    if (elapsedTime < minAuthTime) {
      await new Promise((resolve) => setTimeout(resolve, minAuthTime - elapsedTime));
    }
  }

  private parseExpiration(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // 15 min default

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 900;
    }
  }
}

export const authService = new AuthService();
export default authService;
