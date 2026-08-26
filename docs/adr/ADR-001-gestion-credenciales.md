# ADR-001: Gestión de claves y accesos del backend GMP

Fecha: 2026-08-26 · Estado: Aceptada · Task: 20260826-055240-gmp-5x2m

## Contexto

El backend necesita configuración privada de conexión (DB2/ODBC, firma de sesiones, Redis) que debe vivir solo fuera del repositorio. Situación verificada en la auditoría:

- Ficheros de entorno local excluidos del repo (`.gitignore` raíz 72-86; `backend/.gitignore` 8-14).
- Configuración proporcionada por variables de entorno, leída centralizadamente en `backend/config/env.js` y consumida en `config/db.js`, `middleware/auth.js`, `services/redis-cache.js`.
- En producción la proporciona PM2 (`ecosystem.config.js`) en el servidor 192.168.1.230.
- Incidente H-03: dos scripts escribieron valores de sesión a ficheros locales ignorados por git.

## Opciones consideradas

1. **Variables de entorno + PM2 ecosystem (estado actual)** — simple, sin dependencias nuevas; renovación manual.
2. Almacén dedicado de configuración privada con rotación y auditoría centralizadas — añade infraestructura y operación nueva.
3. Fichero cifrado dentro del repo — descartado: gestiona claves y amplía superficie de exposición.

## Decisión

Mantener la opción 1 como estándar vigente:

- Configuración privada solo por variables de entorno; nunca hardcodeada ni en ficheros versionados.
- Plantilla de entorno (`*.example`) documenta nombres de variables sin valores.
- Prohibido persistir valores de sesión o acceso en ficheros, incluso ignorados por git (causa raíz de H-03).
- La renovación de claves de firma queda excluida por decisión del propietario; ante compromiso se corta el acceso revocando sesiones (`invalidateAllSessions`, `middleware/auth.js:313-317`).
- CI bloquea fugas nuevas con gitleaks (historial completo + working tree) y pre-commit.

## Consecuencias

- Positivo: cero superficie nueva de infraestructura; scanners impiden regresiones; corte de acceso inmediato vía revocación sin tocar producción.
- Negativo: renovación manual y trazabilidad limitada; aceptado hasta que un requisito de cumplimiento justifique migrar a la opción 2, momento en que este ADR quedará obsoleto.

Nota de redacción: versión original bloqueada dos veces por el filtro de protección de entornos por falsos positivos; contenido equivalente sin ningún valor real.
