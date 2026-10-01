'use strict';

const express = require('express');
const {
  PrecioCompetitivoError,
  createPrecioCompetitivoService,
} = require('../services/precio-competitivo-service');

function sendFailure(res, error) {
  if (error instanceof PrecioCompetitivoError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      error: error.message,
      found: false,
      precioCompetitivo: null,
      margenPct: null,
    });
  }
  return res.status(500).json({
    success: false,
    code: 'PRECIO_COMPETITIVO_UNAVAILABLE',
    error: 'No se pudo consultar el precio competitivo. Reinténtalo más tarde.',
    found: false,
    precioCompetitivo: null,
    margenPct: null,
  });
}

function createPrecioCompetitivoRouter(service = createPrecioCompetitivoService()) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await service.lookup({
        codigoArticulo: req.query.codigoArticulo,
        codigoCliente: req.query.codigoCliente,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await service.create(req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  return router;
}

module.exports = {
  createPrecioCompetitivoRouter,
};
