/**
 * TIPOS DE DOMINIO - ENTIDADES PRINCIPALES
 * Definiciones TypeScript para las entidades del negocio
 */

// ============================================
// CLIENTE
// ============================================
export interface Cliente {
  codigo: string;
  nombre: string;
  nombreAlternativo?: string;
  nif: string;
  direccion: string;
  poblacion: string;
  provincia: string;
  codigoPostal: string;
  telefono1?: string;
  telefono2?: string;
  email?: string;
  limiteCredito?: number;
  activo: boolean;
  codigoRuta?: string;
  coordenadasGps?: {
    latitud: number;
    longitud: number;
  };
  diasVisita?: DiasVisita;
  recargo: boolean;
  exentoIva: boolean;
}

export interface DiasVisita {
  lunes: boolean;
  martes: boolean;
  miercoles: boolean;
  jueves: boolean;
  viernes: boolean;
  sabado: boolean;
  domingo: boolean;
}

export interface ClienteAuth {
  codigoCliente: string;
  passwordHash: string;
  loginAttempts: number;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
  mustChangePassword: boolean;
  passwordType: 'NIF' | 'CUSTOM';
}

// ============================================
// PRODUCTO
// ============================================
export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  precioOriginal?: number;
  descuento?: number;
  codigoIva: string;
  porcentajeIva: number;
  familia?: string;
  categoria?: string;
  stock: number;
  disponible: boolean;
  imagen?: string;
  fichaTecnica?: string;
  promocion?: PromocionAplicada;
  metadata?: ProductoMetadata;
}

export interface ProductoMetadata {
  vecesComprado?: number;
  ultimaCompra?: string;
  unidadesUltimas?: number;
  envasesUltimos?: number;
}

export interface PromocionAplicada {
  codigo: string;
  descripcion?: string;
  activa: boolean;
}

// ============================================
// FACTURA / ALBARÁN
// ============================================
export interface Factura {
  subempresa: string;
  ejercicio: number;
  serie: string;
  terminal: number;
  numeroAlbaran: number;
  listaAlbaranes?: string;
  serieFactura: string;
  numeroFactura: number;
  tipoDocumento: string;
  fecha: string;
  dia: number;
  mes: number;
  ano: number;
  totalBase: number;
  totalIVA: number;
  totalFactura: number;
  importePendiente: number;
  estadoPago: 'pagada' | 'pendiente';
  codigoFormaPago?: string;
}

export interface LineaAlbaran {
  secuencia: number;
  codigoArticulo: string;
  descripcion: string;
  cantidadEnvases: number;
  cantidadUnidades: number;
  precioVenta: number;
  porcentajeDescuento: number;
  importeVenta: number;
  codigoIva: string;
}

// ============================================
// PEDIDO
// ============================================
export interface Pedido {
  subempresa: string;
  ejercicio: number;
  serie: string;
  terminal: number;
  numeroPedido: number;
  fecha: string;
  dia: number;
  mes: number;
  ano: number;
  numeroAlbaran: number;
  numeroFactura: number;
  serieFactura: string;
  tieneFactura: boolean;
  tieneAlbaran: boolean;
  importeTotal: number;
  importePendiente: number;
  estadoPago: 'pagado' | 'pendiente';
  codigoFormaPago?: string;
  tipoDocumento: string;
}

export interface LineaPedido {
  secuencia: number;
  codigoArticulo: string;
  descripcion: string;
  cantidad: number;
  unidad: 'kg' | 'cajas' | 'envases' | 'unidades';
  precioUnitario: number;
  descuento: number;
  importeTotal: number;
}

// ============================================
// COBRO
// ============================================
export type TipoCobro = 'albaran' | 'factura' | 'normal' | 'especial' | 'presupuesto';

export interface Cobro {
  id: string;
  codigoCliente: string;
  tipo: TipoCobro;
  fecha: string;
  importeTotal: number;
  importeCobrado: number;
  importePendiente: number;
  formaPago: string;
  observaciones?: string;
  esPresupuesto: boolean;
  convertidoAPedido?: boolean;
  numeroPedidoConvertido?: number;
}

// ============================================
// PROMOCIÓN
// ============================================
export type TipoPromocion = 'simple' | 'compuesta';
export type TipoAplicacion = 'cliente_especifico' | 'general';

export interface Promocion {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  tipo: TipoPromocion;
  tipoAplicacion: TipoAplicacion;
  fechaDesde: Date;
  fechaHasta: Date;
  activa: boolean;
  prioridad: number;
  condiciones: CondicionPromocion[];
  resultado: ResultadoPromocion;
  clientesAplicables?: string[];
}

export interface CondicionPromocion {
  tipo: 'cantidad_minima' | 'importe_minimo' | 'producto_especifico' | 'familia';
  valor: string | number;
  codigoProducto?: string;
  codigoFamilia?: string;
}

export interface ResultadoPromocion {
  tipo: 'descuento_porcentaje' | 'descuento_fijo' | 'producto_gratis' | 'precio_especial';
  valor: number;
  productoGratis?: string;
  cantidadGratis?: number;
}

// ============================================
// ESTADÍSTICAS
// ============================================
export interface EstadisticasAnuales {
  year: number;
  total: number;
  pagadas: number;
  pendientes: number;
  totalPagadas: number;
  totalPendientes: number;
  totalImporte: number;
}

export interface TopProducto {
  codigo: string;
  nombre: string;
  cantidad: number;
  importe: number;
  pedidos: number;
}

// ============================================
// HISTÓRICO DE VENTAS
// ============================================
export interface FiltrosHistorico {
  ano?: number;
  mes?: number;
  semana?: number;
  codigoArticulo?: string;
  descripcion?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

export interface VentaHistorico {
  fecha: string;
  codigoArticulo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  importeTotal: number;
  numeroAlbaran: number;
  numeroFactura?: number;
}

// ============================================
// RESPUESTAS API
// ============================================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  requestId?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  paginacion: {
    pagina: number;
    limite: number;
    total: number;
    totalPaginas: number;
  };
}
