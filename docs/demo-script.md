# Guion reproducible de demo comercial — 02/11/2026

**Estado del ensayo al 04/11/2026 · PARTIAL.** El servidor instalado devuelve HTTP 200 en `/api/ready`, pero mantiene la revisión `4a36ddde` con escritura aislada en TEST. La revisión instalada aún no expone el perfil público que espera el APK 105. Consulta `docs/orders-demo-report.md` antes de ejecutar. Usa un comercial y registros reales con sus importes documentales. Cualquier paso con error o sin evidencia detiene la aceptación.

El run comenzó el 02/11/2026, Europe/Madrid. Los cobros y liquidaciones se validan con la fecha de negocio real del servidor. El 02/11 es un periodo histórico. Mantén el reloj del servidor y registra cualquier ensayo nuevo en su fecha real.

## Preparación y guardas

1. Confirmar que la versión instalada corresponde al commit entregado y que el entorno activo es TEST/DEMO con lecturas DSEDAC/DSED y escrituras **JAVIER.TEST_***. Mantener exportación CPC/LPC/OCPC deshabilitada. No cambiar NODE_ENV a production mientras las escrituras estén aisladas.
2. Ejecutar la comprobación de entorno disponible en la versión entregada y conservar su salida. Si falta `env:verify`, la preparación no pasa.
3. Comprobar `/api/ready` con el agente GMP-SRE-HealthCheck/1.0. La comprobación del 04/11 obtuvo HTTP 200 y cobertura de PIN de 68 sobre 68 vendedores activos. Verificar también que el APK identifica el perfil esperado mediante `/api/runtime-profile`.
4. Seleccionar vendedor con umbral ERP comprobado de 3. La columna es TEST_VDDX.PEDIDOSPENDIENTESSINCRONIZAR en isolated_test; no alterar el valor silenciosamente. Obtener cliente con precio especial y documento cobrable desde registros reales.
5. Guardar instantánea SELECT de pedidos/reservas/bolsa/cobros/liquidación y ejecutar reconciliación. La tabla competitiva ya contiene dos filas acreditadas del pedido 106 (artículos 3519 y 3075, cliente 4300032160); volver a leerlas y no presentar una tarifa como si fuera un último precio registrado. La sonda de semilla inicial requiere tabla vacía y no se repite.
6. Conectar teléfono y tablet/emulador. Ejecutar perfil de rendimiento; conservar identificador de dispositivo, modo profile, versión, orientación y escala de texto. Sin dispositivo, la aceptación móvil queda bloqueada.

La preparación se puede comprobar por separado. Desde `backend`, ejecuta primero la validación de configuración y después la de catálogo.

```powershell
npm run env:verify -- --no-db
npm run env:verify
```

Desde la raíz, comprueba el servidor y registra la reconciliación previa. Guarda cada salida con la fecha del ensayo. Cualquier error o perfil distinto de TEST/DEMO detiene el recorrido de escritura.

```powershell
ssh gmp@192.168.1.230 'curl --fail --max-time 8 -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready'
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\audits\orders-tablet-20261102\read-commercial-integrity.ps1
```

El artículo 2974 del cliente 4300032888, asignado al comercial 73, dio un precio especial de 29,28 € en la lectura de ERP. Confirma su vigencia antes de la demo. El artículo 3075 del cliente 4300032160 tiene un competitivo de 49,572 € procedente del pedido 106. Son dos comprobaciones diferentes. Conserva el cliente y el artículo de cada registro al comparar el valor de pantalla.

## Recorrido y comprobaciones

| Paso | Acción del comercial | Evidencia necesaria |
|---|---|---|
| 1 | Iniciar sesión; abrir cliente real con precio especial; buscar por código/nombre/acentos y revisar promoción/descuento | Captura del precio y su regla; comparación con la fuente ERP; registro de latencia real. |
| 2a | Activar modo avión y guardar dos **pedidos finalizados pendientes de envío**; finalizar un tercero | Cola durable de tres, orden cronológico, contador y estado pendiente. Un borrador sin finalizar sigue editable y queda fuera de esta cola. |
| 2b | Recuperar conectividad | Ningún dispositivo puede subir datos en modo avión. Al reconectar deben subirse los tres finalizados FIFO sin otra acción, cada uno una sola vez. Capturar estados y filas antes/después. |
| 2c | Repetir sincronizar/reintentar y simular respuesta perdida | Mismos IDs de pedido y claves; sin nuevos pedidos ni movimientos; reservas y saldo coinciden. |
| 3 | Cancelar uno de los pedidos locales con motivo y confirmar en diálogo grande | Pedido conserva historia; reversión de reserva/bolsa una vez; timeline identifica actor/fecha/motivo. Si la versión aún delega confirmados al ERP, este paso **falla**: no sustituir por borrar un borrador. |
| 4a | Abrir documento entregado/cobrable según regla servidor y registrar importe real en efectivo, tarjeta y transferencia comercial | Cada cobro una vez, deuda actualizada, historial y documento pagado. Un cobro ya realizado por reparto no vuelve a cobrarse. |
| 4b | Generar liquidación comercial | Periodo sin cobros rechazado; totales derivados del servidor y arrastre desde última liquidación acreditado; cabecera/PDF/PNG reales y coherentes. |
| 5 | Repetir pantallas y diálogos en pequeño/gran teléfono, tablet 8 y 10–13 pulgadas | Retrato y paisaje × escalas 1/1,5/2: 24 combinaciones de tamaño/orientación/escala, con capturas y sin overflow. Objetivos táctiles ≥56 dp; sin señalización sólo por color. |

La matriz de cuatro tamaños × dos orientaciones × tres escalas contiene **24 combinaciones** por pantalla (no 48). Las pantallas adicionales multiplican el número de capturas.

## Verificación local repetible

Desde la raíz del repositorio:

```powershell
flutter analyze
flutter test --no-pub
```

Desde `backend/`:

```powershell
npm run lint
npm test -- --runInBand
```

No ejecutar antiguas herramientas archivadas de smoke/seed por su nombre: antes hay que comprobar destino de cada INSERT/UPDATE/DELETE, aislamiento, idempotencia y exclusión de exportación. Las pruebas con mocks no sustituyen la instantánea DB2.

## Reset

El reset de pedidos debe invocar la anulación lógica autorizada y conservar cabecera, líneas, auditoría y movimientos origen/inversos. Nunca rebobina secuencias ni identidades. Para cobros/liquidación exclusivamente TEST, cualquier retirada exige IDs exactos y hash canónico completo de cada fila del manifiesto propio; si cambió una fila o apareció actividad ajena, STOP. No borrar por vendedor/día, prefijos de token ni LIKE; no vaciar tablas compartidas. Una prueba ejecutada dentro de transacción con ROLLBACK conserva el estado previo y debe comprobarlo después. El reset de la demo requiere un script implementado y probado; mientras no figure como PASS en el informe, no se declara repetibilidad completa.

## Evidencia que se entrega a dirección

Commit instalado, informe de pruebas con exit codes, reconciliación antes/después, 24 combinaciones visuales por pantalla, tiempos separados cliente/API/ODBC y resultado de cada fila de este guion. Un fallo de readiness, una cancelación no implementada o una regla de cobro no acreditada impiden aprobar el recorrido completo.

Las seis imágenes de `docs/audits/orders-tablet-20261102/renderer-veto/` documentan el candidato revisado en escritorio. El contraste del total del pedido y de tres métricas de Bolsa quedó por debajo del mínimo. Las imágenes combinan fixtures con campos acreditados y sirven para reproducir la revisión visual. La validación en teléfono y tablet, los FPS y la ejecución completa de este guion quedan pendientes.
