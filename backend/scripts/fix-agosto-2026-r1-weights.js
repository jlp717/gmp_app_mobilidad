/**
 * FIX: recalculate August 2026 COMMERCIAL_TARGETS pins using R1_T8CDVD
 * (objective vendor column) weights, not LCCDVD.
 *
 * Bug: apply-objetivos-2026-ago-dic.js weighted August with LCCDVD hybrid,
 * inflating vendor 80 from ~318k (R1*1.10) to 410611.
 *
 * Keeps: Alfonso 33500, total August 2135000, other months untouched.
 *
 *   node scripts/temp/fix-agosto-2026-r1-weights.js --dry-run
 *   node scripts/temp/fix-agosto-2026-r1-weights.js --apply
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { queryWithParams } = require('../../config/db');
const { LACLAE_SALES_FILTER } = require('../../utils/common');

const ANIO = 2026;
const MES = 8;
const AUG_TOTAL = 2135000;
const ALFONSO = '15';
const ALFONSO_AUG = 33500;
const ACTIVE = ['02', '03', '05', '10', '13', '15', '16', '33', '35', '72', '73', '80', '81', '83', '93'];
const DESC = 'Obj Ago 2026 recalc R1 weights (fix 80 LCCDVD inflate)';

function n(v) { return Number(v) || 0; }
function r2(v) { return Math.round(n(v) * 100) / 100; }
function money(v) { return r2(v).toFixed(2); }
function pad(c) {
  const raw = String(c).trim().replace(/^0+/, '') || '0';
  return raw.padStart(2, '0');
}

function distribute(weights, total) {
  const codes = Object.keys(weights).sort();
  const wSum = codes.reduce((s, c) => s + n(weights[c]), 0);
  const out = {};
  let assigned = 0;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (i === codes.length - 1) {
      out[c] = r2(total - assigned);
    } else {
      const v = wSum > 0 ? r2((weights[c] / wSum) * total) : r2(total / codes.length);
      out[c] = v;
      assigned = r2(assigned + v);
    }
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '=== APPLY ===' : '=== DRY RUN ===');

  const rows = await queryWithParams(
    `SELECT TRIM(L.R1_T8CDVD) AS COD, SUM(L.LCIMVT) AS SALES
     FROM DSED.LACLAE L
     WHERE L.LCYEAB = 2025 AND L.LCMMDC = 8 AND ${LACLAE_SALES_FILTER}
     GROUP BY TRIM(L.R1_T8CDVD)`,
    []
  );
  const salesR1 = {};
  for (const r of rows) {
    const c = pad(r.COD);
    if (!ACTIVE.includes(c) || c === ALFONSO) continue;
    salesR1[c] = (salesR1[c] || 0) + n(r.SALES);
  }

  // Also show LCCDVD for comparison
  const rowsL = await queryWithParams(
    `SELECT TRIM(L.LCCDVD) AS COD, SUM(L.LCIMVT) AS SALES
     FROM DSED.LACLAE L
     WHERE L.LCYEAB = 2025 AND L.LCMMDC = 8 AND ${LACLAE_SALES_FILTER}
     GROUP BY TRIM(L.LCCDVD)`,
    []
  );
  const salesL = {};
  for (const r of rowsL) salesL[pad(r.COD)] = n(r.SALES);

  const current = await queryWithParams(
    `SELECT TRIM(CODIGOVENDEDOR) COD, IMPORTE_OBJETIVO
     FROM JAVIER.COMMERCIAL_TARGETS
     WHERE ANIO=? AND MES=? AND ACTIVO=1`,
    [ANIO, MES]
  );
  const curMap = {};
  for (const r of current) curMap[pad(r.COD)] = n(r.IMPORTE_OBJETIVO);

  const weights = {};
  for (const c of ACTIVE) {
    if (c === ALFONSO) continue;
    weights[c] = (salesR1[c] || 0) * 1.10; // LY+10% objective baseline
  }

  const plan = distribute(weights, AUG_TOTAL - ALFONSO_AUG);
  plan[ALFONSO] = ALFONSO_AUG;

  console.log('COD | Aug25 R1 | Aug25 LCCDVD | pin HOY | pin NUEVO | delta');
  let sum = 0;
  for (const c of ACTIVE) {
    const neu = plan[c];
    sum += neu;
    console.log(
      `${c} | ${money(salesR1[c] || 0).padStart(10)} | ${money(salesL[c] || 0).padStart(10)} | ${money(curMap[c] || 0).padStart(10)} | ${money(neu).padStart(10)} | ${money(neu - (curMap[c] || 0)).padStart(10)}`
    );
  }
  console.log('SUM nuevo', money(sum), 'target', money(AUG_TOTAL));
  if (Math.abs(sum - AUG_TOTAL) > 0.05) throw new Error('sum mismatch');

  console.log('\n80 detail: R1*1.10=', money((salesR1['80'] || 0) * 1.1), 'new pin=', money(plan['80']));

  if (!apply) {
    console.log('\nDry-run done. Pass --apply to UPDATE August pins only.');
    process.exit(0);
  }

  for (const c of ACTIVE) {
    const obj = plan[c];
    const base = r2(obj / 1.1);
    await queryWithParams(
      `UPDATE JAVIER.COMMERCIAL_TARGETS
       SET IMPORTE_OBJETIVO = ?, IMPORTE_BASE_COMISION = ?, DESCRIPCION = ?
       WHERE ANIO = ? AND MES = ? AND ACTIVO = 1
         AND TRIM(CODIGOVENDEDOR) IN (?, ?)`,
      [obj, base, DESC, ANIO, MES, c, String(parseInt(c, 10))]
    );
    console.log(`UPDATED ${c} Aug → ${money(obj)}`);
  }

  const verify = await queryWithParams(
    `SELECT TRIM(CODIGOVENDEDOR) COD, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION
     FROM JAVIER.COMMERCIAL_TARGETS WHERE ANIO=? AND MES=? AND ACTIVO=1 ORDER BY COD`,
    [ANIO, MES]
  );
  let vSum = 0;
  console.log('\n=== VERIFY AUG ===');
  for (const r of verify) {
    vSum += n(r.IMPORTE_OBJETIVO);
    console.log(`${pad(r.COD)} obj=${money(r.IMPORTE_OBJETIVO)} base=${money(r.IMPORTE_BASE_COMISION)}`);
  }
  console.log('SUM', money(vSum));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
