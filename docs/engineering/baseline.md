# Baseline de implementación

Fecha: 2026-09-18. Autorización: implementar el plan de profesionalización solicitado por Javier. Referencia: `test@710fede`. Rama aislada: `codex/professionalization-implementation-20260918`. El commit del plan se incorpora como `145859a`.

## Alcance y convivencia

No se incorpora ningún cambio no confirmado del checkout original. Los siguientes paths ajenos estaban modificados al inicio; requieren reconciliación posterior antes de integrar un slice que coincida:

- `M AGENTS.md`
- `M backend/__tests__/delivery-amount-resolver.test.js`
- `M backend/__tests__/delivery-cobro-availability.test.js`
- `M backend/__tests__/entregas-route-gap-coverage.test.js`
- `M backend/__tests__/repartidor-finanzas-http-gap-coverage.test.js`
- `M backend/__tests__/repartidor-liquidacion-db2-repository.test.js`
- `M backend/__tests__/reparto-confirmacion-validation.test.js`
- `M backend/__tests__/reparto-confirmation-service.test.js`
- `M backend/__tests__/reparto-receipt-service.test.js`
- `M backend/repositories/repartidor-liquidacion-db2-repository.js`
- `M backend/repositories/repartidor-route-db2-repository.js`
- `M backend/routes/entregas.js`
- `M backend/services/delivery-amount-resolver.js`
- `M backend/services/deterministic-delivery-status.js`
- `M backend/services/reparto-confirmation-contract.js`
- `M backend/services/reparto-confirmation-service.js`
- `M backend/services/reparto-receipt-service.js`
- `M backend/src/validators/repartidorFinanzas.validators.js`
- `M lib/features/entregas/providers/entregas_provider.dart`
- `M lib/features/repartidor/data/reparto_confirmation_request.dart`
- `M lib/features/repartidor/domain/rutero_delivery_validation.dart`
- `M lib/features/repartidor/domain/rutero_standalone_cobro.dart`
- `M lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart`
- `M lib/features/repartidor/presentation/widgets/rutero_detail_payment.dart`
- `M lib/features/repartidor/presentation/widgets/rutero_detail_products.dart`
- `M lib/features/repartidor/presentation/widgets/rutero_print_preview_dialog.dart`
- `M lib/features/repartidor_finanzas/data/repartidor_finanzas_service.dart`
- `M lib/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart`
- `M test/features/repartidor/data/reparto_confirmation_request_contract_test.dart`
- `M test/features/repartidor/domain/rutero_standalone_cobro_test.dart`
- `M test/features/repartidor/rutero_delivery_validation_test.dart`
- `M test/models/albaran_entrega_test.dart`
- `M test/widget/repartidor_finanzas_ui_test.dart`
- `M test/widgets/rutero_detail_payment_test.dart`
- `?? test/widgets/rutero_detail_products_amount_test.dart`

## Propiedad y comprobaciones

Primer slice: runner/escáner bajo `scripts/quality/`, conexión con Politec, invocación CI y documentación `docs/engineering/`. Un solo writer; exploración y revisión sólo lectura. Las dependencias Node existentes se reutilizan mediante junction local ignorada y no se modificarán a través de ella. El archivo de ejemplo de entorno está excluido por sparse checkout; no se abre.

Windows; Python3.11; Node observado20.2.0 (inferior al mínimo backend20.6.0), Flutter fijado3.35.6. Los cambios de runtime necesitan ensayo local/CI y compatibilidad nativa antes de promoción; no se modifica el host productivo.

Ensayo posterior: Node24.21.0 portable para Windows y Linux, archivos oficiales de nodejs.org comprobados contra SHASUMS256. No se cambia el Node global. Windows: instalación limpia de 785 paquetes, bcrypt6.0.0 y odbc2.5.0 cargan sin conexión. Linux/WSL: instalación offline de 784 paquetes con `--ignore-scripts`; bcrypt carga, ODBC no tiene addon compilado (`MODULE_NOT_FOUND`). Esta segunda instalación demuestra resolución/extracción, no compatibilidad ODBC/IBM i. La CI declara el ensayo nativo con unixODBC; su resultado remoto aún no está disponible.

Flutter real:3.35.6, Dart3.9.2. `flutter pub get --offline --enforce-lockfile` terminó con exit0 y sin cambios del lockfile. Baseline limpio dirigido:13 pruebas pasan. Análisis de lib:0 errores,4 warnings de helpers de promociones usados en producción y6538 infos; los informes históricos del checkout con cambios ajenos no se atribuyen a esta base limpia.

Las referencias del audit original (0e3912a + dirty) están pendientes de reconfirmación por cada slice. El fallo de fecha registrado entonces dependía de cambios concurrentes; este checkout limpio se medirá por separado.

Pruebas permitidas: Node unit sin I/O externo, fixtures sintéticas y procesos hijos propios; Flutter unit/widget tras revisar imports. DB2, servicios reales, secretos, despliegue, pentest y medidas de campo pendientes de sus gates específicos. No se ejecuta aún la suite Jest completa porque su aislamiento no está acreditado.
