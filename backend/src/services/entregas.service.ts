/**
 * SERVICIO DE ENTREGAS - REPARTIDOR
 * Gestión de entregas parciales, fotos, firmas y cobros en campo
 */

import { v4 as uuidv4 } from 'uuid';
import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// ============================================
// TIPOS
// ============================================

export type EstadoEntrega = 'PENDIENTE' | 'EN_RUTA' | 'ENTREGADO' | 'PARCIAL' | 'NO_ENTREGADO' | 'RECHAZADO';

export interface EntregaItem {
    itemId: string;
    codigoArticulo: string;
    descripcion: string;
    cantidadPedida: number;
    cantidadEntregada: number;
    estado: EstadoEntrega;
}

export interface Albaran {
    id: string;
    numeroAlbaran: number;
    codigoCliente: string;
    nombreCliente: string;
    direccion: string;
    fecha: string;
    importeTotal: number;
    estado: EstadoEntrega;
    items: EntregaItem[];
    repartidorId?: string;
    formaPago?: string;
    esCTR: boolean;
}

export interface RegistroEntrega {
    id: string;
    albaranId: string;
    itemId?: string;
    repartidorId: string;
    estado: EstadoEntrega;
    fechaHora: string;
    latitud?: number;
    longitud?: number;
    observaciones?: string;
    fotos?: string[];
    firma?: string;
}

export interface ActualizarEntregaParams {
    itemId: string;
    status: EstadoEntrega;
    repartidorId: string;
    cantidadEntregada?: number;
    observaciones?: string;
    fotos?: string[];
    firma?: string;
    latitud?: number;
    longitud?: number;
}

// ============================================
// SERVICIO
// ============================================

class EntregasService {
    private uploadsPath: string;

    constructor() {
        this.uploadsPath = path.join(__dirname, '../../uploads');
        this.ensureUploadDirs();
    }

    /**
     * Asegura que existan los directorios de uploads
     */
    private ensureUploadDirs(): void {
        const dirs = ['photos', 'signatures'];
        dirs.forEach(dir => {
            const fullPath = path.join(this.uploadsPath, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                logger.info(`[ENTREGAS] Directorio creado: ${fullPath}`);
            }
        });
    }

    /**
     * Obtiene albaranes pendientes para un repartidor
     */
    async obtenerAlbaranesPendientes(repartidorId: string): Promise<Albaran[]> {
        try {
            logger.info(`[ENTREGAS] Obteniendo albaranes pendientes para repartidor: ${repartidorId}`);

            // Query para obtener albaranes asignados al repartidor
            // Ajustar según la estructura real de la BD
            const query = `
        SELECT
          CAC.SUBEMPRESAALBARAN,
          CAC.EJERCICIOALBARAN,
          CAC.SERIEALBARAN,
          CAC.NUMEROALBARAN,
          CAC.CODIGOCLIENTEFACTURA as CODIGO_CLIENTE,
          CLI.NOMCLI as NOMBRE_CLIENTE,
          CLI.DIRCLI as DIRECCION,
          CAC.ANODOCUMENTO,
          CAC.MESDOCUMENTO,
          CAC.DIADOCUMENTO,
          CAC.IMPORTETOTAL,
          CAC.CODIGOFORMAPAGO,
          CAC.CODIGOTIPOALBARAN
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODIGOCLIENTEFACTURA)
        WHERE CAC.ANODOCUMENTO = YEAR(CURRENT_DATE)
          AND CAC.MESDOCUMENTO = MONTH(CURRENT_DATE)
          AND CAC.DIADOCUMENTO = DAY(CURRENT_DATE)
        ORDER BY CAC.NUMEROALBARAN
        FETCH FIRST 100 ROWS ONLY
      `;

            const resultado = await odbcPool.query<Record<string, unknown>[]>(query);

            return resultado.map(row => this.mapearAlbaran(row));
        } catch (error) {
            logger.error('[ENTREGAS] Error obteniendo albaranes pendientes:', error);
            throw error;
        }
    }

    /**
     * Obtiene un albarán específico con sus items
     */
    async obtenerAlbaran(numeroAlbaran: number, ejercicio: number): Promise<Albaran | null> {
        try {
            const queryAlbaran = `
        SELECT
          CAC.SUBEMPRESAALBARAN,
          CAC.EJERCICIOALBARAN,
          CAC.SERIEALBARAN,
          CAC.NUMEROALBARAN,
          CAC.CODIGOCLIENTEFACTURA as CODIGO_CLIENTE,
          CLI.NOMCLI as NOMBRE_CLIENTE,
          CLI.DIRCLI as DIRECCION,
          CAC.ANODOCUMENTO,
          CAC.MESDOCUMENTO,
          CAC.DIADOCUMENTO,
          CAC.IMPORTETOTAL,
          CAC.CODIGOFORMAPAGO
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODIGOCLIENTEFACTURA)
        WHERE CAC.NUMEROALBARAN = ?
          AND CAC.EJERCICIOALBARAN = ?
        FETCH FIRST 1 ROWS ONLY
      `;

            const [albaran] = await odbcPool.query<Record<string, unknown>[]>(
                queryAlbaran,
                [numeroAlbaran, ejercicio]
            );

            if (!albaran) return null;

            // Obtener líneas del albarán (LAC = Líneas de albarán/factura)
            const queryLineas = `
        SELECT
          LAC.SECUENCIA,
          LAC.CODIGOARTICULO,
          LAC.DESCRIPCIONARTICULO,
          LAC.CANTIDADENVASES,
          LAC.CANTIDADUNIDADES,
          LAC.IMPORTEVENTA
        FROM DSEDAC.LAC
        WHERE LAC.NUMEROALBARAN = ?
          AND LAC.EJERCICIOALBARAN = ?
        ORDER BY LAC.SECUENCIA
      `;

            const lineas = await odbcPool.query<Record<string, unknown>[]>(
                queryLineas,
                [numeroAlbaran, ejercicio]
            );

            const albaranCompleto = this.mapearAlbaran(albaran);
            albaranCompleto.items = lineas.map(linea => ({
                itemId: `${numeroAlbaran}-${linea.SECUENCIA}`,
                codigoArticulo: String(linea.CODIGOARTICULO || '').trim(),
                descripcion: String(linea.DESCRIPCIONARTICULO || '').trim(),
                cantidadPedida: Number(linea.CANTIDADENVASES) || Number(linea.CANTIDADUNIDADES) || 0,
                cantidadEntregada: 0,
                estado: 'PENDIENTE' as EstadoEntrega
            }));

            return albaranCompleto;
        } catch (error) {
            logger.error('[ENTREGAS] Error obteniendo albarán:', error);
            throw error;
        }
    }

    /**
     * Actualiza el estado de una entrega (item o albarán completo)
     */
    async actualizarEstadoEntrega(params: ActualizarEntregaParams): Promise<{
        success: boolean;
        registroId?: string;
        error?: string;
    }> {
        try {
            logger.info(`[ENTREGAS] Actualizando entrega: ${params.itemId} -> ${params.status}`);

            const registroId = uuidv4();
            const ahora = new Date().toISOString();

            // Intentar registrar en tabla de log
            try {
                await odbcPool.query(
                    `INSERT INTO JAVIER.ENTREGAS_LOG (
            ID, ITEM_ID, REPARTIDOR_ID, ESTADO, FECHA_HORA,
            CANTIDAD_ENTREGADA, LATITUD, LONGITUD, OBSERVACIONES
          ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
                    [
                        registroId,
                        params.itemId,
                        this.sanitizar(params.repartidorId),
                        params.status,
                        params.cantidadEntregada || 0,
                        params.latitud || null,
                        params.longitud || null,
                        params.observaciones || ''
                    ]
                );
            } catch {
                // Tabla puede no existir, usar log local
                logger.warn('[ENTREGAS] Tabla ENTREGAS_LOG no disponible, usando log local');
                this.guardarLogLocal({
                    id: registroId,
                    ...params,
                    fechaHora: ahora
                });
            }

            // Si hay fotos, guardar referencias
            if (params.fotos && params.fotos.length > 0) {
                for (const fotoPath of params.fotos) {
                    await this.registrarDocumento(registroId, 'FOTO', fotoPath);
                }
            }

            // Si hay firma, guardarla
            if (params.firma) {
                const firmaPath = await this.guardarFirma(registroId, params.firma);
                await this.registrarDocumento(registroId, 'FIRMA', firmaPath);
            }

            logger.info(`[ENTREGAS] Entrega registrada: ${registroId}`);
            return { success: true, registroId };

        } catch (error) {
            logger.error('[ENTREGAS] Error actualizando entrega:', error);
            return { success: false, error: 'Error actualizando estado de entrega' };
        }
    }

    /**
     * Registra una foto adjunta a una entrega
     */
    async registrarFoto(
        entregaId: string,
        file: { originalname: string; path: string; mimetype: string; size: number }
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        try {
            const filename = `${entregaId}_${Date.now()}_${file.originalname}`;
            const destPath = path.join(this.uploadsPath, 'photos', filename);

            // Mover archivo desde ubicación temporal
            fs.renameSync(file.path, destPath);

            await this.registrarDocumento(entregaId, 'FOTO', destPath);

            logger.info(`[ENTREGAS] Foto registrada: ${filename}`);
            return { success: true, path: destPath };

        } catch (error) {
            logger.error('[ENTREGAS] Error registrando foto:', error);
            return { success: false, error: 'Error guardando foto' };
        }
    }

    /**
     * Guarda una firma en base64
     */
    async guardarFirma(entregaId: string, base64Firma: string): Promise<string> {
        try {
            // Remover header del base64 si existe
            const base64Data = base64Firma.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const filename = `firma_${entregaId}_${Date.now()}.png`;
            const destPath = path.join(this.uploadsPath, 'signatures', filename);

            fs.writeFileSync(destPath, buffer);

            logger.info(`[ENTREGAS] Firma guardada: ${filename}`);
            return destPath;

        } catch (error) {
            logger.error('[ENTREGAS] Error guardando firma:', error);
            throw error;
        }
    }

    /**
     * Registra documento en base de datos
     */
    private async registrarDocumento(
        entregaId: string,
        tipo: 'FOTO' | 'FIRMA',
        path: string
    ): Promise<void> {
        try {
            await odbcPool.query(
                `INSERT INTO JAVIER.COBROS_DOCS (ID, ENTREGA_ID, TIPO, PATH, FECHA)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [uuidv4(), entregaId, tipo, path]
            );
        } catch {
            // Tabla puede no existir
            logger.warn('[ENTREGAS] Tabla COBROS_DOCS no disponible');
        }
    }

    /**
     * Guarda log local cuando la BD no está disponible
     */
    private guardarLogLocal(registro: Record<string, unknown>): void {
        const logPath = path.join(this.uploadsPath, 'entregas_log.json');
        let logs: Record<string, unknown>[] = [];

        if (fs.existsSync(logPath)) {
            try {
                logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            } catch {
                logs = [];
            }
        }

        logs.push(registro);
        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
    }

    /**
     * Mapea row de BD a Albaran
     */
    private mapearAlbaran(row: Record<string, unknown>): Albaran {
        const formaPago = String(row.CODIGOFORMAPAGO || '').trim().toUpperCase();
        const esCTR = formaPago.includes('CTR') ||
            formaPago.includes('REEMB') ||
            formaPago === '03';

        return {
            id: `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.NUMEROALBARAN}`,
            numeroAlbaran: Number(row.NUMEROALBARAN),
            codigoCliente: String(row.CODIGO_CLIENTE || '').trim(),
            nombreCliente: String(row.NOMBRE_CLIENTE || '').trim(),
            direccion: String(row.DIRECCION || '').trim(),
            fecha: `${String(row.DIADOCUMENTO).padStart(2, '0')}/${String(row.MESDOCUMENTO).padStart(2, '0')}/${row.ANODOCUMENTO}`,
            importeTotal: parseFloat(String(row.IMPORTETOTAL)) || 0,
            estado: 'PENDIENTE',
            items: [],
            formaPago,
            esCTR
        };
    }

    /**
     * Sanitiza strings para evitar inyección
     */
    private sanitizar(valor: string): string {
        return String(valor)
            .trim()
            .replace(/[<>'"]/g, '')
            .substring(0, 50);
    }
}

export const entregasService = new EntregasService();
export default entregasService;
