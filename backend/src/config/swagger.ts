/**
 * Swagger/OpenAPI Configuration for GMP App Backend
 * Provides interactive API documentation at /api-docs
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Application } from 'express';

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GMP Sales App - API',
      version: '2.0.0',
      description: `
## GMP Sales Mobility App - Backend API

API REST para la aplicación de movilidad de ventas GMP.

### Autenticación
Todas las rutas protegidas requieren un token HMAC-SHA256 en el header \`Authorization\`.

\`\`\`
Authorization: Bearer <token>
\`\`\`

### Rate Limiting
- Global: 2000 requests / 15 min
- Login: 5 requests / 15 min

### Formato de Respuesta
Todas las respuestas siguen el formato:
\`\`\`json
{
  "success": true|false,
  "data": { ... },
  "error": "mensaje de error (si aplica)"
}
\`\`\`
      `,
      contact: {
        name: 'GMP Dev Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:3334',
        description: 'Desarrollo local',
      },
      {
        url: 'https://api.gmp-app.com',
        description: 'Producción',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'HMAC-SHA256',
          description: 'Token HMAC-SHA256 obtenido en /api/auth/login',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Error message' },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            environment: { type: 'string', example: 'production' },
            version: { type: 'string', example: '2.0.0' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'vendedor01' },
            password: { type: 'string', example: '****' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            token: { type: 'string' },
            refreshToken: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                codigoVendedor: { type: 'string' },
                nombre: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
        CommissionSummary: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            years: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  year: { type: 'integer' },
                  totalSales: { type: 'number' },
                  totalCommissions: { type: 'number' },
                },
              },
            },
          },
        },
        ObjectivesSummary: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                vendorCode: { type: 'string' },
                year: { type: 'integer' },
                month: { type: 'integer' },
                objective: { type: 'number' },
                actual: { type: 'number' },
                percentage: { type: 'number' },
              },
            },
          },
        },
        DashboardData: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            salesTotal: { type: 'number' },
            clientsCount: { type: 'integer' },
            ordersCount: { type: 'integer' },
          },
        },
        PaginationParams: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
      parameters: {
        vendedorCode: {
          in: 'query',
          name: 'vendedorCode',
          schema: { type: 'string' },
          description: 'Código del vendedor (e.g., "5") o "ALL"',
          required: true,
        },
        year: {
          in: 'query',
          name: 'year',
          schema: { type: 'integer' },
          description: 'Año (e.g., 2025)',
        },
        month: {
          in: 'query',
          name: 'month',
          schema: { type: 'integer', minimum: 1, maximum: 12 },
          description: 'Mes (1-12)',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación y tokens' },
      { name: 'Dashboard', description: 'Métricas principales y KPIs' },
      { name: 'Commissions', description: 'Comisiones de vendedores' },
      { name: 'Objectives', description: 'Objetivos de venta' },
      { name: 'Clients', description: 'Gestión de clientes' },
      { name: 'Products', description: 'Catálogo de productos' },
      { name: 'Sales', description: 'Ventas y facturación' },
      { name: 'Deliveries', description: 'Entregas y repartidor' },
      { name: 'Routes', description: 'Rutero y planificación' },
      { name: 'Invoices', description: 'Facturas' },
      { name: 'System', description: 'Health checks y cache' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health check básico',
          security: [],
          responses: {
            200: {
              description: 'Server is healthy',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
          },
        },
      },
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Health check detallado con métricas',
          security: [],
          responses: {
            200: { description: 'Detailed health info with memory and cache stats' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login de usuario',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: {
              description: 'Login exitoso',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
            },
            401: { description: 'Credenciales inválidas' },
            429: { description: 'Demasiados intentos (rate limited)' },
          },
        },
      },
      '/api/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Renovar token de acceso',
          security: [],
          responses: {
            200: { description: 'Nuevo token generado' },
            401: { description: 'Refresh token inválido' },
          },
        },
      },
      '/api/dashboard/summary': {
        get: {
          tags: ['Dashboard'],
          summary: 'Resumen general del dashboard',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { $ref: '#/components/parameters/year' },
            { $ref: '#/components/parameters/month' },
          ],
          responses: {
            200: { description: 'Dashboard summary data' },
            401: { description: 'No autorizado' },
          },
        },
      },
      '/api/commissions/summary': {
        get: {
          tags: ['Commissions'],
          summary: 'Resumen de comisiones por vendedor',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { $ref: '#/components/parameters/year' },
          ],
          responses: {
            200: {
              description: 'Commission summary',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/CommissionSummary' } } },
            },
            401: { description: 'No autorizado' },
          },
        },
      },
      '/api/commissions/pay': {
        post: {
          tags: ['Commissions'],
          summary: 'Registrar pago de comisión (admin)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['vendedorCode', 'year', 'amount'],
                  properties: {
                    vendedorCode: { type: 'string' },
                    year: { type: 'integer' },
                    month: { type: 'integer' },
                    amount: { type: 'number' },
                    generatedAmount: { type: 'number' },
                    observaciones: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Pago registrado' },
            403: { description: 'No autorizado como admin' },
          },
        },
      },
      '/api/objectives/summary': {
        get: {
          tags: ['Objectives'],
          summary: 'Resumen de objetivos de venta',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { $ref: '#/components/parameters/year' },
            { $ref: '#/components/parameters/month' },
          ],
          responses: {
            200: { description: 'Objectives summary' },
            401: { description: 'No autorizado' },
          },
        },
      },
      '/api/clientes/list': {
        get: {
          tags: ['Clients'],
          summary: 'Listado de clientes del vendedor',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            200: { description: 'Client list with pagination' },
          },
        },
      },
      '/api/productos/list': {
        get: {
          tags: ['Products'],
          summary: 'Catálogo de productos',
          responses: {
            200: { description: 'Product list' },
          },
        },
      },
      '/api/ventas/summary': {
        get: {
          tags: ['Sales'],
          summary: 'Resumen de ventas',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { $ref: '#/components/parameters/year' },
            { $ref: '#/components/parameters/month' },
          ],
          responses: {
            200: { description: 'Sales summary' },
          },
        },
      },
      '/api/entregas/list': {
        get: {
          tags: ['Deliveries'],
          summary: 'Listado de entregas',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDIENTE', 'ENTREGADO', 'RECHAZADO'] } },
          ],
          responses: {
            200: { description: 'Delivery list' },
          },
        },
      },
      '/api/repartidor/deliveries': {
        get: {
          tags: ['Deliveries'],
          summary: 'Entregas asignadas al repartidor',
          responses: {
            200: { description: 'Repartidor deliveries' },
          },
        },
      },
      '/api/facturas/list': {
        get: {
          tags: ['Invoices'],
          summary: 'Listado de facturas',
          parameters: [
            { $ref: '#/components/parameters/vendedorCode' },
            { in: 'query', name: 'clientCode', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Invoice list' },
          },
        },
      },
      '/api/rutero/routes': {
        get: {
          tags: ['Routes'],
          summary: 'Rutas del vendedor',
          parameters: [{ $ref: '#/components/parameters/vendedorCode' }],
          responses: {
            200: { description: 'Route list' },
          },
        },
      },
      '/api/cobros/summary': {
        get: {
          tags: ['Sales'],
          summary: 'Resumen de cobros',
          parameters: [{ $ref: '#/components/parameters/vendedorCode' }],
          responses: {
            200: { description: 'Cobros summary' },
          },
        },
      },
      '/api/pedidos/list': {
        get: {
          tags: ['Sales'],
          summary: 'Listado de pedidos',
          parameters: [{ $ref: '#/components/parameters/vendedorCode' }],
          responses: {
            200: { description: 'Order list' },
          },
        },
      },
      '/api/cache/stats': {
        get: {
          tags: ['System'],
          summary: 'Estadísticas de cache',
          responses: {
            200: { description: 'Cache statistics' },
          },
        },
      },
    },
  },
  apis: [], // Routes are defined inline above
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

/**
 * Setup Swagger documentation middleware
 */
export function setupSwagger(app: Application): void {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'GMP App - API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  }));

  // Serve raw OpenAPI spec as JSON
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export { swaggerSpec };
