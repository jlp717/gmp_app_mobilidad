import { Router } from 'express';
const router = Router();
router.get('/products', (_req, res) => res.json({ success: true, data: [] }));
router.get('/vendedores', (_req, res) => res.json({ success: true, data: [] }));
export { router as masterRoutes };
