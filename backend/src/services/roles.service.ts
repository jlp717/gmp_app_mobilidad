/**
 * SERVICIO DE ROLES - DETECCIÓN DESDE BD
 * 
 * Detecta roles consultando JAVIER.APP_USERS:
 * - Si existe en APP_USERS → usa ese rol
 * - Si código = '01' (GOYO) → JEFE
 * - Si existe en CAC.CODIGOCONDUCTOR → REPARTIDOR
 * - Por defecto → COMERCIAL
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';

// Tipos de rol
export type UserRole = 'JEFE' | 'COMERCIAL' | 'REPARTIDOR';

export interface AppUser {
    codigo: string;
    nombre: string;
    rol: UserRole;
    codigoConductor?: string;
    rutasAsignadas?: string[];
}

// Códigos conocidos de JEFES (actualizar según tu BD)
const CODIGOS_JEFES = ['01']; // GOYO

// Códigos de forma de pago que requieren cobro (CTR)
const CODIGOS_CTR_TIPICOS = ['01', 'CO', 'EF', 'CT', 'CTR', 'CONTADO', 'EFECTIVO'];

class RolesService {

    /**
     * Detectar rol del usuario
     * Orden de prioridad:
     * 1. Consultar JAVIER.APP_USERS (si existe la tabla)
     * 2. Código en lista de JEFES conocidos
     * 3. Código existe en CAC.CODIGOCONDUCTOR → REPARTIDOR
     * 4. Por defecto → COMERCIAL
     */
    async detectarRol(codigoUsuario: string, isJefeVentasFromLogin?: boolean): Promise<UserRole> {
        const codigo = codigoUsuario.trim();

        // 1. Verificar en tabla APP_USERS (si existe)
        try {
            const resultado = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT ROL FROM JAVIER.APP_USERS
        WHERE TRIM(CODIGO) = ? AND ACTIVO = 'S'
        FETCH FIRST 1 ROWS ONLY
      `, [codigo]);

            if (resultado.length > 0) {
                const rol = String(resultado[0].ROL).trim().toUpperCase() as UserRole;
                logger.info(`[ROLES] Usuario ${codigo} → Rol desde APP_USERS: ${rol}`);
                return rol;
            }
        } catch (error) {
            // Tabla no existe todavía, continuar con lógica alternativa
            logger.debug('[ROLES] Tabla APP_USERS no existe, usando lógica alternativa');
        }

        // 2. Verificar si es Jefe por código conocido o flag del login
        if (CODIGOS_JEFES.includes(codigo) || isJefeVentasFromLogin) {
            logger.info(`[ROLES] Usuario ${codigo} → JEFE (código conocido)`);
            return 'JEFE';
        }

        // 3. Verificar si es Repartidor (tiene vehículo asignado en VEH)
        // VEH.CODIGOVENDEDOR contiene los códigos de conductores con vehículo
        try {
            const tieneVehiculo = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TRIM(CODIGOVEHICULO) as VEHICULO, TRIM(MATRICULA) as MATRICULA
        FROM DSEDAC.VEH
        WHERE TRIM(CODIGOVENDEDOR) = ?
        FETCH FIRST 1 ROWS ONLY
      `, [codigo]);

            if (tieneVehiculo.length > 0) {
                const matricula = String(tieneVehiculo[0].MATRICULA || '').trim();
                logger.info(`[ROLES] Usuario ${codigo} → REPARTIDOR (vehículo: ${matricula})`);
                return 'REPARTIDOR';
            }
        } catch (error) {
            logger.debug('[ROLES] Error verificando vehículo:', error);
        }

        // 4. Por defecto: COMERCIAL
        logger.info(`[ROLES] Usuario ${codigo} → COMERCIAL (default)`);
        return 'COMERCIAL';
    }

    /**
     * Obtener información completa del usuario con rol
     */
    async obtenerUsuarioConRol(codigoUsuario: string, nombre: string, isJefeVentasFromLogin?: boolean): Promise<AppUser> {
        const rol = await this.detectarRol(codigoUsuario, isJefeVentasFromLogin);

        return {
            codigo: codigoUsuario,
            nombre,
            rol,
            codigoConductor: rol === 'REPARTIDOR' ? codigoUsuario : undefined,
        };
    }

    /**
     * Obtener lista de conductores existentes (para selector en admin)
     */
    async obtenerConductores(): Promise<{ codigo: string; totalAlbaranes: number }[]> {
        try {
            const resultado = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT 
          TRIM(CODIGOCONDUCTOR) as CODIGO,
          COUNT(*) as TOTAL
        FROM DSEDAC.CAC
        WHERE EJERCICIOALBARAN = 2026
          AND CODIGOCONDUCTOR IS NOT NULL
          AND TRIM(CODIGOCONDUCTOR) <> ''
        GROUP BY TRIM(CODIGOCONDUCTOR)
        ORDER BY TOTAL DESC
        FETCH FIRST 50 ROWS ONLY
      `);

            return resultado.map(row => ({
                codigo: String(row.CODIGO).trim(),
                totalAlbaranes: Number(row.TOTAL),
            }));
        } catch (error) {
            logger.error('[ROLES] Error obteniendo conductores:', error);
            return [];
        }
    }

    /**
     * Obtener formas de pago y detectar cuáles son CTR
     */
    async obtenerFormasPago(): Promise<{ codigo: string; descripcion: string; esCTR: boolean; total: number }[]> {
        try {
            // Intentar obtener con descripción desde FPA
            let resultado: Record<string, unknown>[];

            try {
                resultado = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT 
            TRIM(CAC.CODIGOFORMAPAGO) as CODIGO,
            TRIM(COALESCE(FPA.NOMFPA, FPA.DESCRIPCION, CAC.CODIGOFORMAPAGO)) as DESCRIPCION,
            COUNT(*) as TOTAL
          FROM DSEDAC.CAC
          LEFT JOIN DSEDAC.FPA ON TRIM(FPA.CODFPA) = TRIM(CAC.CODIGOFORMAPAGO)
          WHERE CAC.EJERCICIOALBARAN = 2026
          GROUP BY TRIM(CAC.CODIGOFORMAPAGO), TRIM(COALESCE(FPA.NOMFPA, FPA.DESCRIPCION, CAC.CODIGOFORMAPAGO))
          ORDER BY TOTAL DESC
        `);
            } catch {
                // Sin join a FPA
                resultado = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT 
            TRIM(CODIGOFORMAPAGO) as CODIGO,
            TRIM(CODIGOFORMAPAGO) as DESCRIPCION,
            COUNT(*) as TOTAL
          FROM DSEDAC.CAC
          WHERE EJERCICIOALBARAN = 2026
          GROUP BY TRIM(CODIGOFORMAPAGO)
          ORDER BY TOTAL DESC
        `);
            }

            return resultado.map(row => {
                const codigo = String(row.CODIGO).trim().toUpperCase();
                const descripcion = String(row.DESCRIPCION).trim().toUpperCase();

                // Detectar CTR por código o descripción
                const esCTR = CODIGOS_CTR_TIPICOS.some(c => codigo.includes(c)) ||
                    descripcion.includes('CONTADO') ||
                    descripcion.includes('EFECTIVO') ||
                    descripcion.includes('REEMBOLSO') ||
                    descripcion.includes('CTR');

                return {
                    codigo: String(row.CODIGO).trim(),
                    descripcion: String(row.DESCRIPCION).trim(),
                    esCTR,
                    total: Number(row.TOTAL),
                };
            });
        } catch (error) {
            logger.error('[ROLES] Error obteniendo formas de pago:', error);
            return [];
        }
    }

    /**
     * Verificar si una forma de pago es CTR (requiere cobro en entrega)
     */
    async esFormaPagoCTR(codigoFormaPago: string): Promise<boolean> {
        const codigo = codigoFormaPago.trim().toUpperCase();

        // Primero verificar contra códigos típicos
        if (CODIGOS_CTR_TIPICOS.some(c => codigo.includes(c))) {
            return true;
        }

        // Intentar verificar en BD por descripción
        try {
            const resultado = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TRIM(COALESCE(NOMFPA, DESCRIPCION, '')) as DESC
        FROM DSEDAC.FPA
        WHERE TRIM(CODFPA) = ?
        FETCH FIRST 1 ROWS ONLY
      `, [codigoFormaPago.trim()]);

            if (resultado.length > 0) {
                const desc = String(resultado[0].DESC).toUpperCase();
                return desc.includes('CONTADO') ||
                    desc.includes('EFECTIVO') ||
                    desc.includes('REEMBOLSO');
            }
        } catch {
            // Ignorar error de tabla FPA
        }

        return false;
    }

    /**
     * Obtener albaranes pendientes de entrega para un conductor (hoy)
     */
    async obtenerAlbaranesConductor(codigoConductor: string) {
        try {
            const hoy = new Date();
            const dia = hoy.getDate();
            const mes = hoy.getMonth() + 1;
            const ano = hoy.getFullYear();

            const resultado = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT 
          CAC.SUBEMPRESAALBARAN,
          CAC.EJERCICIOALBARAN,
          CAC.SERIEALBARAN,
          CAC.NUMEROALBARAN,
          TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
          TRIM(COALESCE(CLI.NOMBREFISCAL, CLI.NOMBRECOMERCIAL, 'CLIENTE')) as NOMBRE_CLIENTE,
          TRIM(COALESCE(CLI.DIRECCION1, '')) as DIRECCION,
          CAC.IMPORTETOTAL / 100.0 as IMPORTE,
          TRIM(CAC.CODIGOFORMAPAGO) as FORMA_PAGO,
          CAC.DIADOCUMENTO, CAC.MESDOCUMENTO, CAC.ANODOCUMENTO,
          TRIM(CAC.CODIGORUTA) as RUTA
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
        WHERE TRIM(CAC.CODIGOCONDUCTOR) = ?
          AND CAC.ANODOCUMENTO = ?
          AND CAC.MESDOCUMENTO = ?
          AND CAC.DIADOCUMENTO = ?
        ORDER BY CAC.NUMEROALBARAN
      `, [codigoConductor.trim(), ano, mes, dia]);

            // Procesar y añadir flag CTR
            const albaranes = [];
            for (const row of resultado) {
                const formaPago = String(row.FORMA_PAGO).trim();
                const esCTR = await this.esFormaPagoCTR(formaPago);

                albaranes.push({
                    id: `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.NUMEROALBARAN}`,
                    subempresa: String(row.SUBEMPRESAALBARAN).trim(),
                    ejercicio: Number(row.EJERCICIOALBARAN),
                    serie: String(row.SERIEALBARAN).trim(),
                    numero: Number(row.NUMEROALBARAN),
                    codigoCliente: String(row.CLIENTE),
                    nombreCliente: String(row.NOMBRE_CLIENTE),
                    direccion: String(row.DIRECCION),
                    importe: Number(row.IMPORTE),
                    formaPago,
                    esCTR,
                    fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                    ruta: String(row.RUTA),
                    estado: 'PENDIENTE',
                });
            }

            return albaranes;
        } catch (error) {
            logger.error('[ROLES] Error obteniendo albaranes conductor:', error);
            throw error;
        }
    }
}

export const rolesService = new RolesService();
