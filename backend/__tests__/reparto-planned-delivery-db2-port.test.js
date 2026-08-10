'use strict';

const {
  RepartoPlannedDeliveryError,
  createRepartoPlannedDeliveryDb2Port,
  parseDeliveryItemId,
} = require('../repositories/reparto-planned-delivery-db2-port');

function header(overrides = {}) {
  return {
    SUBEMPRESA: 'GMP', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A', TERMINALALBARAN: 2,
    NUMEROALBARAN: 42, CODIGOCLIENTE: 'CLI-01', NOMBRECLIENTE: 'Cliente uno', CODIGOREPARTIDOR: 'REP-1',
    EJERCICIOPEDIDO: 2026, NUMEROPEDIDO: 77, IMPORTETOTAL: '13.50', ...overrides,
  };
}

function line(overrides = {}) {
  return {
    SECUENCIA: 1, CODIGOARTICULO: 'ART-1', DESCRIPCION: 'Articulo', CANTIDADENVASES: '1',
    CANTIDADUNIDADES: '3', UNIDADMEDIDA: 'UNIDADES', PRECIOVENTA: '9', IMPORTEVENTA: '13.50',
    ...overrides,
  };
}

function financial(overrides = {}) {
  return {
    TIPODOCUMENTO: 'FRA', ORIGENDOCUMENTO: 'C', SUBEMPRESADOCUMENTO: 'GMP',
    EJERCICIODOCUMENTO: 2026, SERIEDOCUMENTO: 'A', TERMINALDOCUMENTO: 2,
    NUMERODOCUMENTO: 42, XDEDOCUMENTO: 3, DEXDOCUMENTO: 7, IMPORTEPENDIENTE: '12.50',
    ...overrides,
  };
}

function connection({ headers = [header()], lines = [line()], financials = [financial()], error } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (error) throw error;
      if (sql.includes('FROM DSEDAC.CPC CPC')) return headers;
      if (sql.includes('FROM DSEDAC.LAC LAC')) return lines;
      if (sql.includes('FROM DSEDAC.CVC CVC')) return financials;
      throw new Error('unexpected SQL');
    },
  };
}

describe('DB2 planned delivery read port', () => {
  test('parses the canonical five-part identity and safely supports hyphenated client codes', () => {
    expect(parseDeliveryItemId('2026-A-2-42-CLI-01')).toEqual({ ejercicio: 2026, serie: 'A', terminal: 2, numero: 42, cliente: 'CLI-01' });
    expect(parseDeliveryItemId('2026-A-2-42')).toEqual({ ejercicio: 2026, serie: 'A', terminal: 2, numero: 42, cliente: null });
    expect(parseDeliveryItemId('2026-A-2-42-CLI;DROP')).toBeNull();
    expect(parseDeliveryItemId('2026-A-2-0-CLI')).toBeNull();
  });

  test('uses three parameterized deterministic queries and derives CVC identity server-side', async () => {
    const db = connection();
    const port = createRepartoPlannedDeliveryDb2Port();
    const planned = await port.forConnection(db).getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1');

    expect(db.calls).toHaveLength(3);
    expect(db.calls[0].sql).toContain('OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION');
    expect(db.calls[0].sql).toContain('TRIM(OPP.SUBEMPRESA) = TRIM(CPC.SUBEMPRESAPEDIDO)');
    expect(db.calls[0].sql).toContain('TRIM(CPC.CODIGOCLIENTEALBARAN) = ?');
    expect(db.calls[0].sql).not.toContain('DSEDAC.CVC');
    expect(db.calls[0].params).toEqual([2026, 'A', 2, 42, 'REP-1', 'CLI-01']);
    expect(db.calls[1].sql).toContain('TRIM(LAC.SUBEMPRESAALBARAN) = ?');
    expect(db.calls[1].sql).toContain('LAC.CANTIDADUNIDADES > 0');
    expect(db.calls[1].sql).toContain('ORDER BY LAC.SECUENCIA, TRIM(LAC.CODIGOARTICULO)');
    expect(db.calls[1].params).toEqual(['GMP', 2026, 'A', 2, 42, 'CLI-01']);
    expect(db.calls[2].sql).toContain('FROM DSEDAC.CVC CVC');
    expect(db.calls[2].sql).toContain('FETCH FIRST 2 ROWS ONLY');
    expect(db.calls[2].params).toEqual(['GMP', 2026, 'A', 2, 42, 'CLI-01']);
    expect(planned).toEqual(expect.objectContaining({
      documentId: '2026-A-2-42-CLI-01', repartidorId: 'REP-1', importeTotal: 13.5, importePendiente: 12.5,
      cliente: { codigo: 'CLI-01', nombre: 'Cliente uno' },
      document: { subempresa: 'GMP', ejercicio: 2026, serie: 'A', terminal: 2, numero: 42 },
      financialDocumentState: 'AVAILABLE',
      financialDocument: { tipo: 'FRA', origen: 'C', subempresa: 'GMP', ejercicio: 2026, serie: 'A', terminal: 2, numero: 42, xde: 3, dex: 7 },
      lineas: [{ lineaId: '1', codigoArticulo: 'ART-1', descripcion: 'Articulo', cantidadPedida: 3, cantidadEnvases: 1, unidadMedida: 'UNIDADES', precioUnitario: 4.5, importeLinea: 13.5 }],
    }));
  });

  test('marks missing and ambiguous CVC documents as non-payable without choosing one', async () => {
    const port = createRepartoPlannedDeliveryDb2Port();
    const missing = await port.forConnection(connection({ financials: [] }))
      .getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1');
    const ambiguous = await port.forConnection(connection({
      financials: [financial(), financial({ XDEDOCUMENTO: 4 })],
    })).getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1');
    expect(missing).toMatchObject({ financialDocumentState: 'MISSING', financialDocument: null, importePendiente: 0 });
    expect(ambiguous).toMatchObject({ financialDocumentState: 'AMBIGUOUS', financialDocument: null, importePendiente: null });
  });

  test('fails closed for invalid identity, source error, missing document and ambiguous four-part identity', async () => {
    const port = createRepartoPlannedDeliveryDb2Port();
    await expect(port.forConnection(connection()).getPlannedDelivery('bad', 'REP-1')).rejects.toMatchObject({ code: 'INVALID_DELIVERY_IDENTITY', statusCode: 400 });
    await expect(port.forConnection(connection({ headers: [] })).getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1')).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND', statusCode: 404 });
    await expect(port.forConnection(connection({ headers: [header(), header({ SUBEMPRESA: 'ALT' })] })).getPlannedDelivery('2026-A-2-42', 'REP-1')).rejects.toMatchObject({ code: 'DELIVERY_IDENTITY_AMBIGUOUS', statusCode: 409 });
    await expect(port.forConnection(connection({ error: new Error('odbc') })).getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1')).rejects.toBeInstanceOf(RepartoPlannedDeliveryError);
  });

  test('never interpolates attacker-controlled values and rejects incomplete/duplicate line identities', async () => {
    const db = connection();
    const port = createRepartoPlannedDeliveryDb2Port();
    await expect(port.forConnection(db).getPlannedDelivery("2026-A-2-42-CLI'OR", 'REP-1')).rejects.toMatchObject({ statusCode: 400 });
    expect(db.calls).toHaveLength(0);
    await expect(port.forConnection(connection({ lines: [line(), line({ CODIGOARTICULO: 'ART-2' })] })).getPlannedDelivery('2026-A-2-42-CLI-01', 'REP-1')).rejects.toMatchObject({ code: 'DELIVERY_IDENTITY_AMBIGUOUS', statusCode: 409 });
  });

  test('rejects schemas other than DSEDAC before querying', () => {
    expect(() => createRepartoPlannedDeliveryDb2Port({ schema: 'JAVIER' })).toThrow(RepartoPlannedDeliveryError);
  });
});
