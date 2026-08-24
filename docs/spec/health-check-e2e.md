# Feature: health-check-e2e
## WHEN GET /api/health-check-e2e THE system SHALL responder 200 {ok:true, ts: ISO, version: "1.0"}
## IF auth missing THEN SHALL 401 tipado (no aplica aqui, endpoint publico readiness-like)