-- schema.sql: Esquema PostgreSQL para el sistema KPI Glacius
-- Ejecutar con: psql -U kpi_user -d kpi_glacius -f schema.sql

BEGIN;

-- ============================================================
-- Tabla de cargas (idempotencia semanal)
-- ============================================================
CREATE TABLE IF NOT EXISTS kpi_loads (
    id              SERIAL PRIMARY KEY,
    load_id         VARCHAR(32) NOT NULL UNIQUE,   -- formato: YYYY-WNN (ej: 2026-W10)
    status          VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, COMPLETED, FAILED
    files_processed TEXT[],                         -- lista de CSVs procesados
    total_alerts    INTEGER DEFAULT 0,
    errors          JSONB DEFAULT '[]'::jsonb,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    checksum        VARCHAR(128),                   -- hash SHA256 del conjunto de archivos
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kpi_loads_load_id ON kpi_loads (load_id);
CREATE INDEX idx_kpi_loads_status ON kpi_loads (status);

-- ============================================================
-- Tabla de alertas KPI por cliente
-- ============================================================
CREATE TABLE IF NOT EXISTS kpi_alerts (
    id              SERIAL PRIMARY KEY,
    load_id         VARCHAR(32) NOT NULL REFERENCES kpi_loads(load_id) ON DELETE CASCADE,
    client_code     VARCHAR(20) NOT NULL,           -- CodigoInterno del cliente
    alert_type      VARCHAR(40) NOT NULL,           -- DESVIACION_VENTAS, CUOTA_SIN_COMPRA, etc.
    severity        VARCHAR(10) NOT NULL DEFAULT 'warning', -- critical, warning, info
    message         TEXT NOT NULL,                   -- Mensaje formateado según reglas
    raw_data        JSONB,                          -- Datos brutos de la fila CSV
    source_file     VARCHAR(100) NOT NULL,          -- Nombre del CSV origen
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at      TIMESTAMPTZ,                    -- Caducidad (próxima carga reemplaza)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kpi_alerts_client ON kpi_alerts (client_code);
CREATE INDEX idx_kpi_alerts_load ON kpi_alerts (load_id);
CREATE INDEX idx_kpi_alerts_type ON kpi_alerts (alert_type);
CREATE INDEX idx_kpi_alerts_active ON kpi_alerts (is_active, client_code);
CREATE INDEX idx_kpi_alerts_severity ON kpi_alerts (severity);
CREATE INDEX idx_kpi_alerts_created ON kpi_alerts (created_at DESC);

-- Indice compuesto para la consulta principal de la API
CREATE INDEX idx_kpi_alerts_client_active ON kpi_alerts (client_code, is_active, severity, created_at DESC);

-- ============================================================
-- Tabla de metadatos de archivos procesados (auditoría)
-- ============================================================
CREATE TABLE IF NOT EXISTS kpi_file_audit (
    id              SERIAL PRIMARY KEY,
    load_id         VARCHAR(32) NOT NULL REFERENCES kpi_loads(load_id) ON DELETE CASCADE,
    filename        VARCHAR(100) NOT NULL,
    file_size       BIGINT,
    file_hash       VARCHAR(128),                   -- SHA256 del archivo
    rows_total      INTEGER DEFAULT 0,
    rows_parsed     INTEGER DEFAULT 0,
    rows_skipped    INTEGER DEFAULT 0,
    alerts_generated INTEGER DEFAULT 0,
    parse_errors    JSONB DEFAULT '[]'::jsonb,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kpi_file_audit_load ON kpi_file_audit (load_id);

-- ============================================================
-- Vista materializada para alertas activas (rendimiento)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS kpi_alerts_active AS
SELECT
    a.id,
    a.client_code,
    a.alert_type,
    a.severity,
    a.message,
    a.source_file,
    a.created_at,
    a.raw_data
FROM kpi_alerts a
WHERE a.is_active = TRUE
ORDER BY
    CASE a.severity
        WHEN 'critical' THEN 1
        WHEN 'warning'  THEN 2
        WHEN 'info'     THEN 3
    END,
    a.created_at DESC;

CREATE UNIQUE INDEX idx_kpi_alerts_active_mv_id ON kpi_alerts_active (id);
CREATE INDEX idx_kpi_alerts_active_mv_client ON kpi_alerts_active (client_code);

COMMIT;
