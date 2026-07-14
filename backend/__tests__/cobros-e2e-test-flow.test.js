'use strict';

const RUN = process.env.RUN_JAVIER_E2E === '1';
const describeIf = RUN ? describe : describe.skip;

describeIf('cobros E2E test flow (JAVIER sandbox)', () => {
  let queryWithParams;
  let getPool;
  let Db2CobrosRepository;
  let comercialLiquidacionService;
  let pdfService;
  let cleanupIds = [];
  let paymentTokensToCheck = [];
  let cleanupLiqMarcas = [];
  let cobrosCounterBefore = null;

  beforeAll(async () => {
    process.env.DB2_WRITE_SCHEMA = 'JAVIER';
    process.env.DB2_READ_SCHEMA = 'DSEDAC';
    process.env.ALLOW_DSEDAC_APP_BUFFERS = 'false';
    const { getDb2WriteSchema } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('JAVIER');

    const db = require('../config/db');
    const originalGetPool = db.getPool.bind(db);
    db.getPool = (...args) => {
      const pool = originalGetPool(...args);
      if (!pool.__e2eSqlDiagnosticsWrapped) {
        const originalConnect = pool.connect.bind(pool);
        pool.connect = async (...connectArgs) => {
          const conn = await originalConnect(...connectArgs);
          if (conn.query && !conn.__e2eSqlDiagnosticsWrapped) {
            const originalQuery = conn.query.bind(conn);
            conn.query = async (sql, ...queryArgs) => {
              try {
                return await originalQuery(sql, ...queryArgs);
              } catch (err) {
                const sqlPreview = String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 160);
                console.error('[E2E_SQL]', sqlPreview, {
                  odbcErrors: err && err.odbcErrors,
                  message: err && err.message,
                });
                throw err;
              }
            };
            Object.defineProperty(conn, '__e2eSqlDiagnosticsWrapped', { value: true });
          }
          return conn;
        };
        Object.defineProperty(pool, '__e2eSqlDiagnosticsWrapped', { value: true });
      }
      return pool;
    };
    queryWithParams = db.queryWithParams;
    getPool = db.getPool;

    const repoModule = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    Db2CobrosRepository = repoModule.Db2CobrosRepository;

    comercialLiquidacionService = require('../services/comercial-liquidacion.service');
    pdfService = require('../services/comercial-liquidacion-pdf.service');

    try {
      const counterRows = await queryWithParams(
        `SELECT SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NEXT_NUMERO
           FROM JAVIER.COBROS_NUMERO_COUNTER
          FETCH FIRST 10 ROWS ONLY`,
        [],
      );
      cobrosCounterBefore = counterRows;
    } catch (_) {
      cobrosCounterBefore = null;
    }
  });

  afterEach(async () => {
    const liqMarcasToCheck = [...cleanupLiqMarcas];
    const idsToCheck = [...cleanupIds];

    for (const token of paymentTokensToCheck) {
      try {
        const tokenRows = await queryWithParams(
          `SELECT IDEMPOTENCY_TOKEN, SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO
             FROM JAVIER.COBROS_IDEMPOTENCY
            WHERE IDEMPOTENCY_TOKEN = ?`,
          [token],
        );

        for (const row of tokenRows) {
          const id = {
            idempotencyToken: row.IDEMPOTENCY_TOKEN,
            subempresa: row.SUBEMPRESA,
            ejercicio: row.EJERCICIO,
            serie: row.SERIE,
            terminal: row.TERMINAL,
            numero: row.NUMERO,
          };
          const exists = idsToCheck.some((current) => (
            current.idempotencyToken === id.idempotencyToken ||
            (
              current.subempresa === id.subempresa &&
              current.ejercicio === id.ejercicio &&
              current.serie === id.serie &&
              current.terminal === id.terminal &&
              current.numero === id.numero
            )
          ));
          if (!exists) {
            idsToCheck.push(id);
            cleanupIds.push(id);
          }
        }
      } catch (_) { /* best effort */ }
    }

    for (const marca of cleanupLiqMarcas) {
      try {
        await queryWithParams(
          `DELETE FROM JAVIER.COBROS_LIQ WHERE MARCASINCRONIZACION = ?`,
          [marca],
        );
      } catch (_) { /* best effort */ }
    }
    cleanupLiqMarcas = [];

    for (const id of cleanupIds) {
      try {
        await queryWithParams(
          `DELETE FROM JAVIER.COBROS_LIN WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
          [id.subempresa, id.ejercicio, id.serie, id.terminal, id.numero],
        );
      } catch (_) { /* best effort */ }
      try {
        await queryWithParams(
          `DELETE FROM JAVIER.COBROS_CAB WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
          [id.subempresa, id.ejercicio, id.serie, id.terminal, id.numero],
        );
      } catch (_) { /* best effort */ }
      try {
        await queryWithParams(
          `DELETE FROM JAVIER.COBROS_IDEMPOTENCY WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
          [id.subempresa, id.ejercicio, id.serie, id.terminal, id.numero],
        );
      } catch (_) { /* best effort */ }
    }

    for (const token of paymentTokensToCheck) {
      try {
        await queryWithParams(
          `DELETE FROM JAVIER.COBROS_IDEMPOTENCY WHERE IDEMPOTENCY_TOKEN = ?`,
          [token],
        );
      } catch (_) { /* best effort */ }
    }
    cleanupIds = [];
    paymentTokensToCheck = [];

    for (const id of idsToCheck) {
      const tokenRows = await queryWithParams(
        `SELECT COUNT(*) AS COUNT FROM JAVIER.COBROS_IDEMPOTENCY WHERE IDEMPOTENCY_TOKEN = ?`,
        [id.idempotencyToken],
      );
      expect(Number(tokenRows[0].COUNT)).toBe(0);

      const cabRows = await queryWithParams(
        `SELECT COUNT(*) AS COUNT FROM JAVIER.COBROS_CAB WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
        [id.subempresa, id.ejercicio, id.serie, id.terminal, id.numero],
      );
      expect(Number(cabRows[0].COUNT)).toBe(0);

      const linRows = await queryWithParams(
        `SELECT COUNT(*) AS COUNT FROM JAVIER.COBROS_LIN WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
        [id.subempresa, id.ejercicio, id.serie, id.terminal, id.numero],
      );
      expect(Number(linRows[0].COUNT)).toBe(0);
    }

    for (const marca of liqMarcasToCheck) {
      const liqRows = await queryWithParams(
        `SELECT COUNT(*) AS COUNT FROM JAVIER.COBROS_LIQ WHERE MARCASINCRONIZACION = ?`,
        [marca],
      );
      expect(Number(liqRows[0].COUNT)).toBe(0);
    }

    if (cobrosCounterBefore && cobrosCounterBefore.length > 0) {
      try {
        const conn = await getPool().connect();
        try {
          for (const row of cobrosCounterBefore) {
            const currentRows = await conn.query(
              `SELECT NEXT_NUMERO
                 FROM JAVIER.COBROS_NUMERO_COUNTER
                WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ?`,
              [row.SUBEMPRESA, row.EJERCICIO, row.SERIE, row.TERMINAL],
            );
            const beforeNumero = Number(row.NEXT_NUMERO);
            const currentNumero = currentRows.length > 0
              ? Number(currentRows[0].NEXT_NUMERO)
              : null;

            if (currentNumero === beforeNumero + 1) {
              await conn.query(
                `UPDATE JAVIER.COBROS_NUMERO_COUNTER SET NEXT_NUMERO = ? WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ?`,
                [row.NEXT_NUMERO, row.SUBEMPRESA, row.EJERCICIO, row.SERIE, row.TERMINAL],
              );
            } else if (currentNumero !== beforeNumero) {
              console.warn(
                'Skipping COBROS_NUMERO_COUNTER rollback; current NEXT_NUMERO changed unexpectedly',
                {
                  subempresa: row.SUBEMPRESA,
                  ejercicio: row.EJERCICIO,
                  serie: row.SERIE,
                  terminal: row.TERMINAL,
                  beforeNumero,
                  currentNumero,
                },
              );
            }
          }
        } finally {
          await conn.close();
        }
      } catch (_) { /* best effort */ }
    }
  });

  test('full cobros flow: registerPayment -> closeLiquidacion -> PDF buffer', async () => {
    let stage = 'start';

    try {
    stage = 'candidate-select';
    const cvcRows = await queryWithParams(
      `SELECT CVC.CODIGOCLIENTEALBARAN AS CLIENTE,
              CVC.SERIEDOCUMENTO AS SERIE,
              CVC.NUMERODOCUMENTO AS NUMERO,
              CVC.IMPORTEPENDIENTE AS PENDIENTE,
              CVC.TIPODOCUMENTO AS TIPO_DOC,
              CVC.SUBEMPRESADOCUMENTO AS SUBEMPRESA,
              CVC.EJERCICIODOCUMENTO AS EJERCICIO,
              CVC.TERMINALDOCUMENTO AS TERMINAL,
              CVC.XDEDOCUMENTO AS XDE,
              CVC.DEXDOCUMENTO AS DEX,
              CVC.ORIGENDOCUMENTO AS ORIGEN,
              (SELECT TRIM(MIN(CLP.VENDEDORCOMERCIAL))
                 FROM DSEDAC.CLP CLP
                WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
              ) AS VENDEDOR
         FROM DSEDAC.CVC CVC
        WHERE CVC.IMPORTEPENDIENTE > 1.00
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IS NOT NULL
               AND TRIM(CLP.VENDEDORCOMERCIAL) <> ''
          )
        ORDER BY CVC.IMPORTEPENDIENTE ASC
        FETCH FIRST 1 ROW ONLY`,
      [],
    );

    expect(cvcRows.length).toBe(1);
    const doc = cvcRows[0];
    const clientCode = String(doc.CLIENTE).trim();
    const vendorCode = String(doc.VENDEDOR).trim();
    const serie = String(doc.SERIE).trim();
    const numero = Number(doc.NUMERO);
    const pendiente = Number(doc.PENDIENTE);

    expect(clientCode).toBeTruthy();
    expect(vendorCode).toBeTruthy();
    expect(pendiente).toBeGreaterThan(1.0);

    const stableReference = [
      'CVC',
      String(doc.TIPO_DOC).trim(),
      String(doc.ORIGEN).trim(),
      String(doc.SUBEMPRESA).trim(),
      String(doc.EJERCICIO),
      serie,
      String(doc.TERMINAL),
      String(numero),
      String(doc.XDE || 0),
      String(doc.DEX || 0),
    ].join(':');

    const repo = new Db2CobrosRepository();
    const idempotencyToken = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    paymentTokensToCheck.push(idempotencyToken);

    stage = 'register-payment';
    const paymentResult = await repo.registerPayment({
      clientCode,
      amount: 1,
      paymentMethod: 'C',
      reference: stableReference,
      observations: 'E2E test payment',
      userId: vendorCode,
      userRole: 'COMERCIAL',
      isJefeVentas: false,
      idempotencyToken,
    });

    expect(paymentResult).toBeDefined();
    expect(paymentResult.status).toMatch(/REGISTRADO|PARCIAL|COBRADO/);
    expect(paymentResult.amount).toBe(1);
    expect(paymentResult.clientCode).toBe(clientCode);

    stage = 'read-idempotency';
    const idempotencyRows = await queryWithParams(
      `SELECT IDEMPOTENCY_TOKEN, STATUS, REQUEST_HASH, SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO
         FROM JAVIER.COBROS_IDEMPOTENCY
        WHERE IDEMPOTENCY_TOKEN = ?`,
      [idempotencyToken],
    );
    expect(idempotencyRows.length).toBeGreaterThan(0);
    expect(idempotencyRows[0].STATUS).toBe('COMPLETED');

    const cobroId = idempotencyRows[0];
    const cobroNumero = cobroId.NUMERO;
    cleanupIds.push({
      idempotencyToken: cobroId.IDEMPOTENCY_TOKEN,
      subempresa: cobroId.SUBEMPRESA,
      ejercicio: cobroId.EJERCICIO,
      serie: cobroId.SERIE,
      terminal: cobroId.TERMINAL,
      numero: cobroNumero,
    });

    stage = 'read-cab';
    const cabRows = await queryWithParams(
      `SELECT SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO, CLIENTE, IMPORTECOBRADO, FORMAPAGO
         FROM JAVIER.COBROS_CAB
        WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
      [cobroId.SUBEMPRESA, cobroId.EJERCICIO, cobroId.SERIE, cobroId.TERMINAL, cobroNumero],
    );
    expect(cabRows.length).toBe(1);
    expect(Number(cabRows[0].IMPORTECOBRADO)).toBe(1);

    stage = 'read-lin';
    const linRows = await queryWithParams(
      `SELECT SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO, CLIENTE, IMPORTECOBRADO, DOCUMENTONUMERO
         FROM JAVIER.COBROS_LIN
        WHERE SUBEMPRESA = ? AND EJERCICIO = ? AND SERIE = ? AND TERMINAL = ? AND NUMERO = ?`,
      [cobroId.SUBEMPRESA, cobroId.EJERCICIO, cobroId.SERIE, cobroId.TERMINAL, cobroNumero],
    );
    expect(linRows.length).toBeGreaterThan(0);
    expect(Number(linRows[0].IMPORTECOBRADO)).toBe(1);

    stage = 'close-liquidacion';
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const closeDate = `${yyyy}-${mm}-${dd}`;
    const liqIdempotencyKey = `liq-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cleanupLiqMarcas.push(liqIdempotencyKey.slice(0, 30));

    const closeResult = await comercialLiquidacionService.closeLiquidacion({
      vendedorId: vendorCode,
      date: closeDate,
      idempotencyKey: liqIdempotencyKey,
      ingresoBanco: 1,
      entregado: 0,
      sendEmail: false,
      totals: {
        efectivo: 1,
        tarjeta: 0,
        totalCobros: 1,
        saldoActual: 0,
        totalAIngresar: 1,
      },
    });

    expect(closeResult).toBeDefined();
    expect(closeResult.created).toBe(true);
    expect(closeResult.liquidacion).toBeDefined();
    expect(closeResult.liquidacion.vendedorId).toBe(vendorCode);

    stage = 'read-liq';
    const liqRows = await queryWithParams(
      `SELECT SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO, VENDEDOR,
              EFECTIVOIMPORTE, TOTALAINGRESAR, INGRESOENBANCO, ESPECIALENTREGADO,
              MARCASINCRONIZACION
         FROM JAVIER.COBROS_LIQ
        WHERE MARCASINCRONIZACION = ?`,
      [liqIdempotencyKey.slice(0, 30)],
    );
    expect(liqRows.length).toBe(1);
    expect(Number(liqRows[0].EFECTIVOIMPORTE)).toBe(1);
    expect(Number(liqRows[0].TOTALAINGRESAR)).toBe(1);
    expect(Number(liqRows[0].INGRESOENBANCO)).toBe(1);
    expect(Number(liqRows[0].ESPECIALENTREGADO)).toBe(0);

    stage = 'pdf';
    const pdfBuffer = await pdfService.buildLiquidacionPdfBuffer({
      vendor: { code: vendorCode, name: `E2E Vendor ${vendorCode}` },
      summary: {
        date: closeDate,
        efectivo: 1,
        tarjeta: 0,
        totalCobros: 1,
        saldoActual: 0,
        totalAIngresar: 1,
        ingresoBanco: 1,
        deltaBanco: 0,
      },
      liquidacion: { entregado: 0, ingresoBanco: 1 },
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(100);
    expect(pdfBuffer.slice(0, 5).toString('utf8')).toMatch(/%PDF/);

    stage = 'email-payload';
    const emailPayload = pdfService.buildLiquidacionEmailPayload({
      vendor: { code: vendorCode, email: 'e2e-test@example.test' },
      summary: { date: closeDate },
      pdfFilename: `Liquidacion_e2e_${vendorCode}_${closeDate}.pdf`,
    });

    expect(emailPayload).toBeDefined();
    expect(emailPayload.to).toBe('e2e-test@example.test');
    expect(emailPayload.subject).toMatch(/Liquidacion/);
    expect(emailPayload.pdfFilename).toMatch(/e2e/);

    const result = {
      status: 'PASS',
      summary: {
        clientCode,
        vendorCode,
        documentReference: stableReference,
        paymentAmount: 1,
        paymentStatus: paymentResult.status,
        cobroNumero,
        liquidacionCreated: closeResult.created,
        pdfBufferBytes: pdfBuffer.length,
        emailPayloadTo: emailPayload.to,
      },
      evidence: {
        idempotencyToken,
        liqIdempotencyKey,
        cobrosIdempotencyRows: idempotencyRows.length,
        cobrosCabRows: cabRows.length,
        cobrosLinRows: linRows.length,
        cobrosLiqRows: liqRows.length,
        pdfIsBuffer: Buffer.isBuffer(pdfBuffer),
        pdfHeader: pdfBuffer.slice(0, 5).toString('utf8'),
      },
      changes: [
        'JAVIER.COBROS_IDEMPOTENCY: 1 row inserted and verified',
        'JAVIER.COBROS_CAB: 1 row inserted and verified',
        'JAVIER.COBROS_LIN: 1+ row inserted and verified',
        'JAVIER.COBROS_LIQ: 1 row inserted and verified',
        'PDF buffer generated via comercial-liquidacion-pdf.service (no email sent)',
      ],
      risks: [
        'Counter rollback is best-effort; if afterEach fails, NEXT_NUMERO may drift',
        'Test uses live DSEDAC.CVC data; document availability depends on ERP state',
        'registerPayment calls findOrderForPayment which queries both PEDIDOS_CAB and CVC',
      ],
      next_step: 'Review test output; if PASS, consider promoting to CI with DB2 sandbox credentials',
    };

    expect(result.status).toBe('PASS');
    } catch (err) {
      console.error('[E2E_STAGE]', stage, err.message, err.odbcErrors || err.errors || '');
      throw err;
    }
  }, 60000);
});

if (!RUN) {
  describe('cobros E2E test flow (skipped)', () => {
    test.skip('set RUN_JAVIER_E2E=1 to run against JAVIER sandbox', () => {});
  });
}
