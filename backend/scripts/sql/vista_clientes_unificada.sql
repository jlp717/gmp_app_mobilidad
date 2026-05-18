-- ============================================================================
-- VISTA UNIFICADA DE CLIENTES - Esquema JAVIER
-- Combina: DSEDAC.CLIL1 (base) + CLCL1 + CLIX + CRUT + VDDL1
-- Columnas duplicadas se prefijan con el alias de la tabla de origen
-- CRUT filtrado por SECUENCIA = 1 (ruta principal)
-- Columnas ID y MARCAACTUALIZACION omitidas por ser técnicas
-- Generado: 2026-04-27T13:47:21.902Z
-- ============================================================================

CREATE OR REPLACE VIEW JAVIER.VISTA_CLIENTES_UNIFICADA AS
SELECT
  CLIL1.CODIGOCLIENTE, -- CodigoCliente                               CLCDCL
  CLIL1.NOMBRECLIENTE, -- NombreCliente                               CLNOMB
  CLIL1.DIRECCION, -- Direccion                                   CLDIRE
  CLIL1.CODIGOPOSTAL, -- CodigoPostal                                CLCDPS
  CLIL1.SECUENCIACODIGOPOSTAL, -- SecuenciaCodigoPostal                       CLSCPS
  CLIL1.POBLACION, -- Poblacion                                   CLPOBL
  CLIL1.PROVINCIA, -- Provincia                                   CLPROV
  CLIL1.APARTADOCORREOS, -- ApartadoCorreos                             CLAPCO
  CLIL1.NIF, -- NIF                                         CLDNIC
  CLIL1.TELEFONO1, -- Telefono1                                   CLTL01
  CLIL1.TELEFONO2, -- Telefono2                                   CLTL02
  CLIL1.TELEFONOFAX, -- TelefonoFax                                 CLTLFX
  CLIL1.TIPOEMPRESA, -- TipoEmpresa                                 CLTPEM
  CLIL1.OBSERVACIONESEMPRESA, -- ObservacionesEmpresa                        CLOBEM
  CLIL1.OBSERVACIONES1, -- Observaciones1                              CLOBS1
  CLIL1.OBSERVACIONES2, -- Observaciones2                              CLOBS2
  CLIL1.OBSERVACIONES3, -- Observaciones3                              CLOBS3
  CLIL1.CLAVE1, -- Clave1                                      CLCL01
  CLIL1.CLAVE2, -- Clave2                                      CLCL02
  CLIL1.RECARGOSN, -- RecargoSN                                   CLSNRC
  CLIL1.DIAALTA, -- DiaAlta                                     CLDDAL
  CLIL1.MESALTA, -- MesAlta                                     CLMMAL
  CLIL1.ANOALTA, -- AnoAlta                                     CLAAAL
  CLIL1.CLALFC, -- FechaAltaAMD
  CLIL1.CLFCAL, -- FechaAlta
  CLIL1.DIABAJA, -- DiaBaja                                     CLDDBJ
  CLIL1.MESBAJA, -- MesBaja                                     CLMMBJ
  CLIL1.ANOBAJA, -- AnoBaja                                     CLAABJ
  CLIL1.CLBJFC, -- FechaBajaAMD
  CLIL1.CLFCBJ, -- FechaBaja
  CLIL1.DIAINICIOVACACIONES, -- DiaInicioVacaciones                         CLDDIV
  CLIL1.MESINICIOVACACIONES, -- MesInicioVacaciones                         CLMMIV
  CLIL1.ANOINICIOVACACIONES, -- AnoInicioVacaciones                         CLAAIV
  CLIL1.CLIVFC, -- FechaInicioVacacionesAMD
  CLIL1.CLFCIV, -- FechaInicioVacaciones
  CLIL1.DIAFINALVACACIONES, -- DiaFinalVacaciones                          CLDDFV
  CLIL1.MESFINALVACACIONES, -- MesFinalVacaciones                          CLMMFV
  CLIL1.ANOFINALVACACIONES, -- AnoFinalVacaciones                          CLAAFV
  CLIL1.CLFVFC, -- FechaFinalVacacionesAMD
  CLIL1.CLFCFV, -- FechaFinalVacaciones
  CLIL1.NOMBREALTERNATIVO, -- NombreAlternativo                           CLNOM1
  CLIL1.EXENTOIVASN, -- ExentoIvaSN                                 CLSNIV
  CLIL1.CODIGORUTA, -- CodigoRuta                                  CLCDZO
  CLIL1.PERSONACONTACTO, -- PersonaContacto                             CLPECO
  CLIL1.DIANACIMIENTO, -- DiaNacimiento                               CLDDNC
  CLIL1.MESNACIMIENTO, -- MesNacimiento                               CLMMNC
  CLIL1.ANONACIMIENTO, -- AnoNacimiento                               CLAANC
  CLIL1.CLNCFC, -- FechaNacimientoAMD
  CLIL1.CLFCNC, -- FechaNacimiento
  CLIL1.CODIGODELEGACION, -- CodigoDelegacion                            CLCDDL
  CLIL1.CODIGOCLIENTEENLAZADO, -- CodigoClienteEnlazado                       CLCLEN
  CLIL1.CODIGOIVA, -- CodigoIVA                                   CLCDIV
  CLIL1.CODIGOIDIOMA, -- CodigoIdioma                                CLCDID
  CLIL1.CODIGOMONEDA, -- CodigoMoneda                                CLCDMO
  CLIL1.CODIGOPAIS, -- CodigoPais                                  CLCDPA
  CLIL1.INTRACOMUNITARIOSN, -- IntracomunitarioSN                          CLSNIT
  CLIL1.CLAVELINEAFACTURA, -- ClaveLineaFactura                           CLCLLF
  CLIL1.EXPORTACIONSN, -- ExportacionSN                               CLSNEX

  -- ═══ DSEDAC.CLCL1 (Condiciones de crédito) ═══
  CLCL1.CODIGOCLIENTE AS CLCL1_CODIGOCLIENTE, -- CodigoCliente                               TCCDCL
  CLCL1.SUBEMPRESA, -- SubEmpresa                                  TCSBEM
  CLCL1.CODIGOCLIENTEFACTURA, -- CodigoClienteFactura                        TCCDFA
  CLCL1.CODIGOTARIFA, -- CodigoTarifa                                TCCDTR
  CLCL1.CODIGOFORMAPAGO1, -- CodigoFormaPago1                            TCCDFP
  CLCL1.CODIGOFORMAPAGO2, -- CodigoFormaPago2                            TCCDF2
  CLCL1.VENCIMIENTOFIJO1, -- VencimientoFijo1                            TCVT01
  CLCL1.VENCIMIENTOFIJO2, -- VencimientoFijo2                            TCVT02
  CLCL1.VENCIMIENTOFIJO3, -- VencimientoFijo3                            TCVT03
  CLCL1.CUENTABANCO, -- CuentaBanco                                 TCCTBC
  CLCL1.CODIGOPAIS AS CLCL1_CODIGOPAIS, -- CodigoPais                                  TCCDPA
  CLCL1.BICSWIFT, -- BicSwift                                    TCBIBC
  CLCL1.IBAN01, -- IBAN01                                      TCIB01
  CLCL1.IBAN02, -- IBAN02                                      TCIB02
  CLCL1.IBAN03, -- IBAN03                                      TCIB03
  CLCL1.IBAN04, -- IBAN04                                      TCIB04
  CLCL1.IBAN05, -- IBAN05                                      TCIB05
  CLCL1.IBAN06, -- IBAN06                                      TCIB06
  CLCL1.CLAUSULASBANCARIA, -- ClausulasBancaria                           TCCLBC
  CLCL1.DIRECCIONBANCO, -- DireccionBanco                              TCDIBC
  CLCL1.CODIGOPOSTALBANCO, -- CodigoPostalBanco                           TCCPBC
  CLCL1.SECUENCIACODIGOPOSTALBANCO, -- SecuenciaCodigoPostalBanco                  TCSCBC
  CLCL1.POBLACIONBANCO, -- PoblacionBanco                              TCPOBC
  CLCL1.PROVINCIABANCO, -- ProvinciaBanco                              TCPRBC
  CLCL1.PORCENTAJEDECUENTO1, -- PorcentajeDecuento1                         TCPJ11
  CLCL1.PORCENTAJEDECUENTO21, -- PorcentajeDecuento21                        TCPJ21
  CLCL1.PORCENTAJEDESCUENTO22, -- PorcentajeDescuento22                       TCPJ22
  CLCL1.PORCENTAJEDECUENTO23, -- PorcentajeDecuento23                        TCPJ23
  CLCL1.PORCENTAJEDECUENTO24, -- PorcentajeDecuento24                        TCPJ24
  CLCL1.PORCENTAJEDECUENTO25, -- PorcentajeDecuento25                        TCPJ25
  CLCL1.PORCENTAJEDECUENTO3, -- PorcentajeDecuento3                         TCPJ31
  CLCL1.PORCENTAJEDECUENTO41, -- PorcentajeDecuento41                        TCPJ41
  CLCL1.PORCENTAJEDECUENTO42, -- PorcentajeDecuento42                        TCPJ42
  CLCL1.PORCENTAJEDECUENTO43, -- PorcentajeDecuento43                        TCPJ43
  CLCL1.UNAFACTURAPORCLIENTESN, -- UnaFacturaPorClienteSN                      TCFASA
  CLCL1.IMPRIMIRRECIBOSN, -- ImprimirReciboSN                            TCRECA
  CLCL1.CUENTAVENTA, -- CuentaVenta                                 TCCTAV
  CLCL1.OFERTASN, -- OfertaSN                                    TCOFSN
  CLCL1.TIPOCLIENTE, -- TipoCliente                                 TCTIPO
  CLCL1.ALBARANESPORFACTURA, -- AlbaranesPorFactura                         TCALBA
  CLCL1.COPIASFACTURA, -- CopiasFactura                               TCFRAS
  CLCL1.COPIASALBARAN, -- CopiasAlbaran                               TCALBS
  CLCL1.BLOQUEADOSN, -- BloqueadoSN                                 TCBLQD
  CLCL1.CLIENTEESPECIALSN, -- ClienteEspecialSN                           TCSNCE
  CLCL1.ALBARANOFACTURA, -- AlbaranOFactura                             TCABFC
  CLCL1.IMPRIMIRFACTURASPENDIENTESSN, -- ImprimirFacturasPendientesSN                TCSNFP
  CLCL1.DIASLIMITECREDITO, -- DiasLimiteCredito                           TCDLCT
  CLCL1.DIASLIMITECREDITOCONFECHAALB, -- DiasLimiteCreditoConFechaAlb                TCDLFA
  CLCL1.MAXIMONUMEROFACTURASPENDIENT, -- MaximoNumeroFacturasPendient                TCMXFP
  CLCL1.IDENTICKETSN, -- IdenticketSN                                TCSNIT
  CLCL1.VALORARALBARANSN, -- ValorarAlbaranSN                            TCSNVA
  CLCL1.FACTURASCONOMSN, -- FacturasConOmSN                             TCSNOM
  CLCL1.LISTAPRECIOSN, -- ListaPrecioSN                               TCSNLP
  CLCL1.PEDIDOOBLIGATORIOSN, -- PedidoObligatorioSN                         TCSNPO
  CLCL1.SERIEFACTURACIONPORDEFECTO, -- SerieFacturacionPorDefecto                  TCSRFD
  CLCL1.CODIGOCUENTACOBRO, -- CodigoCuentaCobro                           TCCDCB
  CLCL1.VENCIMIENTOFIJODIA1, -- VencimientoFijoDia1                         TCVFD1
  CLCL1.VENCIMIENTOFIJODIA2, -- VencimientoFijoDia2                         TCVFD2
  CLCL1.VENCIMIENTOFIJODIA3, -- VencimientoFijoDia3                         TCVFD3
  CLCL1.CODIGOCANAL, -- CodigoCanal                                 TCCDCH
  CLCL1.CLAVEMANDATOSEPA, -- ClaveMandatoSepa                            TCCMSP
  CLCL1.VALORARPORENVASESSN, -- ValorarPorEnvasesSN                         TCSNVV
  CLCL1.ALBARANESTRASFACTURASN, -- AlbaranesTrasFacturaSN                      TCSNAF
  CLCL1.FACTURARCONLOCALIZACIONSN, -- FacturarConLocalizacionSN                   TCSNFL
  CLCL1.REMESASB2BSN, -- RemesasB2BSN                                TCSNB2
  CLCL1.OMITIRALBARANESSN, -- OmitirAlbaranesSN                           TCSNOA

  -- ═══ DSEDAC.CLIX (Extensión de clientes) ═══
  CLIX.CODIGOCLIENTE AS CLIX_CODIGOCLIENTE, -- CodigoCliente                               CXCDCL
  CLIX.TIPOFACTURACIONPEDIDOS, -- TipoFacturacionPedidos                      CXTPFP
  CLIX.NUMEROCOLEGIADO, -- NumeroColegiado                             CXNRCO
  CLIX.ESTABLECIMIENTOAUTORIZADOSN, -- EstablecimientoAutorizadoSN                 CXSNEA
  CLIX.ENDOSOSPERSONALIZADOSSN, -- EndososPersonalizadosSN                     CXSNEP
  CLIX.MAXIMOFACTURASPENDIENTES2, -- MaximoFacturasPendientes2                   CXM2FP
  CLIX.CODIGOCONCEPTOFACTURACION, -- CodigoConceptoFacturacion                   CXCDCP
  CLIX.COBRADOPORDEFECTOSN, -- CobradoPorDefectoSN                         CXSNCD
  CLIX.CLIENTEAQUIENSUSTITUYE, -- ClienteAQuienSustituye                      CXCDCS
  CLIX.TARAEXACTA, -- TaraExacta                                  CXTAEX
  CLIX.NIFINTRACOMUNITARIO, -- NifIntracomunitario                         CXNIFI
  CLIX.DIARECUPERACION, -- DiaRecuperacion                             CXDDRE
  CLIX.MESRECUPERACION, -- MesRecuperacion                             CXMMRE
  CLIX.ANORECUPERACION, -- AnoRecuperacion                             CXAARE
  CLIX.CODIGOSOCIO, -- CodigoSocio                                 CXCDSO
  CLIX.TIPOIDENTIFICACION, -- TipoIdentificacion                          CXL4
  CLIX.CODIGOPAIS AS CLIX_CODIGOPAIS, -- CodigoPais                                  CXL17
  CLIX.CODIGOMOTIVOBAJA, -- CodigoMotivoBaja                            CXCDMB
  CLIX.EXCELVENTASSN, -- ExcelVentasSN                               CXSNEV
  CLIX.IMPRIMIRFECHACADUCIDAD, -- ImprimirFechaCaducidad                      CXSNIC
  CLIX.CODIGOEDIQUIENPIDE, -- CodigoEdiQuienPide                          CXCEQP
  CLIX.CODIGOEDIQUIENRECIBE, -- CodigoEdiQuienRecibe                        CXCEQR
  CLIX.CODIGOEDIAQUIENSEFACTURA, -- CodigoEdiAQuienSeFactura                    CXCEQF
  CLIX.CODIGOEDIQUIENPAGA, -- CodigoEdiQuienPaga                          CXCEQA
  CLIX.DIAENLACECLIENTE, -- DiaEnlaceCliente                            CXDDEC
  CLIX.MESENLACECLIENTE, -- MesEnlaceCliente                            CXMMEC
  CLIX.ANOENLACECLIENTE, -- AnoEnlaceCliente                            CXAAEC
  CLIX.IMPRIMIRPESOSN, -- ImprimirPesoSN                              CXSNIP
  CLIX.CODIGOTIPODOCUMENTOSII, -- CodigoTipoDocumentoSii                      CXCDTS
  CLIX.CODIGOVENDEDORALTAFICHA, -- CodigoVendedorAltaFicha                     CXCDVA
  CLIX.CODIGOVENDEDORBAJAFICHA, -- CodigoVendedorBajaFicha                     CXCDVB
  CLIX.PEDIDOCONFORMADOSN, -- PedidoConformadoSN                          CXSNCO

  -- ═══ DSEDAC.CRUT (Datos de ruta, SECUENCIA=1) ═══
  CRUT.CODIGOCLIENTE AS RUT_CODIGOCLIENTE, -- CodigoCliente                               T8CDCL
  CRUT.SECUENCIA, -- Secuencia                                   T8SECU
  CRUT.DIACIERRELUNESSN, -- DiaCierreLunesSN                            T8DICL
  CRUT.DIACIERREMARTESSN, -- DiaCierreMartesSN                           T8DICM
  CRUT.DIACIERREMIERCOLESSN, -- DiaCierreMiercolesSN                        T8DICX
  CRUT.DIACIERREJUEVESSN, -- DiaCierreJuevesSN                           T8DICJ
  CRUT.DIACIERREVIERNESSN, -- DiaCierreViernesSN                          T8DICV
  CRUT.DIACIERRESABADOSN, -- DiaCierreSabadoSN                           T8DICS
  CRUT.DIACIERREDOMINGOSN, -- DiaCierreDomingoSN                          T8DICD
  CRUT.DIAINICIOVACACIONES2, -- DiaInicioVacaciones2                        T8DDI2
  CRUT.MESINICIOVACACIONES2, -- MesInicioVacaciones2                        T8MMI2
  CRUT.ANOINICIOVACACIONES2, -- AnoInicioVacaciones2                        T8AAI2
  CRUT.DIAFINALVACACIONES2, -- DiaFinalVacaciones2                         T8DDF2
  CRUT.MESFINALVACACIONES2, -- MesFinalVacaciones2                         T8MMF2
  CRUT.ANOFINALVACACIONES2, -- AnoFinalVacaciones2                         T8AAF2
  CRUT.NOMBRETELEFONO1, -- NombreTelefono1                             T8NT01
  CRUT.NOMBRETELEFONO2, -- NombreTelefono2                             T8NT02
  CRUT.CODIGOVENDEDOR AS RUT_CODIGOVENDEDOR, -- Vendedor asignado en ruta
  CRUT.DIAVISITALUNESSN, -- DiaVisitaLunesSN                            T8DIVL
  CRUT.DIAVISITAMARTESSN, -- DiaVisitaMartesSN                           T8DIVM
  CRUT.DIAVISITAMIERCOLESSN, -- DiaVisitaMiercolesSN                        T8DIVX
  CRUT.DIAVISITAJUEVESSN, -- DiaVisitaJuevesSN                           T8DIVJ
  CRUT.DIAVISITAVIERNESSN, -- DiaVisitaViernesSN                          T8DIVV
  CRUT.DIAVISITASABADOSN, -- DiaVisitaSabadoSN                           T8DIVS
  CRUT.DIAVISITADOMINGOSN, -- DiaVisitaDomingoSN                          T8DIVD
  CRUT.ORDENVISITALUNES, -- OrdenVisitaLunes                            T8ORVL
  CRUT.ORDENVISITAMARTES, -- OrdenVisitaMartes                           T8ORVM
  CRUT.ORDENVISITAMIERCOLES, -- OrdenVisitaMiercoles                        T8ORVX
  CRUT.ORDENVISITAJUEVES, -- OrdenVisitaJueves                           T8ORVJ
  CRUT.ORDENVISITAVIERNES, -- OrdenVisitaViernes                          T8ORVV
  CRUT.ORDENVISITASABADO, -- OrdenVisitaSabado                           T8ORVS
  CRUT.ORDENVISITADOMINGO, -- OrdenVisitaDomingo                          T8ORVD
  CRUT.DIAREPARTOLUNESSN, -- DiaRepartoLunesSN                           T8DIRL
  CRUT.DIAREPARTOMARTESSN, -- DiaRepartoMartesSN                          T8DIRM
  CRUT.DIAREPARTOMIERCOLESSN, -- DiaRepartoMiercolesSN                       T8DIRX
  CRUT.DIAREPARTOJUEVESSN, -- DiaRepartoJuevesSN                          T8DIRJ
  CRUT.DIAREPARTOVIERNESSN, -- DiaRepartoViernesSN                         T8DIRV
  CRUT.DIAREPARTOSABADOSN, -- DiaRepartoSabadoSN                          T8DIRS
  CRUT.DIAREPARTODOMINGOSN, -- DiaRepartoDomingoSN                         T8DIRD
  CRUT.ORDENREPARTOLUNES, -- OrdenRepartoLunes                           T8ORRL
  CRUT.ORDENREPARTOMARTES, -- OrdenRepartoMartes                          T8ORRM
  CRUT.ORDENREPARTOMIERCOLES, -- OrdenRepartoMiercoles                       T8ORRX
  CRUT.ORDENREPARTOJUEVES, -- OrdenRepartoJueves                          T8ORRJ
  CRUT.ORDENREPARTOVIERNES, -- OrdenRepartoViernes                         T8ORRV
  CRUT.ORDENRAPARTOSABADO, -- OrdenRapartoSabado                          T8ORRS
  CRUT.ORDENREPARTODOMINGO, -- OrdenRepartoDomingo                         T8ORRD
  CRUT.TIPOVISITA, -- TipoVisita                                  T8TPVI
  CRUT.FRECUENCIAVISITA, -- FrecuenciaVisita                            T8FRVI
  CRUT.OBSERVACIONESREPARTO, -- ObservacionesReparto                        T8OBSE
  CRUT.FORMAPEDIDO, -- FormaPedido                                 T8FOPD
  CRUT.HORALLAMADA, -- HoraLlamada                                 T8HRLL
  CRUT.HORAVISITA, -- HoraVisita                                  T8HRVI
  CRUT.HORAREPARTODESDE, -- HoraRepartoDesde                            T8HRRD
  CRUT.HORAREPARTOHASTA, -- HoraRepartoHasta                            T8HRRH
  CRUT.DIAMESINICIOCAMPANA, -- DiaMesInicioCampana                         T8DMIC
  CRUT.DIAMESFINCAMPANA, -- DiaMesFinCampana                            T8DMFC
  CRUT.CAMBIARFECHASERVICIOENPEDIDO, -- CambiarFechaServicioEnPedido                T8SNCS

  -- ═══ DSEDAC.VDDL1 (Vendedores, vía CRUT.CODIGOVENDEDOR) ═══
  VDDL1.NOMBREVENDEDOR, -- NombreVendedor                              VDNOMB
  VDDL1.DIRECCION AS VDD_DIRECCION, -- Direccion                                   VDDIRE
  VDDL1.CODIGOPOSTAL AS VDD_CODIGOPOSTAL, -- CodigoPostal                                VDCDPS
  VDDL1.SECUENCIACODIGOPOSTAL AS VDD_SECUENCIACODIGOPOSTAL, -- SecuenciaCodigoPostal                       VDSCPS
  VDDL1.POBLACION AS VDD_POBLACION, -- Poblacion                                   VDPOBL
  VDDL1.PROVINCIA AS VDD_PROVINCIA, -- Provincia                                   VDPROV
  VDDL1.APARTADOCORREOS AS VDD_APARTADOCORREOS, -- ApartadoCorreos                             VDAPCO
  VDDL1.NIF AS VDD_NIF, -- NIF                                         VDDNIC
  VDDL1.TELEFONO1 AS VDD_TELEFONO1, -- Telefono1                                   VDTL01
  VDDL1.TELEFONO2 AS VDD_TELEFONO2, -- Telefono2                                   VDTL02
  VDDL1.TELEFONOFAX AS VDD_TELEFONOFAX, -- TelefonoFax                                 VDTLFX
  VDDL1.OBSERVACIONES, -- Observaciones                               VDOBSE
  VDDL1.CLAVE1 AS VDD_CLAVE1, -- Clave1                                      VDCL01
  VDDL1.CLAVE2 AS VDD_CLAVE2, -- Clave2                                      VDCL02
  VDDL1.CODIGOREFERENCIAVENDEDOR, -- CodigoReferenciaVendedor                    VDCDRV
  VDDL1.IMPRIMIRETIQUETASN, -- ImprimirEtiquetaSN                          VDSNET

FROM DSEDAC.CLIL1 CLIL1
LEFT JOIN DSEDAC.CLCL1 CLCL1
  ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(CLIL1.CODIGOCLIENTE)
LEFT JOIN DSEDAC.CLIX CLIX
  ON TRIM(CLIX.CODIGOCLIENTE) = TRIM(CLIL1.CODIGOCLIENTE)
LEFT JOIN DSEDAC.CRUT CRUT
  ON TRIM(CRUT.CODIGOCLIENTE) = TRIM(CLIL1.CODIGOCLIENTE)
  AND CRUT.SECUENCIA = 1
LEFT JOIN DSEDAC.VDDL1 VDDL1
  ON TRIM(VDDL1.CODIGOVENDEDOR) = TRIM(CRUT.CODIGOVENDEDOR);
