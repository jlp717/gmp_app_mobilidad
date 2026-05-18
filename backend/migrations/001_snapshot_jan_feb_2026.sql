-- =============================================================================
-- MIGRATION 001: Snapshot de comisiones Enero/Febrero 2026
-- =============================================================================
-- Propósito: Preservar una copia inmutable de los pagos de comisiones
-- de enero y febrero de 2026 antes de activar la nueva lógica de
-- columna de vendedor (LCCDVD -> R1_T8CDVD) desde marzo 2026.
--
-- Idempotente: Se puede ejecutar múltiples veces sin duplicar datos.
-- Motor: DB2 (esquema JAVIER)
-- Fecha: 2026-03-02
-- =============================================================================

-- 1. Crear tabla de snapshot (si no existe)
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '42710' BEGIN END;
    EXECUTE IMMEDIATE '
        CREATE TABLE JAVIER.COMMISSION_SNAPSHOT_2026_0102 (
            SNAPSHOT_ID INT NOT NULL GENERATED ALWAYS AS IDENTITY,
            ORIGINAL_ID INT NOT NULL,
            VENDEDOR_CODIGO VARCHAR(10) NOT NULL,
            ANIO INT NOT NULL,
            MES INT NOT NULL,
            VENTAS_REAL DECIMAL(14,2) NOT NULL DEFAULT 0,
            OBJETIVO_MES DECIMAL(14,2) NOT NULL DEFAULT 0,
            VENTAS_SOBRE_OBJETIVO DECIMAL(14,2) NOT NULL DEFAULT 0,
            COMISION_GENERADA DECIMAL(12,2) NOT NULL DEFAULT 0,
            IMPORTE_PAGADO DECIMAL(12,2) NOT NULL DEFAULT 0,
            FECHA_PAGO TIMESTAMP,
            OBSERVACIONES VARCHAR(1000) NOT NULL DEFAULT '''',
            CREADO_POR VARCHAR(50) NOT NULL DEFAULT ''unknown'',
            FECHA_CREACION TIMESTAMP,
            SNAPSHOT_FECHA TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (SNAPSHOT_ID)
        )
    ';
END;

-- 2. Crear índice para búsquedas rápidas
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLSTATE '42710' BEGIN END;
    EXECUTE IMMEDIATE '
        CREATE INDEX JAVIER.IDX_SNAP_2026_VENDOR
        ON JAVIER.COMMISSION_SNAPSHOT_2026_0102 (VENDEDOR_CODIGO, MES)
    ';
END;

-- 3. Insertar datos de forma idempotente (solo si no existe ya el registro)
INSERT INTO JAVIER.COMMISSION_SNAPSHOT_2026_0102 (
    ORIGINAL_ID, VENDEDOR_CODIGO, ANIO, MES,
    VENTAS_REAL, OBJETIVO_MES, VENTAS_SOBRE_OBJETIVO,
    COMISION_GENERADA, IMPORTE_PAGADO, FECHA_PAGO,
    OBSERVACIONES, CREADO_POR, FECHA_CREACION
)
SELECT
    CP.ID, CP.VENDEDOR_CODIGO, CP.ANIO, CP.MES,
    CP.VENTAS_REAL, CP.OBJETIVO_MES, CP.VENTAS_SOBRE_OBJETIVO,
    CP.COMISION_GENERADA, CP.IMPORTE_PAGADO, CP.FECHA_PAGO,
    CP.OBSERVACIONES, CP.CREADO_POR, CP.FECHA_CREACION
FROM JAVIER.COMMISSION_PAYMENTS CP
WHERE CP.ANIO = 2026
  AND CP.MES IN (1, 2)
  AND NOT EXISTS (
      SELECT 1 FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102 S
      WHERE S.ORIGINAL_ID = CP.ID
  );

-- =============================================================================
-- VERIFICACIÓN: Ejecutar después de la migración para confirmar datos
-- =============================================================================
-- SELECT MES, COUNT(*) as REGISTROS, SUM(IMPORTE_PAGADO) as TOTAL_PAGADO
-- FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
-- GROUP BY MES
-- ORDER BY MES;
-- =============================================================================
