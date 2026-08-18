---
name: node-backend-patterns
description: Node.js/Express backend patterns for GMP project. Covers route structure, service layer, DB2 integration, auth middleware, and error handling.
---

# Node.js Backend Patterns — GMP Project

## Project Structure
```
backend/
├── server.js              # Entry point
├── config/
│   ├── database.js        # DB2 ODBC connection (DO NOT MODIFY)
│   └── auth.js            # JWT configuration
├── middleware/
│   ├── authMiddleware.js  # JWT validation (DO NOT MODIFY)
│   ├── logger.js          # Winston logger
│   └── audit.js           # Audit logging
├── routes/
│   ├── auth.js            # Login, refresh, logout
│   ├── pedidos.js         # Orders API
│   ├── cobros.js          # Payments API
│   └── ...
├── services/
│   ├── authService.js     # Auth business logic
│   ├── pedidosService.js  # Orders business logic
│   └── ...
└── __tests__/             # Jest tests
```

## Route Pattern
```javascript
// routes/pedidos.js
const express = require('express');
const router = express.Router();
const pedidosService = require('../services/pedidosService');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const logger = require('../middleware/logger');

// All routes require authentication
router.use(authenticate);

// GET /api/pedidos — List orders
router.get('/', async (req, res, next) => {
  try {
    const { vendedor, fecha, page = 1, limit = 50 } = req.query;

    // Authorization: check user can access this data
    if (req.user.role !== 'JEFE_VENTAS' && req.user.vendedor !== vendedor) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pedidosService.getPedidos({
      vendedor,
      fecha,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json(result);
  } catch (error) {
    logger.error('pedidos.list', { error: error.message, userId: req.user.id });
    next(error);
  }
});

// GET /api/pedidos/:id — Single order
router.get('/:id', async (req, res, next) => {
  try {
    const pedido = await pedidosService.getPedidoById(req.params.id);
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido not found' });
    }
    res.json(pedido);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

## Service Pattern
```javascript
// services/pedidosService.js
const db = require('../config/database');
const logger = require('../middleware/logger');

class PedidosService {
  async getPedidos({ vendedor, fecha, page, limit }) {
    const offset = (page - 1) * limit;

    // Vendor 'ALL' special handling
    const vendorFilter = vendedor === 'ALL' ? '' : 'AND VENDEDOR = ?';

    const sql = `
      SELECT
        PEDIDO_ID, CLIENTE, FECHA, IMPORTE, STATUS
      FROM JAVIER.PEDIDOS
      WHERE ORDEN >= 0
        ${vendorFilter}
        ${fecha ? 'AND FECHA = ?' : ''}
      ORDER BY FECHA DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const params = [];
    if (vendedor !== 'ALL') params.push(vendedor);
    if (fecha) params.push(fecha);
    params.push(limit);

    logger.debug('pedidosService.getPedidos', { sql: sql.substring(0, 100), params: params.map(p => typeof p) });

    const rows = await db.query(sql, params);

    // Get total count for pagination
    const countSql = `
      SELECT COUNT(*) AS TOTAL
      FROM JAVIER.PEDIDOS
      WHERE ORDEN >= 0 ${vendorFilter} ${fecha ? 'AND FECHA = ?' : ''}
    `;
    const countParams = [];
    if (vendedor !== 'ALL') countParams.push(vendedor);
    if (fecha) countParams.push(fecha);
    const [{ TOTAL }] = await db.query(countSql, countParams);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: TOTAL,
        pages: Math.ceil(TOTAL / limit)
      }
    };
  }

  async getPedidoById(id) {
    const sql = `
      SELECT p.*, c.NOMBRE AS CLIENTE_NOMBRE
      FROM JAVIER.PEDIDOS p
      LEFT JOIN CLI.CLIENTES c ON p.CLIENTE = c.CODIGO
      WHERE p.PEDIDO_ID = ?
    `;
    const [row] = await db.query(sql, [id]);
    return row || null;
  }
}

module.exports = new PedidosService();
```

## Error Handling Pattern
```javascript
// Custom error classes
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database error') {
    super(message, 500);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

// Global error handler (in server.js)
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message
    });
  }

  // Don't leak internal errors to client
  res.status(500).json({
    error: 'Internal server error'
  });
});
```

## Auth Middleware Usage
```javascript
// Authentication only
router.get('/data', authenticate, async (req, res) => {
  // req.user is available
});

// Authentication + Role check
router.post('/admin', authenticate, authorize(['JEFE_VENTAS']), async (req, res) => {
  // Only JEFE_VENTAS can access
});

// Authentication + Owner check
router.get('/pedidos/:id', authenticate, async (req, res) => {
  const pedido = await service.getById(req.params.id);
  if (pedido.VENDEDOR !== req.user.vendedor && req.user.role !== 'JEFE_VENTAS') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json(pedido);
});
```

## Testing Pattern
```javascript
// __tests__/pedidos.test.js
jest.mock('../config/database', () => ({
  query: jest.fn()
}));

const db = require('../config/database');
const pedidosService = require('../services/pedidosService');

describe('PedidosService', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  describe('getPedidos', () => {
    it('returns paginated results for specific vendor', async () => {
      db.query.mockResolvedValueOnce([
        { PEDIDO_ID: '1', CLIENTE: 'C001', IMPORTE: 100 }
      ]);
      db.query.mockResolvedValueOnce([{ TOTAL: 1 }]);

      const result = await pedidosService.getPedidos({
        vendedor: 'V001',
        page: 1,
        limit: 50
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('AND VENDEDOR = ?'),
        expect.arrayContaining(['V001', 50])
      );
    });

    it('queries all vendors when vendedor is ALL', async () => {
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([{ TOTAL: 0 }]);

      await pedidosService.getPedidos({
        vendedor: 'ALL',
        page: 1,
        limit: 50
      });

      // Verify NO vendor filter in SQL
      const callArgs = db.query.mock.calls[0];
      expect(callArgs[0]).not.toContain('AND VENDEDOR = ?');
    });
  });
});
```

## Project Rules

- **NEVER** modify `backend/config/database.js` or `backend/middleware/authMiddleware.js`
- **ALWAYS** use parameterized queries (no string concatenation)
- **ALWAYS** qualify table names with schema (`JAVIER.PEDIDOS`, not `PEDIDOS`)
- **ALWAYS** handle vendor 'ALL' special case
- **ALWAYS** filter `ORDEN >= 0` in RUTERO_CONFIG queries
- **ALWAYS** log errors with context (userId, action, params types)
- **NEVER** log full SQL with parameter values (security risk)
- **ALWAYS** use defense in depth: auth in middleware AND in service
