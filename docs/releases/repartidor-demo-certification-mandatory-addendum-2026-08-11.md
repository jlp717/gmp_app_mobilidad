# Addendum obligatorio del plan de certificación Repartidor

Este archivo forma parte inseparable de `repartidor-demo-certification-plan-2026-08-11.md`. Sus reglas prevalecen ante cualquier ambigüedad del plan maestro. La release no puede declararse completa si no se ejecutan ambos documentos.

## A. Cambio autorizado de toggles efectivos

La siguiente IA no puede limitarse a «editar `.env`»:

1. Determinar por evidencia la fuente efectiva de cada clave: `GMP_ENV_FILE`, dotenv elegido por startup, ecosystem versionado, variables heredadas por PM2 o `pm2_env` persistido.
2. Generar `clave -> fuente -> valor no secreto esperado -> valor efectivo en cada worker`.
3. Si procede de código/ecosystem versionado, cambiarlo localmente, revisarlo, hacer commit/push y desplegar mediante el pull/restart autorizados.
4. Si procede de `.env` o estado PM2 no versionado, detenerse y obtener autorización fresca de Javier para modificar exactamente ese path/estado. La autorización de `git pull origin test` y `pm2 restart gmp-api` no autoriza editar `.env` ni ejecutar `pm2 set/save/start/reload`.
5. Tras autorización: backup protegido con permisos/hash, cambio atómico solo de claves allowlisted, diff redactado, restart únicamente de `gmp-api`, comparación de los ocho workers, readiness y prueba del endpoint activado.
6. Preparar restauración atómica de las claves anteriores y exigir autorización antes de aplicarla.
7. Si no hay permiso, usar TEST/staging separado. No demostrar escrituras contra producción con capabilities apagadas.

Inspeccionar `/opt/gmp-api/backend/.env` no basta: manda el entorno efectivo de PM2.

## B. DB2 sin DELETE

Queda prohibido `DELETE`, también en tablas TEST. También se prohíben `TRUNCATE`, cleanup general y borrados manuales.

Niveles de prueba:

1. Repositorio/integración: una conexión, caso completo y `ROLLBACK`; otra conexión confirma que nada quedó comprometido.
2. HTTP/Flutter E2E falso: adapters deterministas sin DB2 real.
3. E2E DB2 TEST multi-request: registros append-only en `JAVIER.TEST_*` con `TEST_RUN_ID`/token único, excluidos de selectores productivos. No se borran; se documenta su retención.
4. Si TEST no permite distinguirlos inequívocamente, no insertar: diseñar primero una columna/tabla TEST aditiva, revisar DDL y pedir autorización.
5. Probar ausencia de DELETE con scan estático y captura de statements del fake driver.

Toda referencia del plan a «cleanup» significa exclusivamente rollback o retención append-only; nunca DELETE.

## C. Oráculo independiente de deuda/liquidación

Flutter y API pueden coincidir y estar ambos mal. Crear un caso dorado:

1. Reservar repartidor, fecha y documentos compuestos conocidos.
2. Leer de DB2 las fuentes crudas: saldo inicial, confirmaciones/líneas, estados, pendientes, cobros, gastos, ajustes firmados e ingresos bancarios.
3. Congelar evidencia redactada; no usar como esperado la salida del servicio probado.
4. Calcular en script independiente o hoja, usando céntimos enteros/Decimal y la fórmula/redondeo de negocio aprobados; nunca `double` implícito.
5. Incluir Europe/Madrid, borde de día, parcial, no realizada y cobro en límite horario.
6. Comparar céntimo a céntimo subtotales, pendiente, cobrado, gastos, ingresos, ajustes, saldo anterior/final, IDs liquidados, snapshot, audit y outbox.
7. Repetir antes del cierre, después y desde otra sesión.
8. Un céntimo, documento o estado discrepante bloquea la release.

## D. Resolver los cambios Git sin perder trabajo

Cada path del inventario debe acabar en un único destino:

| Destino | Acción |
|---|---|
| Release Repartidor | Commit temático allowlisted en la rama de release |
| Cambio legítimo ajeno | Commit y push en rama de preservación separada |
| Generado reproducible | `.gitignore` revisado; retirar solo con aprobación |
| Scratch/backup | Archivo recuperable fuera del checkout + hashes |
| APK/binario | Canal de artefactos + SHA-256; Git solo si la política lo exige |
| Secreto/dato de negocio | Almacén privado autorizado; nunca push |
| Desconocido | BLOCK hasta identificar propietario/finalidad |

Procedimiento:

1. Manifiesto NUL-safe de paths/estados/tamaños/hashes no sensibles.
2. Crear worktree de release separado desde `origin/test`; no limpiar el checkout original.
3. Incorporar solo commits temáticos allowlisted.
4. Preservar trabajo ajeno en `codex/repartidor-preserve-<fecha>` con staging path-by-path y push verificado.
5. Archivar untracked no versionables fuera del repo; no incluir secretos sin almacén cifrado aprobado.
6. La unión de commits release + preservación + archivo + generados ignorados debe contener el 100% del inventario inicial.
7. Solo con aprobación sobre la lista exacta retirar generados/scratch ya preservados.
8. Prohibidos `assume-unchanged`, `skip-worktree` y `git add -A`.
9. Evidencia final: conteos antes/después y `git status --porcelain=v2` vacío en release y en el checkout que seguirá usando Javier.

## E. Teléfono exacto y datos reservados para la demo

Certificar el dispositivo real:

- modelo, Android, ABI y espacio;
- APK release firmado, versionName/versionCode/SHA-256;
- instalación limpia y upgrade si aplica;
- API URL efectiva, HTTPS/TLS, reloj y Europe/Madrid;
- Wi-Fi/datos y recuperación offline;
- cámara, ubicación, archivos/media y notificaciones requeridos;
- firma, foto/evidencia, PDF, descarga y share sheet;
- impresora/Zebra si la acción será visible;
- orientación, tamaño de pantalla y fuente sin overflow;
- relogin tras borrar datos/rotar JWT;
- logout sin estado residual.

Reservar tres datasets diferentes: `ENSAYO_A`, `ENSAYO_B` y `DEMO_REAL`. Cada uno necesita repartidor, cliente, documento compuesto, líneas, estado, cobrabilidad, importe e idempotency keys propios. Antes de usarlo, comprobar en solo lectura que sigue sin confirmar/liquidar. No editar DB2 manualmente ni reutilizar casos consumidos.

Diez minutos antes:

1. health/readiness;
2. flags efectivos de los ocho workers;
3. `DEMO_REAL` intacto en solo lectura;
4. login sin consumir el pedido;
5. vídeo/capturas del ensayo solo como contingencia claramente etiquetada.

Si el teléfono o `DEMO_REAL` no cumplen, el GO queda revocado.

## F. Condición de cierre añadida

El manifiesto final del plan maestro debe añadir:

```json
{
  "effectiveToggleSourceVerified": true,
  "toggleChangeAuthorized": true,
  "db2DeleteStatements": 0,
  "liquidationGoldenOracleExact": true,
  "initialGitPathsAccountedFor": true,
  "unrelatedWorkLost": false,
  "physicalDemoDeviceCertified": true,
  "reservedDatasetsAvailable": 3
}
```

La revisión independiente de este addendum es obligatoria antes de ejecutar el plan.
