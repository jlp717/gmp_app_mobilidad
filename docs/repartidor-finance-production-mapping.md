# Repartidor Finanzas - Mapeo DB2 y Paso a Produccion

Fecha de ultima exploracion real: 2026-04-25.

Este documento describe como funciona la suite financiera de repartidores,
que tablas DB2 toca, que queda aislado en `JAVIER` para pruebas y que cambio
exacto hace que el flujo escriba en el ERP real `DSEDAC`.

No contiene muestras de clientes ni datos personales. Las muestras `SELECT *`
se generan localmente con:

```bash
cd backend
npm run finance:inventory-db
```

La salida va a `backend/tmp/db-exploration/` y no debe subirse a Git.

## Regla De Entorno

La suite separa tres destinos para evitar mezclar lecturas de ERP, escritura de
liquidaciones y tablas internas de la app:

```env
REPARTIDOR_FINANCE_READ_SCHEMA=DSEDAC
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER
REPARTIDOR_FINANCE_APP_SCHEMA=JAVIER
```

Valores permitidos:

| Variable | Valor dev | Valor prod/cutover | Uso |
| --- | --- | --- |
| `REPARTIDOR_FINANCE_READ_SCHEMA` | `DSEDAC` | `DSEDAC` | Lee maestros y documentos ERP (`CLI`, `CVC`, `CPC`, `OPP`, `LAC`, `ART`, `CLCL1`, `CLX`). |
| `REPARTIDOR_FINANCE_ERP_SCHEMA` | `JAVIER` | `DSEDAC` | Destino de `LQD`: sombra/canary en dev, ERP real en produccion. |
| `REPARTIDOR_FINANCE_APP_SCHEMA` | `JAVIER` | `JAVIER` salvo migracion explicita | Tablas app (`REPARTIDOR_COBROS`, balances, OPS, `DELIVERY_STATUS`). |

El backend valida estos valores contra una whitelist. No acepta otros esquemas.

## Estado Verificado En DB2

Exploracion ejecutada contra DSN `GMP`:

| Tabla | Estado | Notas |
| --- | --- | --- |
| `DSEDAC.LQD` | Existe | 59.432 filas estimadas. Liquidaciones reales ERP. |
| `JAVIER.LQD` | No existe todavia | La crea `020_repartidor_finance_tables.sql` con `CREATE TABLE JAVIER.LQD LIKE DSEDAC.LQD`. |
| `DSEDAC.CVC` | Existe | 123.224 filas estimadas. Deuda/vencimientos. |
| `DSEDAC.CPC` | Existe | 723.703 filas estimadas. Cabecera de albaranes. |
| `DSEDAC.OPP` | Existe | 289.939 filas estimadas. Repartidor/orden preparacion. |
| `DSEDAC.CLCL1` | Existe | Tabla correcta para dias limite credito. |
| `DSEDAC.CVCL1` | Existe | No es la tabla de credito cliente: tiene forma de cartera/deuda, similar a CVC. |
| `DSEDAC.CLX` | Existe | Contiene cobro riguroso y emails cliente. |
| `DSEDAC.CDVI` | Existe | Planificacion de visitas/ruta. |
| `JAVIER.REPARTIDOR_COBROS` | Existe | Existe con columnas legacy; `020` anade columnas financieras nuevas. |
| `JAVIER.REPARTIDOR_LIQUIDACION_OPS` | No existe todavia | La crea `020`. Ledger/idempotencia. |
| `JAVIER.REPARTIDOR_FINANCIAL_BALANCES` | No existe todavia | La crea `020`. Saldo acumulado pendiente. |
| `JAVIER.REPARTIDOR_COMMISSION_TIERS` | No existe todavia | La crea `020`. Tramos editables. |

## Scripts ACS

Ejecutar en este orden:

| Script | Tipo | Uso |
| --- | --- | --- |
| `backend/scripts/sql/020_repartidor_finance_tables.sql` | DDL/DML controlado | Crea tablas shadow/test y extiende `JAVIER.REPARTIDOR_COBROS`. |
| `backend/scripts/sql/021_verify_repartidor_finance_schema.sql` | Read-only | Debe devolver `OK` en todas las filas. |
| `backend/scripts/sql/023_repartidor_finance_db_exploration_acs.sql` | Read-only | Exploracion exhaustiva con catalogo y `SELECT * FETCH FIRST 5`. |
| `backend/scripts/sql/022_cleanup_repartidor_finance_test_template.sql` | Limpieza manual | Solo para borrar una prueba concreta por token. |

Regla ACS: si `020` da "already exists" en una tabla, columna, indice o
constraint, saltar solo esa sentencia y continuar.

## Tablas Y Columnas Criticas

### `DSEDAC.LQD` / `JAVIER.LQD`

Liquidaciones diarias. `JAVIER.LQD` debe tener exactamente la misma estructura
que `DSEDAC.LQD`.

Columnas verificadas:

```text
SUBEMPRESALIQUIDACION CHAR(3)
EJERCICIOLIQUIDACION NUMERIC(4,0)
SERIELIQUIDACION CHAR(1)
TERMINALLIQUIDACION NUMERIC(3,0)
NUMEROLIQUIDACION NUMERIC(6,0)
DIALIQUIDACION NUMERIC(2,0)
MESLIQUIDACION NUMERIC(2,0)
ANOLIQUIDACION NUMERIC(4,0)
HORALIQUIDACION NUMERIC(6,0)
CODIGOVENDEDOR CHAR(2)
CODIGOVENDEDORUSUARIO CHAR(2)
CODIGOUSUARIO CHAR(10)
MATRICULA CHAR(20)
KILOMETROSSALIDA NUMERIC(11,3)
KILOMETROSLLEGADA NUMERIC(11,3)
KILOMETROSRECORRIDOS NUMERIC(11,3)
IMPORTEEFECTIVO NUMERIC(10,2)
IMPORTECHEQUES NUMERIC(10,2)
IMPORTEPOSTDATADOS NUMERIC(10,2)
IMPORTESALDOACTUAL NUMERIC(10,2)
IMPORTETOTALAINGRESAR NUMERIC(10,2)
IMPORTEINGRESOENBANCO NUMERIC(10,2)
IMPORTEGASTOS NUMERIC(10,2)
IMPRESOSN CHAR(1)
CODIGOVEHICULO CHAR(10)
REVISADOSN CHAR(1)
IDMARCALIQUIDACION CHAR(30)
IMPORTEEFECTIVO2 NUMERIC(10,2)
IMPORTEENTREGADO2 NUMERIC(10,2)
IMPORTETARJETA NUMERIC(10,2)
ID INTEGER
MARCAACTUALIZACION VARCHAR(50)
```

Numero de liquidacion:

```sql
SELECT COALESCE(MAX(NUMEROLIQUIDACION), 0) + 1
FROM <ERP_SCHEMA>.LQD
WHERE SUBEMPRESALIQUIDACION = ?
  AND EJERCICIOLIQUIDACION = ?
  AND SERIELIQUIDACION = ?
  AND TERMINALLIQUIDACION = ?
```

En test `<ERP_SCHEMA>` es `JAVIER`; en produccion es `DSEDAC`.

### `DSEDAC.CVC`

Tabla maestra de deuda/vencimientos. Query base:

```sql
WHERE COALESCE(CVC.ANULADOSN, '') <> 'S'
  AND CVC.IMPORTEPENDIENTE <> 0
```

Columnas clave:

```text
TIPODOCUMENTO CHAR(3)
ORIGENDOCUMENTO CHAR(1)
SUBEMPRESADOCUMENTO CHAR(3)
EJERCICIODOCUMENTO NUMERIC(4,0)
SERIEDOCUMENTO CHAR(1)
TERMINALDOCUMENTO NUMERIC(3,0)
NUMERODOCUMENTO NUMERIC(6,0)
XDEDOCUMENTO NUMERIC(2,0)
DEXDOCUMENTO NUMERIC(2,0)
CODIGOCLIENTEALBARAN CHAR(10)
CODIGOCLIENTEFACTURA CHAR(10)
CODIGOVENDEDOR CHAR(2)
CODIGOVENDEDORCOBRO CHAR(2)
CODIGOFORMAPAGO CHAR(2)
DIAVENCIMIENTO NUMERIC(2,0)
MESVENCIMIENTO NUMERIC(2,0)
ANOVENCIMIENTO NUMERIC(4,0)
DIAEMISION NUMERIC(2,0)
MESEMISION NUMERIC(2,0)
ANOEMISION NUMERIC(4,0)
IMPORTEVENCIMIENTO NUMERIC(10,2)
IMPORTECANCELADO NUMERIC(10,2)
IMPORTEPENDIENTE NUMERIC(10,2)
DIACOBRO NUMERIC(2,0)
MESCOBRO NUMERIC(2,0)
ANOCOBRO NUMERIC(4,0)
NUMEROLIQUIDACION NUMERIC(6,0)
ANULADOSN CHAR(1)
```

Tipos pendientes encontrados en DB2:

| Tipo | Documentos | Importe |
| --- | ---: | ---: |
| `CAC` | 3719 | 823110.23 |
| `COB` | 2034 | 1337167.84 |
| `PGC` | 1220 | 1752341.14 |
| `PGP` | 603 | 3516905.52 |
| `PAG` | 349 | 1695513.78 |
| `CNP` | 66 | 855563.09 |
| `DEV` | 21 | 14101.17 |

La app mantiene filtro conservador para repartidor: `CAC`, `COC`, `DEV`.
Antes de ampliar a `COB`, `PGC`, `PGP`, `PAG` o `CNP`, validar con negocio
si esos documentos deben cobrarse desde repartidores o pertenecen a cartera
general.

### `DSEDAC.CPC`

Cabecera de albaranes/entregas. Relaciona cliente del albaran, importe,
documento y orden de preparacion.

Columnas clave:

```text
CODIGOCLIENTEALBARAN CHAR(10)
CODIGOCLIENTEFACTURA CHAR(10)
CODIGOVENDEDOR CHAR(2)
CODIGOVENDEDORCOBRO CHAR(2)
CODIGOFORMAPAGO CHAR(2)
IMPORTETOTAL NUMERIC(10,2)
IMPORTECOBRADO NUMERIC(10,2)
SUBEMPRESAALBARAN CHAR(3)
EJERCICIOALBARAN NUMERIC(4,0)
SERIEALBARAN CHAR(1)
TERMINALALBARAN NUMERIC(3,0)
NUMEROALBARAN NUMERIC(6,0)
EJERCICIOORDENPREPARACION NUMERIC(4,0)
NUMEROORDENPREPARACION NUMERIC(6,0)
DIADOCUMENTO NUMERIC(2,0)
MESDOCUMENTO NUMERIC(2,0)
ANODOCUMENTO NUMERIC(4,0)
DIALLEGADA NUMERIC(2,0)
MESLLEGADA NUMERIC(2,0)
ANOLLEGADA NUMERIC(4,0)
HORALLEGADA NUMERIC(6,0)
```

Regla obligatoria: cuando el codigo de cliente se use para cobros,
vencimientos o emails, se toma `CPC.CODIGOCLIENTEALBARAN`, no factura/cadena.

### `DSEDAC.OPP`

Relacion repartidor-albaranes por orden de preparacion.

Columnas clave:

```text
SUBEMPRESA CHAR(3)
EJERCICIOORDENPREPARACION NUMERIC(4,0)
NUMEROORDENPREPARACION NUMERIC(6,0)
DIAREPARTO NUMERIC(2,0)
MESREPARTO NUMERIC(2,0)
ANOREPARTO NUMERIC(4,0)
CODIGOREPARTIDOR CHAR(2)
CODIGOVEHICULO CHAR(10)
ESTADOORDENPREPARACION CHAR(1)
```

Join principal:

```sql
FROM DSEDAC.OPP OPP
INNER JOIN DSEDAC.CPC CPC
  ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
```

### `DSEDAC.CLCL1`

Tabla correcta para credito de cliente.

Columnas clave:

```text
CODIGOCLIENTE CHAR(10)
CODIGOCLIENTEFACTURA CHAR(10)
CODIGOFORMAPAGO1 CHAR(2)
CODIGOFORMAPAGO2 CHAR(2)
DIASLIMITECREDITO NUMERIC(3,0)
DIASLIMITECREDITOCONFECHAALB CHAR(1)
MAXIMONUMEROFACTURASPENDIENT NUMERIC(2,0)
CODIGOCUENTACOBRO CHAR(10)
```

Valores encontrados para `DIASLIMITECREDITOCONFECHAALB`:

| Valor | Conteo |
| --- | ---: |
| espacio | 10896 |
| `S` | 3012 |
| `s` | 1 |
| otros (`A`, `N`, `0`, `1`, `5`, `7`) | 15 |

Logica usada:

```text
SI TRIM(UPPER(DIASLIMITECREDITOCONFECHAALB)) = 'S'
  Fecha vencimiento = fecha albaran CPC + DIASLIMITECREDITO
SINO
  Fecha vencimiento = fecha factura/emision CVC + DIASLIMITECREDITO
```

### `DSEDAC.CVCL1`

Existe, pero no es la tabla de credito cliente. Su estructura contiene
`TIPODOCUMENTO`, claves de documento, importes y vencimientos; es candidata
historica/alias de cartera, no fuente de dias limite cliente.

Conclusion: usar `DSEDAC.CLCL1` para credito; no usar `CVCL1` para dias limite.

### `DSEDAC.CLX`

Extensiones cliente: emails y cobro riguroso.

Columnas clave:

```text
CODIGOCLIENTE CHAR(10)
CORREOELECTRONICOCLIENTE CHAR(256)
CORREOFACTURACONTADOPDF CHAR(256)
CORREOALBARANCREDIDOPDF CHAR(256)
CORREOFACTURACREDITOPDF CHAR(256)
CORREOELECTRONICOALBARANES CHAR(256)
COBRORIGUROSOSN CHAR(1)
PORCENTAJECOBRORIGUROSO NUMERIC(5,2)
DIACOBRORIGUROSODESDE NUMERIC(2,0)
MESCOBRORIGUROSODESDE NUMERIC(2,0)
ANOCOBRORIGUROSODESDE NUMERIC(4,0)
DIACOBRORIGUROSOHASTA NUMERIC(2,0)
MESCOBRORIGUROSOHASTA NUMERIC(2,0)
ANOCOBRORIGUROSOHASTA NUMERIC(4,0)
```

Distribucion verificada:

| Valor `COBRORIGUROSOSN` | Conteo |
| --- | ---: |
| espacio | 13844 |
| `S` | 50 |
| `N` | 30 |
| `C` | 1 |
| `M` | 1 |

Regla conservadora implementable: riguroso activo solo si
`TRIM(UPPER(COBRORIGUROSOSN)) = 'S'`. Los valores `C` y `M` deben validarse con
negocio antes de tratarlos como activos.

### `DSEDAC.CLP`

Parametros comerciales/financieros del cliente.

Columnas clave:

```text
CODIGOCLIENTE CHAR(10)
VENDEDORCOBRO CHAR(2)
VENDEDORCOMERCIAL CHAR(2)
VENDEDORREPARTIDOR CHAR(2)
SEGUROCREDITOSN CHAR(1)
IMPORTELIMITERIESGO NUMERIC(10,2)
PORCENTAJESUPERACIONRIESGO NUMERIC(5,2)
IMPORTELIMITERIESGOEMPRESA NUMERIC(10,2)
DIAVENCIMIENTOSEGURO NUMERIC(2,0)
MESVENCIMIENTOSEGURO NUMERIC(2,0)
ANOVENCIMIENTOSEGURO NUMERIC(4,0)
```

Hay 220 filas con `VENDEDORREPARTIDOR` informado. Para rutas reales se prioriza
`OPP`/`CPC`; para clientes asignados sin entrega del dia puede ayudar como
relacion comercial, pero la planificacion de visitas debe salir de `CDVI`.

### `DSEDAC.CDVI`

Planificacion de visitas por cliente/vendedor.

Columnas clave:

```text
CODIGOCLIENTE CHAR(10)
MODOVENDEDOR CHAR(1)
CODIGOVENDEDOR CHAR(2)
CODIGOLOCALIZACION CHAR(10)
SECUENCIA NUMERIC(4,0)
DIAVISITALUNESSN CHAR(1)
DIAVISITAMARTESSN CHAR(1)
DIAVISITAMIERCOLESSN CHAR(1)
DIAVISITAJUEVESSN CHAR(1)
DIAVISITAVIERNESN CHAR(1)
DIAVISITASABADOSN CHAR(1)
DIAVISITADOMINGOSN CHAR(1)
ORDENVISITALUNES NUMERIC(3,0)
ORDENVISITAMARTES NUMERIC(3,0)
ORDENVISITAMIERCOLES NUMERIC(3,0)
ORDENVISITAJUEVES NUMERIC(3,0)
ORDENVISITAVIERNES NUMERIC(3,0)
ORDENVISITASABADO NUMERIC(3,0)
ORDENVISITADOMINGO NUMERIC(3,0)
TIPOVISITA CHAR(1)
FRECUENCIAVISITA CHAR(1)
DIACONTROLDESDE NUMERIC(2,0)
MESCONTROLDESDE NUMERIC(2,0)
ANOCONTROLDESDE NUMERIC(4,0)
DIACONTROLHASTA NUMERIC(2,0)
MESCONTROLHASTA NUMERIC(2,0)
ANOCONTROLHASTA NUMERIC(4,0)
```

Uso para "Clientes No Visitados":

```text
Planificados = CDVI por CODIGOVENDEDOR + dia semana activo + rango control vigente
Visitados = clientes con CPC/OPP del repartidor en fecha
No visitados = Planificados - Visitados
```

### `DSEDAC.VDD` y `DSEDAC.VEH`

Identidad repartidor:

```text
DSEDAC.VDD.CODIGOVENDEDOR CHAR(2)
DSEDAC.VDD.NOMBREVENDEDOR CHAR(60)
DSEDAC.VEH.CODIGOVENDEDOR CHAR(2)
DSEDAC.VEH.CODIGOVEHICULO CHAR(10)
DSEDAC.VEH.MATRICULA CHAR(20)
DSEDAC.VEH.MOVILIDADSN CHAR(1)
```

Email de repartidor: no se ha localizado una columna de email en `VDD` ni
`VEH`. Si el email individual del repartidor no existe en otra tabla de usuarios
locales, debe resolverse con tabla de app/usuarios o configuracion adicional
antes de produccion.

## Tablas Propias De App

### `JAVIER.REPARTIDOR_COBROS`

Antes de `020` tiene columnas legacy:

```text
ID
ENTREGA_ID
CODIGO_CLIENTE
NOMBRE_CLIENTE
CODIGO_REPARTIDOR
TIPO_DOCUMENTO
NUMERO_DOCUMENTO
EJERCICIO_DOCUMENTO
IMPORTE_COBRADO
IMPORTE_PENDIENTE
FORMA_PAGO
FECHA_COBRO
VALIDADO
FECHA_VALIDACION
VALIDADO_POR
NOTAS
```

`020` anade:

```text
ENTREGA_APP_ID
ORIGEN_DOCUMENTO
SUBEMPRESA_DOCUMENTO
SERIE_DOCUMENTO
TERMINAL_DOCUMENTO
XDE_DOCUMENTO
DEX_DOCUMENTO
IDEMPOTENCY_TOKEN
PANTALLA_ORIGEN
OPERADOR
LIQUIDADO_SN
LIQUIDACION_TOKEN
CREATED_AT
```

Estas columnas son necesarias para:

- idempotencia por cobro;
- auditoria de pantalla/origen/operador;
- cruce exacto contra `DSEDAC.CVC`;
- resta de vencimientos en app;
- liquidacion diaria sin duplicados.

### `JAVIER.REPARTIDOR_LIQUIDACION_OPS`

Ledger local de cada cierre. Nunca sustituye a `LQD`; permite idempotencia,
replay, cleanup y trazabilidad.

Claves:

```text
IDEMPOTENCY_TOKEN UNIQUE
SUBEMPRESA_LIQ
EJERCICIO_LIQ
SERIE_LIQ
TERMINAL_LIQ
NUMERO_LIQ
CODIGO_REPARTIDOR
SALDO_ANTERIOR
TOTAL_COBROS_DIA
TOTAL_A_INGRESAR
INGRESO_BANCO
SALDO_RESULTANTE
STATUS
CREATED_AT
```

### `JAVIER.REPARTIDOR_FINANCIAL_BALANCES`

Persistencia del pendiente acumulado:

```text
CODIGO_REPARTIDOR PRIMARY KEY
SALDO_PENDIENTE
UPDATED_BY
UPDATED_AT
```

Formula:

```text
Pendiente Acumulado Hoy =
  saldo anterior sin liquidar
  + cobros app del dia no liquidados
  - ingreso en banco
  - gastos
```

Si `Ingreso en banco < Total a ingresar`, el resultado queda en
`SALDO_PENDIENTE` para el siguiente cierre.

## Flujo De Escritura

### Rutero con cobro

1. Valida albaran en `DSEDAC.CPC` + `DSEDAC.OPP`.
2. Inserta/actualiza `JAVIER.DELIVERY_STATUS`.
3. Inserta `JAVIER.REPARTIDOR_COBROS`.
4. Invalida caches de liquidacion, vencimientos y comisiones.

No escribe en `DSEDAC.CVC`. Durante test, el efecto sobre deuda se refleja en
app restando cobros propios. Para produccion ERP completa habra que confirmar
si el ERP espera asientos/cobros en otra tabla ademas de `LQD`.

### Liquidacion diaria

1. Lee cobros no liquidados de `JAVIER.REPARTIDOR_COBROS`.
2. Lee saldo de `JAVIER.REPARTIDOR_FINANCIAL_BALANCES`.
3. Bloquea `LQD`, `REPARTIDOR_COBROS` y `REPARTIDOR_FINANCIAL_BALANCES`.
4. Calcula siguiente numero en `<ERP_SCHEMA>.LQD`.
5. Inserta en `<ERP_SCHEMA>.LQD`.
6. Inserta ledger en `JAVIER.REPARTIDOR_LIQUIDACION_OPS`.
7. Actualiza saldo acumulado.
8. Marca cobros como liquidados.
9. Envia emails; si email falla, no revierte la liquidacion.

## Paso Test A Produccion

### Test una semana

```env
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER
```

Resultado:

- `JAVIER.LQD` recibe liquidaciones con columnas reales de ERP.
- `DSEDAC.LQD` no se toca.
- `JAVIER.REPARTIDOR_*` guarda ledger, cobros, saldos y emails.

### Produccion

Despues de validar una semana:

```env
REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC
```

Resultado:

- `DSEDAC.LQD` recibe liquidaciones reales.
- El ledger sigue en `JAVIER.REPARTIDOR_LIQUIDACION_OPS`.
- Cleanup manual sobre produccion exige cambiar `JAVIER.LQD` por `DSEDAC.LQD`
  en la plantilla y usar doble flag de seguridad en script Node.

## Verificacion Antes De Abrir A Usuarios

1. Ejecutar `020` en ACS.
2. Ejecutar `021` en ACS y comprobar todo `OK`.
3. En servidor:

```bash
cd backend
npm run finance:verify-schema
npm test -- --runInBand
```

4. En app/tablet:
   - elegir un repartidor concreto;
   - registrar un cobro en Rutero;
   - comprobar `JAVIER.REPARTIDOR_COBROS`;
   - cerrar Liquidacion Diaria;
   - comprobar `JAVIER.LQD`, `JAVIER.REPARTIDOR_LIQUIDACION_OPS` y
     `JAVIER.REPARTIDOR_FINANCIAL_BALANCES`;
   - verificar que Vencimientos resta el cobro y Comisiones recalcula.

## Limpieza Segura

Usar siempre `IDEMPOTENCY_TOKEN`.

```bash
cd backend
export ALLOW_REPARTIDOR_FINANCE_CLEANUP=true
npm run finance:cleanup -- "liq_..."
```

Para produccion:

```bash
export ALLOW_REPARTIDOR_FINANCE_CLEANUP=true
export ALLOW_PRODUCTION_REPARTIDOR_FINANCE_CLEANUP=true
npm run finance:cleanup -- "liq_..."
```

La limpieza bloquea casos peligrosos:

- no borra un cobro ya asociado a una liquidacion si se intenta borrar directo;
- no restaura saldo de una liquidacion antigua si existen cierres posteriores;
- permite liberar `DELIVERY_STATUS` solo si se pasa `--delete-delivery-status`.

## Riesgos Pendientes Antes De Produccion Total ERP

1. Confirmar tabla ERP exacta para registrar cobros contables contra cartera.
   Actualmente el cierre entra en `LQD`, pero el cobro de app no reduce
   fisicamente `DSEDAC.CVC`.
2. Confirmar email individual de repartidor. `VDD`/`VEH` no tienen email.
3. Confirmar si tipos `COB`, `PGC`, `PGP`, `PAG`, `CNP` deben aparecer en
   Vencimientos de repartidor. Hoy se mantienen fuera por seguridad.
4. Confirmar significado de `CLX.COBRORIGUROSOSN` valores `C` y `M`.
5. Validar con ERP que `JAVIER.LQD LIKE DSEDAC.LQD` es suficiente para test.
