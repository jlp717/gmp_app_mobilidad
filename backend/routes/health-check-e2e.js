const express = require("express");
const router = express.Router();
// GET /api/health-check-e2e — EARS: WHEN GET /api/health-check-e2e SHALL 200 {ok, ts, version}
router.get("/", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), version: "1.0" });
});
module.exports = router;