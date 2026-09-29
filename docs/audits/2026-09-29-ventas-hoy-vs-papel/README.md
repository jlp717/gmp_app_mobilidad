# Conciliación DB2 de ventas del 29-09-2026

## Estado

Consulta DB2 de solo lectura ejecutada el 29-09-2026. El total bruto y el total con el filtro actual de la app reproducen los importes comunicados, y el gap queda localizado en dos clases documentales. **No es todavía una conciliación aprobada ni una autorización para publicar:** falta la consulta/exportación que genera el papel y demostrar que aplica la misma fecha, universo, signo y tratamiento de devoluciones.

## Fuente y método

El mapa de tablas del backend resuelve `LACLAE` a `DSED.LACLAE`. `QSYS2.SYSTABLES` y `QSYS2.SYSCOLUMNS` confirmaron la tabla y las columnas usadas. La fecha se vinculó como `(LCAADC, LCMMDC, LCDDDC) = (2026, 9, 29)`. No se leyeron nombres ni filas individuales de clientes.

El total bruto se calculó con `SUM(LCIMVT)`. El total equivalente al filtro actual de LACLAE se calculó con:

```sql
TPDC = 'LAC'
AND LCTPVT IN ('CC', 'VC')
AND LCCLLN IN ('AB', 'VT')
AND LCSRAB NOT IN ('N', 'Z', 'G', 'D')
```

Las consultas usaron parámetros enlazados para año, mes y día. Para los conteos de documento se compararon deliberadamente tres identidades: `LCNRAB` solo, serie/subserie más `LCNRAB`, y la clave compuesta `LCSBAB + LCYEAB + LCSRAB + LCTRAB + LCNRAB`. Esto evita presentar un contador de números como si fuera un contador inequívoco de documentos.

Consulta agregada usada para el total y los contadores; parámetros enlazados: `[2026, 9, 29]`.

```sql
SELECT COUNT(*) AS lines,
       COUNT(DISTINCT LCNRAB) AS document_numbers_only,
       COUNT(DISTINCT LCSBAB || DIGITS(LCYEAB) || LCSRAB || DIGITS(LCTRAB) || DIGITS(LCNRAB)) AS full_documents,
       COUNT(DISTINCT LCCDCL) AS clients,
       COALESCE(SUM(LCIMVT), 0) AS raw_amount,
       COALESCE(SUM(CASE WHEN TPDC = 'LAC'
                          AND LCTPVT IN ('CC', 'VC')
                          AND LCCLLN IN ('AB', 'VT')
                          AND LCSRAB NOT IN ('N', 'Z', 'G', 'D')
                         THEN LCIMVT ELSE 0 END), 0) AS app_filter_amount
FROM DSED.LACLAE
WHERE LCAADC = ? AND LCMMDC = ? AND LCDDDC = ?;
```

El desglose del gap agrupó las mismas filas por `TPDC, LCSRAB, LCTPVT, LCCLLN`; las atribuciones se consultaron por separado para cada uno de `LCCDVD` y `R1_T8CDVD`, y las series por `LCSBAB, LCSRAB`.

## Resultado agregado

| Medida | Todas las filas del día | Filtro actual de la app |
|---|---:|---:|
| Líneas | 1.279 | 1.159 |
| Importe | 57.442,76 € | 48.928,95 € |
| Documentos por `LCNRAB` únicamente | 332 | 312 |
| Documentos por clave compuesta | 346 | 326 |
| Clientes distintos en `LCCDCL` | 255 | 241 |

El gap de 8.513,81 € se desglosa en:

| `TPDC` | `LCSRAB` | `LCTPVT` | `LCCLLN` | Líneas | Importe | Tratamiento del filtro actual |
|---|---|---|---|---:|---:|---|
| LAE | J | CC | VT | 99 | 8.435,96 € | Excluido por `TPDC = 'LAC'` |
| LAC | P | SC | RG | 8 | 77,85 € | Excluido por tipo y clase de línea |
| **Total** | | | | **107** | **8.513,81 €** | |

No hubo importes negativos en las filas de ese día. Esto describe los datos encontrados, pero no determina cómo debe tratar el papel los abonos o devoluciones.

Las demás combinaciones incluidas suman 48.928,95 €: LAC/E/CC/VT = 3.000,29 €, LAC/I/CC/VT = 5.835,47 €, LAC/P/CC/VT = 38.512,58 € y LAC/S/CC/VT = 1.580,61 €. También aparecieron 13 líneas de clase `NS` con importe cero.

## Desgloses y universo operativo

- Se ejecutaron agrupaciones separadas por `LCSRAB`, `LCCDVD` y `R1_T8CDVD`; las dos agrupaciones de vendedor dieron los mismos importes por código para esta fecha. No se infiere por ello que los campos sean intercambiables en la regla de negocio.
- Los valores de `LCSRAB` observados son subseries (`E`, `I`, `J`, `P`, `S`), así que `LCSRAB` pertenece al desglose documental, no es un campo de vendedor. La etiqueta «atribución de vendedor» de VH-004 debe corregirse antes de aprobar esa especificación.
- `JAVIER.VENTAS_B` existe y su esquema verificado contiene vendedor, ejercicio, mes e importe, pero no fecha diaria ni identificador documental. Para septiembre de 2026 devolvió cero filas. Esta tabla no puede atribuir ventas B, documentos o gap a un día concreto con el esquema actual.
- `JAVIER.RUTERO_CONFIG` usa `DIA` textual y `ORDEN`; para martes hay 193 filas configuradas, 143 con `ORDEN >= 0` y 50 bloqueos con `ORDEN = -1`. El valor 255 no es el contador de paradas activas del rutero para el martes.
- El 255 observado en la consulta comercial es `COUNT(DISTINCT LCCDCL)` sobre todas las filas de LACLAE del día. No demuestra que hubiera 255 repartos. Una lectura agregada separada de `DSEDAC.CPC` por fecha dio 390 filas, 196 números de orden de preparación, 257 clientes y 46.000,57 €; no se ha probado que ese universo sea el mismo del papel ni el de `RUTERO_CONFIG`.

## Bloqueos para cerrar la especificación

1. Falta la SQL, exportación o regla de negocio exacta que produjo los 57.442,76 € del papel.
2. Falta definir qué significa el canon de «255 repartos» y enlazar cada parada/documento con las fuentes sin confundir paradas, clientes y documentos.
3. La tabla de ventas B no aporta granularidad diaria; falta identificar una fuente diaria si el papel incluye esa dimensión.
4. Falta validar frescura/origen del valor servido por el cache de la app y reproducir la fecha documental usada por ambas fuentes.
5. La prueba automatizada debe cubrir ambas atribuciones de vendedor por separado, serie documental completa, signo, ventas B, el universo de reparto y los perfiles jefe de ventas/comercial. Un mock con el canon esperado no es evidencia de conciliación.
6. El candidato conserva `todaySales`, `todayOrders`, `totalOrders` y `avgOrderValue` con la semántica filtrada legacy, para no cambiar lo que reciben instalaciones anteriores. Expone el total bruto en `todaySalesGross`, los documentos brutos/filtrados en `todayDocumentsGross`/`todayDocumentsFiltered`, y el filtro monetario y diferencia en `todaySalesFiltered`/`todaySalesGap`. La regresión fija el 29-09-2026, valida parámetros y forma SQL, y comprueba `ALL` explícito y el filtro comercial por `LCCDVD`; sigue usando un repositorio mock, no reproduce el papel ni sustituye la consulta DB2 independiente.
7. El endpoint consulta únicamente hoy del mes corriente, así que el resultado no se puede volver a consultar para una fecha histórica concreta desde ese contrato.

La conciliación completa permanece abierta hasta resolver estos puntos. El cambio del KPI puede verificarse en aislamiento como una mejora aditiva y compatible, pero eso no certifica equivalencia con el papel, sesiones JEFE_VENTAS/COMERCIAL ni todos los endpoints del servidor. La versión Android preparada para este candidato es `4.1.37+93`; la aceptación del versionCode y del certificado por Google Play no se ha comprobado.
