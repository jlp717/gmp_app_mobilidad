'use strict';

const TABLE = 'JAVIER.TEST_PRECIO_COMPETITIVO';

// Latest valid row for article+client. An absent or expired row is not a price of 0.
const LOOKUP_SQL = `
SELECT ID,
       CODIGOARTICULO,
       CODIGOCLIENTE,
       CODIGOTARIFA,
       PRECIO_COMPETITIVO,
       MARGEN_PCT,
       VALIDO_DESDE,
       VALIDO_HASTA,
       USUARIO,
       UPDATED_AT
  FROM ${TABLE}
 WHERE TRIM(CODIGOARTICULO) = ?
   AND TRIM(CODIGOCLIENTE) = ?
   AND VALIDO_DESDE <= ?
   AND (VALIDO_HASTA IS NULL OR VALIDO_HASTA >= ?)
 ORDER BY VALIDO_DESDE DESC, UPDATED_AT DESC, ID DESC
 FETCH FIRST 1 ROW ONLY`;

const INSERT_SQL = `
INSERT INTO ${TABLE} (
  CODIGOARTICULO, CODIGOCLIENTE, CODIGOTARIFA, PRECIO_COMPETITIVO, MARGEN_PCT,
  VALIDO_DESDE, VALIDO_HASTA, USUARIO, CREATED_AT, UPDATED_AT
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP, CURRENT TIMESTAMP)`;

class PrecioCompetitivoError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'PrecioCompetitivoError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function column(row, name) {
  if (!row) return undefined;
  return row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()];
}

function asDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match ? match[1] : null;
}

function madridToday(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidOn(row, onDate) {
  const from = asDateOnly(row.validoDesde ?? column(row, 'VALIDO_DESDE'));
  const until = asDateOnly(row.validoHasta ?? column(row, 'VALIDO_HASTA'));
  if (!from || from > onDate) return false;
  if (until && until < onDate) return false;
  return true;
}

function rowSortKey(row) {
  return {
    from: asDateOnly(row.validoDesde ?? column(row, 'VALIDO_DESDE')) || '',
    updated: String(row.updatedAt ?? column(row, 'UPDATED_AT') ?? ''),
    id: Number(row.id ?? column(row, 'ID')) || 0,
  };
}

function selectLatestValid(rows, onDate) {
  const valid = (Array.isArray(rows) ? rows : []).filter((row) => isValidOn(row, onDate));
  valid.sort((left, right) => {
    const a = rowSortKey(left);
    const b = rowSortKey(right);
    if (a.from !== b.from) return a.from < b.from ? 1 : -1;
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
    return b.id - a.id;
  });
  return valid[0] || null;
}

function emptyState(codigoArticulo, codigoCliente) {
  return {
    success: true,
    found: false,
    codigoArticulo,
    codigoCliente,
    codigoTarifa: null,
    precioCompetitivo: null,
    margenPct: null,
    validoDesde: null,
    validoHasta: null,
    usuario: null,
    updatedAt: null,
  };
}

function toPublic(row, codigoArticulo, codigoCliente) {
  if (!row) return emptyState(codigoArticulo, codigoCliente);
  const price = Number(column(row, 'PRECIO_COMPETITIVO') ?? row.precioCompetitivo);
  const margin = Number(column(row, 'MARGEN_PCT') ?? row.margenPct);
  return {
    success: true,
    found: true,
    codigoArticulo: String(column(row, 'CODIGOARTICULO') ?? row.codigoArticulo ?? codigoArticulo).trim(),
    codigoCliente: String(column(row, 'CODIGOCLIENTE') ?? row.codigoCliente ?? codigoCliente).trim(),
    codigoTarifa: Number(column(row, 'CODIGOTARIFA') ?? row.codigoTarifa),
    precioCompetitivo: price,
    margenPct: margin,
    validoDesde: asDateOnly(column(row, 'VALIDO_DESDE') ?? row.validoDesde),
    validoHasta: asDateOnly(column(row, 'VALIDO_HASTA') ?? row.validoHasta),
    usuario: String(column(row, 'USUARIO') ?? row.usuario ?? '').trim(),
    updatedAt: column(row, 'UPDATED_AT') ?? row.updatedAt ?? null,
  };
}

function assertCode(value, label) {
  const code = String(value || '').trim();
  if (!/^[A-Za-z0-9]{1,10}$/.test(code)) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      `${label} no es válido`,
      400,
    );
  }
  return code;
}

function assertMoney(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 99999.9999) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      'El precio competitivo debe ser mayor que 0 y caber en NUMERIC(9,4)',
      400,
    );
  }
  if (Math.abs((price * 10000) - Math.round(price * 10000)) > 0.000001) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      'El precio competitivo admite como máximo cuatro decimales',
      400,
    );
  }
  return price;
}

function assertMargin(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_MARGEN_INVALID',
      'El margen debe estar entre 0 y 100',
      400,
    );
  }
  if (Math.abs((margin * 100) - Math.round(margin * 100)) > 0.000001) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_MARGEN_INVALID',
      'El margen admite como máximo dos decimales',
      400,
    );
  }
  return margin;
}

function assertDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      `${label} no es una fecha válida (AAAA-MM-DD)`,
      400,
    );
  }
  return text;
}

function parseCreateInput(body) {
  const source = body && typeof body === 'object' ? body : {};
  const codigoArticulo = assertCode(source.codigoArticulo, 'El artículo');
  const codigoCliente = assertCode(source.codigoCliente, 'El cliente');
  const codigoTarifa = Number(source.codigoTarifa);
  if (!Number.isInteger(codigoTarifa) || codigoTarifa < 0 || codigoTarifa > 99) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      'La tarifa debe ser un entero de 0 a 99',
      400,
    );
  }
  const precioCompetitivo = assertMoney(source.precioCompetitivo);
  const margenPct = assertMargin(source.margenPct);
  const validoDesde = assertDate(source.validoDesde, 'La vigencia desde');
  const validoHasta = source.validoHasta == null || source.validoHasta === ''
    ? null
    : assertDate(source.validoHasta, 'La vigencia hasta');
  if (validoHasta && validoHasta < validoDesde) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      'La vigencia hasta no puede ser anterior a la vigencia desde',
      400,
    );
  }
  const usuario = String(source.usuario || '').trim();
  if (!usuario || usuario.length > 40 || /[\u0000-\u001f]/.test(usuario)) {
    throw new PrecioCompetitivoError(
      'PRECIO_COMPETITIVO_INVALID',
      'El usuario es obligatorio (máximo 40 caracteres)',
      400,
    );
  }
  return {
    codigoArticulo,
    codigoCliente,
    codigoTarifa,
    precioCompetitivo,
    margenPct,
    validoDesde,
    validoHasta,
    usuario,
  };
}

function isMissingTable(error) {
  const message = String(error?.message || error || '');
  return /SQL0204|SQLSTATE=42704|42704/i.test(message)
    && /TEST_PRECIO_COMPETITIVO|PRECIO_COMPETITIVO/i.test(message);
}

function createPrecioCompetitivoService({ queryWithParams, clock = () => new Date() } = {}) {
  const query = queryWithParams || require('../config/db').queryWithParams;

  async function lookup({ codigoArticulo, codigoCliente, onDate }) {
    const article = assertCode(codigoArticulo, 'El artículo');
    const client = assertCode(codigoCliente, 'El cliente');
    const day = onDate || madridToday(clock());
    let rows;
    try {
      rows = await query(LOOKUP_SQL, [article, client, day, day], false, false);
    } catch (error) {
      if (isMissingTable(error)) {
        throw new PrecioCompetitivoError(
          'PRECIO_COMPETITIVO_UNAVAILABLE',
          'La tabla de precios competitivos no está creada en JAVIER (TEST). No se devuelve un precio 0.',
          503,
        );
      }
      throw new PrecioCompetitivoError(
        'PRECIO_COMPETITIVO_UNAVAILABLE',
        'No se pudo consultar el precio competitivo. Reinténtalo más tarde.',
        503,
      );
    }
    const list = Array.isArray(rows) ? rows : [];
    return toPublic(list[0] || null, article, client);
  }

  async function create(body) {
    const input = parseCreateInput(body);
    try {
      await query(INSERT_SQL, [
        input.codigoArticulo,
        input.codigoCliente,
        input.codigoTarifa,
        input.precioCompetitivo,
        input.margenPct,
        input.validoDesde,
        input.validoHasta,
        input.usuario,
      ], false, false);
    } catch (error) {
      if (isMissingTable(error)) {
        throw new PrecioCompetitivoError(
          'PRECIO_COMPETITIVO_UNAVAILABLE',
          'La tabla de precios competitivos no está creada en JAVIER (TEST).',
          503,
        );
      }
      throw new PrecioCompetitivoError(
        'PRECIO_COMPETITIVO_PERSISTENCE_FAILED',
        'No se pudo guardar el precio competitivo. Reinténtalo.',
        503,
      );
    }
    return lookup({
      codigoArticulo: input.codigoArticulo,
      codigoCliente: input.codigoCliente,
      onDate: input.validoDesde,
    });
  }

  return Object.freeze({ lookup, create });
}

module.exports = {
  TABLE,
  LOOKUP_SQL,
  INSERT_SQL,
  PrecioCompetitivoError,
  asDateOnly,
  madridToday,
  selectLatestValid,
  emptyState,
  toPublic,
  parseCreateInput,
  createPrecioCompetitivoService,
};
