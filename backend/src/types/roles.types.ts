/**
 * TIPOS DE ROL PARA LA APLICACIÓN
 */

export type UserRole = 'JEFE' | 'COMERCIAL' | 'REPARTIDOR';

export interface AppUser {
    codigo: string;
    nombre: string;
    rol: UserRole;
    codigosComercialesAsociados?: string[]; // Para Jefe: todos los comerciales bajo su cargo
    codigoConductor?: string; // Para Repartidor: su código de conductor
    rutaAsignada?: string;
}

export interface RolePermissions {
    canViewDashboard: boolean;
    canViewClients: boolean;
    canViewRutero: boolean;
    canViewObjectives: boolean;
    canViewCommissions: boolean;
    canViewCobros: boolean;
    canViewEntregas: boolean;
    canViewChat: boolean;

    // Permisos específicos de Cobros
    canCreatePresupuestos: boolean;
    canCollectCTR: boolean;
    canUploadSignatures: boolean;
    canUploadPhotos: boolean;
    canViewAllCobros: boolean; // Solo Jefe
}

/**
 * Obtener permisos según rol
 */
export function getPermissionsByRole(rol: UserRole): RolePermissions {
    switch (rol) {
        case 'JEFE':
            return {
                canViewDashboard: true,
                canViewClients: true,
                canViewRutero: true,
                canViewObjectives: true,
                canViewCommissions: true,
                canViewCobros: true,
                canViewEntregas: true,
                canViewChat: true,
                canCreatePresupuestos: true,
                canCollectCTR: true,
                canUploadSignatures: true,
                canUploadPhotos: true,
                canViewAllCobros: true,
            };

        case 'COMERCIAL':
            return {
                canViewDashboard: false,
                canViewClients: true,
                canViewRutero: true,
                canViewObjectives: true,
                canViewCommissions: true,
                canViewCobros: true, // Su propia sección de cobros
                canViewEntregas: false,
                canViewChat: true,
                canCreatePresupuestos: true,
                canCollectCTR: false,
                canUploadSignatures: false,
                canUploadPhotos: false,
                canViewAllCobros: false,
            };

        case 'REPARTIDOR':
            return {
                canViewDashboard: false,
                canViewClients: false,
                canViewRutero: false, // Tiene su propia vista de ruta de entregas
                canViewObjectives: false,
                canViewCommissions: false,
                canViewCobros: true, // Cobros CTR
                canViewEntregas: true,
                canViewChat: false,
                canCreatePresupuestos: false,
                canCollectCTR: true,
                canUploadSignatures: true,
                canUploadPhotos: true,
                canViewAllCobros: false,
            };

        default:
            // Por defecto: permisos mínimos
            return {
                canViewDashboard: false,
                canViewClients: false,
                canViewRutero: false,
                canViewObjectives: false,
                canViewCommissions: false,
                canViewCobros: false,
                canViewEntregas: false,
                canViewChat: false,
                canCreatePresupuestos: false,
                canCollectCTR: false,
                canUploadSignatures: false,
                canUploadPhotos: false,
                canViewAllCobros: false,
            };
    }
}

/**
 * Códigos de forma de pago para CTR (Contra Reembolso)
 * Ajustar según los valores reales de DSEDAC.FPA
 */
export const FORMAS_PAGO_CTR = ['01', 'CO', 'CTR', 'EF'];

/**
 * Verificar si una forma de pago es CTR
 */
export function isFormaPagoCTR(codigoFormaPago: string): boolean {
    return FORMAS_PAGO_CTR.includes(codigoFormaPago?.trim()?.toUpperCase());
}
