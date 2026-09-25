# Backend testing setup — requisito unixODBC (`libodbc.so.2`)

> Alcance: suite completa Jest del backend (`npm test` / `npm run test:ci`).
> Rama de trabajo: `test`. No aplica a producción.

## 1. Requisito

El paquete nativo `odbc@^2.5.0` (ver `backend/package.json`) enlaza contra
unixODBC en tiempo de carga. Sin la librería del sistema, Jest no puede
cargar el módulo y **71 suites no cargan** (fallo en `require('odbc')` con
`libodbc.so.2: cannot open shared object file`).

Esto es dependencia de sistema, no de npm. `npm ci` por sí solo NO la resuelve.

## 2. Comandos exactos — Ubuntu (CI runner `ubuntu-latest`)

Copy-paste:

```bash
sudo apt-get update && sudo apt-get install -y unixodbc unixodbc-dev
```

Verificación:

```bash
ldconfig -p | grep libodbc
# esperado: libodbc.so.2 => /lib/x86_64-linux-gnu/libodbc.so.2 (ruta según distro)
odbcinst -q -d
```

Orden en CI: instalar **antes** de `npm ci` en los jobs que ejecutan tests:

- `.github/workflows/backend-ci.yml` → job `test`
- `.github/workflows/ci-cd.yml` → job `backend-test`

## 3. Nota IBM i Access ODBC (solo si aplica)

`unixodbc` + `unixodbc-dev` bastan para **cargar** el módulo y ejecutar la
suite completa (los tests usan mocks/stubs y no abren conexiones reales DB2).

El driver IBM i Access ODBC (`ibm-iaccess` / `libibm_db2i`) solo es necesario
si se quiere conexión real contra DB2 for i (`DSEDAC`/`JAVIER`). No se instala
en CI, no hay secretos en CI, y ningún test de la suite completa debe abrir
conexiones reales.

## 4. Qué pasa sin ello

| Estado | Síntoma | Alcance |
|---|---|---|
| Sin `unixodbc` | `Error: libodbc.so.2: cannot open shared object file` al hacer `require('odbc')` | 71 suites no cargan, Jest reporta failure en carga |
| Con `unixodbc` + `unixodbc-dev` | `require('odbc')` carga, suite completa ejecutable | `npm run test:ci -- --coverage` verde (salvo fallos reales de código) |
| Solo `unixodbc` sin `-dev` | Carga en runtime OK, pero compilación nativa de `odbc` puede fallar en `npm ci` | Instalar ambos paquetes siempre |

## 5. Alternativa sin `apt` (runner Windows / local Windows)

Si el runner no tiene `apt` (p. ej. `windows-latest`):

1. No usar `sudo apt-get`. En Windows el driver se instala vía
   *IBM i Access Client Solutions — Windows ODBC driver* o el
   *ODBC Driver Manager* correspondiente.
2. En CI se recomienda mantener los jobs de backend-test en `ubuntu-latest`
   (estado actual) y no migrarlos a Windows sin instalar el equivalente.
3. Local Windows sin driver: la suite completa no cargará; usar WSL2 Ubuntu
   con el comando del apartado 2.

## 6. Referencia Prompt2 (cross-check anti-duplicado)

Verificado 2026-09-25 (WS2-ENV): ningún workflow instalaba `unixODBC`
(`grep -ri "unixodbc|libodbc|odbc"` en `.github/workflows/` sin matches antes
del cambio). Si un Prompt2 posterior añade el mismo paso, no duplicar:
mantener un único step `Install unixODBC` por job, antes de `npm ci`.

## 7. Enlaces

- `backend/README.md` → sección testing enlaza aquí.
- Workflows: `backend-ci.yml` (job `test`), `ci-cd.yml` (job `backend-test`).
