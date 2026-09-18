'use strict';

const express = require('express');
const { z } = require('zod');
const logger = require('../middleware/logger');
const { createRateLimiter } = require('../middleware/security');
const { randomUUID, normalize } = require('./telemetry-privacy-policy');

const router = express.Router();

const rumLimiter = createRateLimiter({
    prefix: 'rum',
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Demasiados eventos RUM', code: 'RUM_RATE_LIMIT' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.user?.code || 'anon',
});

const rumEventSchema = z.object({
    screen: z.string().max(80).nullish(),
    endpoint: z.string().max(200),
    method: z.string().max(10),
    status: z.number().int().min(100).max(599).nullable().optional(),
    t_req: z.number(),
    t_resp: z.number().optional(),
    t_parsed: z.number().optional(),
    t_render: z.number().optional(),
    bytes: z.number().int().nonnegative().nullable().optional(),
    net: z.string().max(16).nullish(),
    rid: z.string().max(80).nullish(),
}).strict();

const rumBodySchema = z.object({
    events: z.array(rumEventSchema).min(1).max(50),
}).strict();

function handleRumPost(req, res) {
    const parsed = rumBodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'INVALID_RUM_PAYLOAD', code: 'INVALID_RUM_PAYLOAD' });
    }
    const batchId = randomUUID();
    for (const ev of parsed.data.events) {
        const safe = normalize(ev);
        logger.info(JSON.stringify({
            t: 'rum',
            id: batchId,
            u: null,
            ...safe,
        }));
    }
    return res.status(200).json({ ok: true, n: parsed.data.events.length });
}

router.post('/rum', rumLimiter, handleRumPost);

module.exports = router;
module.exports.rumLimiter = rumLimiter;
module.exports.rumBodySchema = rumBodySchema;
module.exports.handleRumPost = handleRumPost;
