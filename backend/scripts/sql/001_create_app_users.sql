-- ============================================
-- CREAR TABLA APP_USERS PARA GESTIONAR ROLES
-- ============================================
-- Ejecutar en IBM i (ACS)
-- Esta tabla permite asignar roles a usuarios

-- 1. CREAR TABLA
CREATE TABLE JAVIER.APP_USERS (
  CODIGO VARCHAR(10) NOT NULL PRIMARY KEY,
  ROL VARCHAR(20) NOT NULL DEFAULT 'COMERCIAL',
  -- Valores: 'JEFE', 'COMERCIAL', 'REPARTIDOR'
  DESCRIPCION VARCHAR(100),
  ACTIVO CHAR(1) DEFAULT 'S',
  FECHA_ALTA TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. INSERTAR GOYO COMO JEFE
INSERT INTO JAVIER.APP_USERS (CODIGO, ROL, DESCRIPCION) 
VALUES ('01', 'JEFE', 'GOYO - Jefe de Ventas Principal');

-- 3. INSERTAR TUS REPARTIDORES
-- Cuando tengas repartidores, insértalos así:
-- INSERT INTO JAVIER.APP_USERS (CODIGO, ROL, DESCRIPCION) 
-- VALUES ('R01', 'REPARTIDOR', 'Nombre del Repartidor 1');
-- 
-- INSERT INTO JAVIER.APP_USERS (CODIGO, ROL, DESCRIPCION) 
-- VALUES ('R02', 'REPARTIDOR', 'Nombre del Repartidor 2');

-- 4. COMERCIALES (opcionales - por defecto todos son comerciales)
-- Solo inserta si quieres dar permisos especiales
-- INSERT INTO JAVIER.APP_USERS (CODIGO, ROL) VALUES ('02', 'COMERCIAL');

-- ============================================
-- CONSULTAS ÚTILES
-- ============================================

-- Ver todos los roles asignados:
-- SELECT * FROM JAVIER.APP_USERS ORDER BY ROL, CODIGO;

-- Ver jefes:
-- SELECT * FROM JAVIER.APP_USERS WHERE ROL = 'JEFE';

-- Ver repartidores:
-- SELECT * FROM JAVIER.APP_USERS WHERE ROL = 'REPARTIDOR';
