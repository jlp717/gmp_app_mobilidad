# Suelo absoluto de venta y copia del catálogo ERP

Confirmado el 03/11/2026. El margen objetivo es un porcentaje del precio de venta antes de IVA. El ejemplo de aceptación es 0,80 € de coste y 20 % de margen, que exige 1,0000 € de precio neto. Si un mínimo explícito válido es mayor, prevalece ese importe. La Bolsa, una promoción, el precio especial, el modo de trabajo offline y el permiso de confirmación forzada quedan sujetos al mismo suelo.

## Fuentes contrastadas

| Fuente | Resultado de sólo lectura |
|---|---|
| `DSEDAC.ART` | 6.235 códigos distintos no vacíos. La copia debe incluir también artículos inactivos y sin precio. Se comprobaron `CODIGOARTICULO`, `UNIDADMEDIDA` y `UNIDADESCAJA`. |
| `DSEDAC.ARA` | 5.543 artículos tienen precio positivo en tarifa 2 y ninguno presenta precios positivos distintos dentro de esa tarifa. 256 sólo tienen alguna otra tarifa positiva. 436 carecen de toda tarifa positiva. `PRECIOTARIFA` usa cuatro decimales. |
| `JAVIER.BOLSA_PRODUCTO_PRECIO` | 2.785 filas vigentes. La consulta agrupada acredita 2.346 productos del catálogo con coste positivo y margen de 0 a menos de 100 en al menos una política vigente. El recuento no acredita correspondencia de unidad con la tarifa de cada venta. |
| `DSEDAC.PES` y reglas asociadas | Los especiales se consultan por la relación comercial ERP. El precio especial permanece como candidato de precio, sujeto al suelo. |
| `JAVIER.TEST_PRECIO_COMPETITIVO` | Dos filas reales de cliente y artículo acreditadas. Son un dato comercial distinto del suelo por producto. |

[Catálogo y tarifa 2](audits/orders-tablet-20261102/pricing-catalog-coverage.json) · [Cobertura ampliada](audits/orders-tablet-20261102/pricing-catalog-coverage-expanded.json) · [Metadatos de las políticas](audits/orders-tablet-20261102/pricing-hard-floor-db2.json)

El importador histórico lee `DSEDAC.LAC.PRECIOCOSTO` como coste observado, fuerza CAJAS y reinicia una identidad de la tabla compartida. Esa fuente histórica permite estudiar cobertura, pero requiere comprobar unidad y procedencia antes de llamarla coste de fabricación. La tarifa 2 es la referencia mínima actual del código. Cualquier respaldo con otro código de tarifa requiere acreditar su elegibilidad y la unidad del importe. Un dato ausente se conserva como tal.

En el catálogo hay 1.883 productos con unidad vacía. Las 2.785 políticas vigentes figuran como CAJAS. La muestra real del artículo 1009 acredita una tarifa 2 de 4,1240 € y una factura con 1 envase, 5 unidades de peso y 20,62 € de venta a 4,1240 €. Su coste unitario observado es 2,8189 € y el importe de coste es 14,09 €. La muestra identifica la base por kilo de ese registro, pese a que el histórico de venta tiene sus marcadores de unidad en blanco. Los artículos 1007, 1011 y 1021 muestran también importes coherentes con la cantidad de peso. En el 2974, 3075 y 3519, la cantidad de envases y unidades coinciden en la muestra y esa igualdad no permite distinguir bases por sí sola.

[Cobertura de unidades](audits/orders-tablet-20261102/pricing-unit-coverage.json) · [Columnas ERP](audits/orders-tablet-20261102/pricing-erp-unit-columns.json) · [Muestra de importes](audits/orders-tablet-20261102/pricing-erp-unit-samples.json)

## Entregas y pruebas de aceptación

| Tramo | Contrato y aceptación |
|---|---|
| Cálculo | `coste / (1 − margen / 100)`. Redondear hacia arriba a cuatro decimales sin subir un límite ya exacto. Probar cero explícito, margen inválido o ausente, mínimo configurado mayor y cociente periódico. |
| Copia aislada | Definir la tabla de catálogo comercial en `JAVIER.TEST_*` con clave de artículo, unidad de origen, tarifa, procedencia, disponibilidad y marca temporal. Una fila por código real. Mantener columnas distintas para tarifa, coste de fabricación, margen, mínimo y estado de evidencia. Verificar DDL, journal, claves y tipos; comparar los conjuntos de códigos y hash canónico fuente/destino. Reejecutar el seed con el mismo material y comprobar que se mantienen conteo, clave y valores. |
| Unidades y moneda | Acreditar la unidad del precio ERP y la del coste. El índice de políticas debe preservar artículo más unidad. El mapa actual, que sólo usa artículo, puede sobrescribir otra unidad. CAJAS, kg y unidades se comparan en la misma base antes de IVA. Las conversiones requieren factor acreditado por ERP. |
| Alta y edición | Usar lote de política/tarifa y validar el precio neto de línea tras descuento de línea, global y promoción. Releer bajo los locks de mutación cuando corresponda. Un descuento que haga cruzar el mínimo debe devolver un conflicto de negocio, conservar cabecera/línea/reserva y evitar movimientos. |
| Confirmación y offline | Revalidar el snapshot de líneas persistidas antes de Bolsa, reserva, confirmación y cualquier exportación. El replay ya confirmado conserva el ACK. Cualquier excepción comercial y las promociones de precio cero pasan la misma comprobación. Un regalo requiere atribución de precio acreditada; en ausencia de ella, se bloquea. |
| Demo del comercial | Mantener los gates de pedidos, Bolsa, cobros y liquidación en el perfil aislado. Revisar detalle y contraste en tablet y teléfono. Pasar los recorridos nativos con datos reales, incluyendo efectivo, tarjeta y transferencia, cierre diario y el guion completo. Validar configuración de producción por lectura de catálogo antes de aprobarla. |

Las validaciones de escritura de este tramo se limitan a JAVIER TEST. El importador histórico permanece como evidencia de origen. Los datos productivos se consultan en sólo lectura.

## Punto de control del cálculo

`a0176f5` cambia dos archivos (+121/−8) y calcula el cociente exacto con enteros a escala cuatro. La primera versión pasó su suite focal, pero fue vetada al producir 142.857,1451 € en un límite cuyo resultado exacto era 142.857,1450 €. La reparación valida el formato decimal y rechaza un resultado fuera de DECIMAL(11,4) con error tipado. QA verificó 155/155 pruebas de tres suites, exit 0, y contrastó 10.000 entradas con un oráculo racional independiente (4.927 resultados exactos y 5.073 desbordamientos rechazados). La integración de descuentos, promociones, unidades y escrituras permanece separada de este punto de control.

El destino propuesto `JAVIER.TEST_POLITICA_PRECIO_ART` estaba ausente en la consulta de catálogo. La fuente tenía 6.235 filas y 6.235 claves de artículo, de las que 2.937 estaban activas. [Destino y claves](audits/orders-tablet-20261102/pricing-seed-target-catalog.json)

El SELECT exacto de la segunda versión se probó en DB2 en sólo lectura. Devolvió 6.236 filas porque incluía una fila auxiliar con código en blanco. Una segunda sonda aplicó el filtro en memoria al SQL y obtuvo 6.235 filas válidas, 2.937 activas y huella canónica `d6f514c7123778e418efc82a5eecfeb278a5d5c55c3fdef063d3894a53963aea`. Resultaron 5.543 con tarifa 2, 11 con una única alternativa, 245 con varias alternativas y 436 sin precio positivo. Es evidencia de lectura y normalización, con destino todavía ausente. QA bloqueó también la segunda versión porque el verificador aceptaba restricciones CHECK vacías de significado si conservaban los nombres. [Sonda filtrada](audits/orders-tablet-20261102/pricing-seed-source-native-filtered.json)

El especial acreditado de 29,28 € para el artículo 2974 y cliente 4300032888 queda por debajo de los 39,40 € de tarifa 2 de ese artículo. Si se acredita que ambos importes se expresan en la misma unidad, es un caso real de rechazo esperado bajo la regla nueva. Para el 1009, la muestra permite probar la comparación por kilo con 4,1240 € como tarifa 2 y comprobar el efecto del descuento y el redondeo de factura. Esas son propuestas de casos nativos. Las consultas hasta este punto han sido de sólo lectura.

## Revisión complementaria de Gestión de Ventas

El modo jefe muestra Panel y las doce superficies de ventas. Comercial comparte esas superficies sin Panel y con Comisiones condicionada por permiso. El montaje real se resuelve en `lib/core/services/navigation_config_service.dart:178` y `lib/features/dashboard/presentation/pages/main_shell.dart:2097`. La revisión estática encontró trabajo de presentación separado de la seguridad y del motor financiero.

| Pantalla | Hallazgo verificable | Aceptación pendiente |
|---|---|---|
| Cobros | Texto de 9–13 sp y control de 32 dp en `cobro_detail_screen.dart:703` y `:738`. | Importe, cliente y estado legibles, acciones de 56 dp, revisión a 200 % sin alterar el POST de cobro. |
| Liquidación | Instrucciones y campos a 12–16 sp en `comercial_liquidacion_diaria_page.dart:661` y `:992`. | Resumen, métodos e ingreso legibles en retrato y paisaje, con estados financieros y handlers existentes. |
| Bolsa | Historial compacto de 10 sp, control de 32 dp y filas con densidad compacta en `bolsa_page.dart:986`, `:1161` y `:1431`. | Valores de saldo/consumo/límite con contraste medido en los widgets efectivos, etiquetas visibles y objetivos de 56 dp. |
| Promociones | Chips compactos con `shrinkWrap` y rótulos de 10–13 sp en `promotions_list_page.dart:355` y `promotion_detail_page.dart:255`. | Selección explícita y legible con escala, precio y vigencia claros, sin cambiar la fuente ERP. |
| Navegación | Los destinos dependen de label, índice y perfil. La matriz física completa permanece pendiente. | Validar todos los destinos, permisos, escala, orientación y safe area antes de tocar el shell compartido. |

## Resultado del intento nativo TEST

La tercera versión del seed pasó 21/21 pruebas independientes y revisión de seguridad. El motor aceptó la sentencia exacta `SET CURRENT SCHEMA JAVIER` en una sesión aislada. Se verificó ausencia previa de la tabla y de colisiones de restricciones, y el CREATE sellado creó `JAVIER.TEST_POLITICA_PRECIO_ART`.

La comprobación inmediatamente posterior paró con `POLICY_TARGET_SCHEMA_MISMATCH` antes de cualquier INSERT. La conexión física se cerró. Un observador de sólo lectura confirmó que la tabla contiene **0 filas**, con 19 columnas, siete CHECK habilitados y journal `JAVIER.QSQJRN` con imágenes `*BOTH`. El catálogo IBM i declara `TARIFA_VARIANTES` como `INTEGER`, longitud física 4, precisión informada 9 y escala 0. La expectativa sellada asumía precisión informada 10. Las tres reparaciones normales del importador están agotadas. Una corrección posterior debe conservar las demás comparaciones estrictas y volver a validarse de forma independiente sobre esta tabla vacía.

[Sesión de esquema](audits/orders-tablet-20261102/pricing-seed-schema-session.json) · [Creación y detención](audits/orders-tablet-20261102/pricing-seed-ddl-native.json) · [Postcheck físico](audits/orders-tablet-20261102/pricing-seed-target-after-ddl.json)

Seguridad comparó el catálogo real con el importador conservado y confirmó la diferencia de precisión como único desajuste observado. Los siete cuerpos CHECK normalizados coinciden y la clave primaria habilitada tiene sólo `CODIGOARTICULO`. Las consultas recogidas no incluyen los defaults ni la identidad de columnas. El importador y sus pruebas quedaron conservados en el stash `256e8568546e61b798c327ff15dcca66af6d983f`. [Clave primaria](audits/orders-tablet-20261102/pricing-seed-target-pk.json) · [Fuente congelada](audits/orders-tablet-20261102/pricing-seed-verifier-frozen.json)

## Comprobación del precio neto

El módulo de comparación exacta pasó 45/45 pruebas en revisión de seguridad independiente. Rechaza un neto una diezmilésima por debajo del suelo, descuentos compuestos que lo cruzan, UOM distinta, alias contradictorios y entradas sobredimensionadas. Una promoción, regalo, especial, permiso de fuerza o saldo de Bolsa no cambia su decisión. Se conservó en `37935595582490d9c35d06e3dfa44bc012cc7464` hasta que tenga consumidores de servidor. Su aceptación cubre la comprobación unitaria nominal. Falta conectarla a la política de base facturada, al importe redondeado y a las transacciones de alta, edición y confirmación. [Fuente congelada](audits/orders-tablet-20261102/pricing-floor-kernel-frozen.json)

## Estado de integración del comercial

| Entrega | Estado | Verificación |
|---|---|---|
| Fórmula de margen sobre venta | DONE en fuente | `a0176f5`, 155 pruebas focales y 10.000 comparaciones exactas. |
| DDL de catálogo TEST | DONE en DB2 | `87c2278`, tabla creada, clave y journal confirmados. La carga de catálogo es un paso separado y permanece bloqueada. |
| Importador y aplicación del suelo en pedidos | BLOCKED | Carga detenida con 0 filas por el metadato INTEGER. El kernel exacto existe como candidato y pasó su revisión pura, con la integración de servidor pendiente. |
| Cobros, presentación | DONE en fuente | `aa0ab18`, 44 pruebas del área y 1.228 Flutter. Montaje real de pantalla y estados en 390×844, 800×1280 y 1280×800 con texto al 200 %. |
| Liquidación, presentación | DONE en fuente | `f22724c`, 37 pruebas del área y 1.236 Flutter. La revisión confirmó los mensajes vivos a 18 sp y los manejadores financieros existentes. |
| Aceptación de demo y dispositivo | BLOCKED | Readiness volvió a responder HTTP 503. Esta comprobación descartó el cuerpo. Sin dispositivo disponible y sin ejecución del guion financiero con escrituras. |

La suite del backend comprometido en `87c2278` pasó 3.769 pruebas, con dos omitidas. El lint oficial mantiene 242 errores TypeScript y 0 warnings. El último análisis completo de Flutter devuelve exit 1 por 7.631 infos, con 0 errores y 0 warnings. Las pruebas visuales son del renderer Flutter. Se descartaron capturas de Cobros con Ahem y no se produjeron PNG de Liquidación.

[Backend](audits/orders-tablet-20261102/backend-pricing-checkpoint.json) · [Cobros](audits/orders-tablet-20261102/flutter-cobros-ux-checkpoint.json) · [Liquidación](audits/orders-tablet-20261102/flutter-liquidacion-ux-checkpoint.json)
