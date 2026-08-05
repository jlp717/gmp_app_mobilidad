/**
 * APPLY: objetivos 2026 Ago-Dic adjustment (Alfonso escalera + ago 2.135M + nov/dic +100k).
 *
 * SAFETY:
 * - NEVER touches MES < 8 (Ene-Jul closed / payroll)
 * - NEVER touches COMMISSION_PAYMENTS / ventas / LACLAE
 * - Leaves code rebalance Jun→Nov/Dic intact
 *
 * Usage:
 *   node scripts/temp/apply-objetivos-2026-ago-dic.js --dry-run
 *   node scripts/temp/apply-objetivos-2026-ago-dic.js --apply
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { queryWithParams } = require('../../config/db');
const { LACLAE_SALES_FILTER } = require('../../utils/common');
const {
  applyHybridMonthlyObjectives,
  applyMonthlyObjectiveRebalances,
} = require('../../routes/objectives-hybrid-helpers');

const ANIO = 2026;
const AUG_TARGET_TOTAL = 2135000;
const NOV_ADD = 35000;
const DIC_ADD = 65000;
const ALFONSO = '15';
const ALFONSO_FINAL = { 8: 33500, 9: 34000, 10: 34500, 11: 35000, 12: 35500 };
const ACTIVE = ['02', '03', '05', '10', '13', '15', '16', '33', '35', '72', '73', '80', '81', '83', '93'];
const DESC = 'Obj Ago-Dic 2026: ago 2.135M + nov/dic +100k + Alfonso escalera casada';

function n(v) {
  return Number(v) || 0;
}
function r2(v) {
  return Math.round(n(v) * 100) / 100;
}
function money(v) {
  return r2(v).toFixed(2);
}
function pad(code) {
  return String(code).trim().replace(/^0+/, '').padStart(2, '0');
}

function roundCentsDistribute(weights, total) {
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

async function loadGlobalPinned() {
  const rows = await queryWithParams(
    `SELECT MES, SUM(IMPORTE_OBJETIVO) AS T
     FROM JAVIER.COMMERCIAL_TARGETS
     WHERE ANIO = ? AND ACTIVO = 1 AND MES IS NOT NULL
     GROUP BY MES
     HAVING COUNT(DISTINCT TRIM(CODIGOVENDEDOR)) > 1`,
    [ANIO]
  );
  const t = {};
  for (const r of rows) t[r.MES] = n(r.T);
  return t;
}

async function loadPrevYearMonthly() {
  const sales = await queryWithParams(
    `SELECT L.LCMMDC AS M, SUM(L.LCIMVT) AS S
     FROM DSED.LACLAE L
     WHERE L.LCAADC = ? AND ${LACLAE_SALES_FILTER}
     GROUP BY L.LCMMDC`,
    [ANIO - 1]
  );
  const prev = {};
  let tot = 0;
  for (const r of sales) {
    prev[r.M] = n(r.S);
    tot += n(r.S);
  }
  try {
    const b = await queryWithParams(
      `SELECT MES, SUM(IMPORTE) AS S FROM JAVIER.VENTAS_B WHERE EJERCICIO = ? GROUP BY MES`,
      [ANIO - 1]
    );
    for (const r of b) {
      prev[r.MES] = (prev[r.MES] || 0) + n(r.S);
      tot += n(r.S);
    }
  } catch (_) { /* optional */ }
  return { prev, tot };
}

async function loadAllPins() {
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOVENDEDOR) AS COD, MES, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION,
            PORCENTAJE_MEJORA, DESCRIPCION, ACTIVO
     FROM JAVIER.COMMERCIAL_TARGETS
     WHERE ANIO = ? AND ACTIVO = 1 AND MES BETWEEN 8 AND 12
     ORDER BY COD, MES`,
    [ANIO]
  );
  const by = {};
  for (const r of rows) {
    const c = pad(r.COD);
    if (!by[c]) by[c] = {};
    by[c][r.MES] = {
      obj: n(r.IMPORTE_OBJETIVO),
      base: n(r.IMPORTE_BASE_COMISION),
      pct: n(r.PORCENTAJE_MEJORA) || 10,
      desc: r.DESCRIPCION || '',
    };
  }
  return by;
}

async function vendorPrevYearMonthly(code) {
  const variants = [...new Set([code, code.replace(/^0+/, ''), code.padStart(2, '0')])];
  const ph = variants.map(() => '?').join(',');
  const rows = await queryWithParams(
    `SELECT L.LCMMDC AS M, SUM(L.LCIMVT) AS S
     FROM DSED.LACLAE L
     WHERE L.LCAADC = ? AND ${LACLAE_SALES_FILTER}
       AND TRIM(L.LCCDVD) IN (${ph})
     GROUP BY L.LCMMDC`,
    [ANIO - 1, ...variants]
  );
  const map = {};
  let tot = 0;
  for (const r of rows) {
    map[r.M] = n(r.S);
    tot += n(r.S);
  }
  return { map, tot };
}

async function currentVendorAugustObjective(code, exactPins, globalBaseline) {
  const { map, tot } = await vendorPrevYearMonthly(code);
  const hybrid = applyHybridMonthlyObjectives(map, tot > 0 ? tot : 1, 10, exactPins);
  const factors = {};
  for (let m = 1; m <= 12; m++) {
    const g = n(globalBaseline[m]);
    factors[m] = g > 0 ? n(hybrid.monthly[m]) / g : 0;
  }
  const after = applyMonthlyObjectiveRebalances(hybrid.monthly, ANIO, {
    allocationFactorsByMonth: factors,
  });
  return n(after[8]);
}

function casarPin(finalDisplay, rebalanceAmount, globalMonthValue) {
  // display = pin + amount * (pin / global) = pin * (1 + amount/global)
  return r2(finalDisplay / (1 + rebalanceAmount / globalMonthValue));
}

async function upsertPin(code, mes, obj, base, dryRun) {
  if (mes < 8) throw new Error(`REFUSED: attempted write to month ${mes}`);
  const existing = await queryWithParams(
    `SELECT COUNT(*) AS N FROM JAVIER.COMMERCIAL_TARGETS
     WHERE ANIO = ? AND MES = ? AND ACTIVO = 1
       AND TRIM(CODIGOVENDEDOR) IN (?, ?)`,
    [ANIO, mes, code, code.replace(/^0+/, '') || code]
  );
  const count = n(existing[0]?.N);
  if (dryRun) {
    console.log(`DRY ${count ? 'UPDATE' : 'INSERT'} ${code} M${mes} obj=${money(obj)} base=${money(base)}`);
    return;
  }
  if (count > 0) {
    await queryWithParams(
      `UPDATE JAVIER.COMMERCIAL_TARGETS
       SET IMPORTE_OBJETIVO = ?, IMPORTE_BASE_COMISION = ?, PORCENTAJE_MEJORA = ?,
           DESCRIPCION = ?, ACTIVO = 1
       WHERE ANIO = ? AND MES = ? AND ACTIVO = 1
         AND TRIM(CODIGOVENDEDOR) IN (?, ?)`,
      [obj, base, 10, DESC, ANIO, mes, code, code.replace(/^0+/, '') || code]
    );
  } else {
    await queryWithParams(
      `INSERT INTO JAVIER.COMMERCIAL_TARGETS
        (CODIGOVENDEDOR, ANIO, MES, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION,
         PORCENTAJE_MEJORA, DESCRIPCION, ACTIVO, VIGENTE_DESDE, CREATED_AT, CREATED_BY)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT DATE, CURRENT TIMESTAMP, ?)`,
      [code, ANIO, mes, obj, base, 10, DESC, 'SYSTEM']
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  if (!args.includes('--dry-run') && !args.includes('--apply')) {
    console.log('Defaulting to --dry-run. Pass --apply to write.');
  }
  console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===');

  const pinnedNow = await loadAllPins();
  const globalPinned = await loadGlobalPinned();
  const { prev, tot } = await loadPrevYearMonthly();
  const globalHybrid = applyHybridMonthlyObjectives(prev, tot, 10, globalPinned);
  const globalBaseline = globalHybrid.monthly;

  console.log('Global Aug baseline (app)=', money(globalBaseline[8]));
  console.log('Global Nov/Dic pins=', money(globalPinned[11]), money(globalPinned[12]));

  // Backup
  const backupPath = path.join(
    __dirname,
    `commercial-targets-ago-dic-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), pinnedNow, globalPinned, globalBaseline }, null, 2));
  console.log('Backup written:', backupPath);

  // --- August weights from current vendor August objectives ---
  const augWeights = {};
  for (const code of ACTIVE) {
    if (code === ALFONSO) continue;
    const exact = {};
    const rows = await queryWithParams(
      `SELECT MES, IMPORTE_OBJETIVO FROM JAVIER.COMMERCIAL_TARGETS
       WHERE ANIO = ? AND ACTIVO = 1 AND TRIM(CODIGOVENDEDOR) = ?`,
      [ANIO, code]
    );
    for (const r of rows) exact[r.MES] = n(r.IMPORTE_OBJETIVO);
    augWeights[code] = await currentVendorAugustObjective(code, exact, globalBaseline);
    console.log(`Aug weight ${code}=${money(augWeights[code])}`);
  }

  const augRestTotal = AUG_TARGET_TOTAL - ALFONSO_FINAL[8];
  const augPlan = roundCentsDistribute(augWeights, augRestTotal);
  augPlan[ALFONSO] = ALFONSO_FINAL[8];

  let augSum = 0;
  for (const c of ACTIVE) augSum += augPlan[c];
  console.log('August plan sum=', money(augSum), 'target=', money(AUG_TARGET_TOTAL));
  if (Math.abs(augSum - AUG_TARGET_TOTAL) > 0.05) throw new Error('August sum mismatch');

  // --- Sep/Oct: Alfonso absolute; redistribute Alfonso delta to others ---
  const plan = { 8: { ...augPlan }, 9: {}, 10: {}, 11: {}, 12: {} };

  for (const mes of [9, 10]) {
    const oldA = n(pinnedNow[ALFONSO]?.[mes]?.obj);
    const newA = ALFONSO_FINAL[mes];
    const delta = r2(oldA - newA); // positive = freed for others
    plan[mes][ALFONSO] = newA;
    const othersOld = {};
    let othersSum = 0;
    for (const c of ACTIVE) {
      if (c === ALFONSO) continue;
      othersOld[c] = n(pinnedNow[c]?.[mes]?.obj);
      othersSum += othersOld[c];
    }
    const othersNew = roundCentsDistribute(othersOld, r2(othersSum + delta));
    Object.assign(plan[mes], othersNew);
  }

  // --- Nov/Dic: target totals = old + ADD; Alfonso casar pins; others fill remainder ---
  // After writes, global Nov changes → iterate once using projected globals.
  for (const [mes, add, finalDisplay, rebalanceAmt] of [
    [11, NOV_ADD, ALFONSO_FINAL[11], 70000],
    [12, DIC_ADD, ALFONSO_FINAL[12], 50000],
  ]) {
    const oldTotal = n(globalPinned[mes]);
    const targetTotal = r2(oldTotal + add);

    // First estimate Alfonso pin using CURRENT global (good start)
    let aPin = casarPin(finalDisplay, rebalanceAmt, oldTotal + add); // use projected total as baseline for pin months
    // For pinned months, global baseline month value IS the pin sum.
    // So factor uses pin/global_pin_sum. Solve:
    // final = aPin + rebalanceAmt * (aPin / targetTotal)
    // aPin = final / (1 + rebalanceAmt/targetTotal)
    aPin = casarPin(finalDisplay, rebalanceAmt, targetTotal);

    plan[mes][ALFONSO] = aPin;
    const othersBudget = r2(targetTotal - aPin);
    const othersOld = {};
    for (const c of ACTIVE) {
      if (c === ALFONSO) continue;
      othersOld[c] = n(pinnedNow[c]?.[mes]?.obj);
    }
    const othersNew = roundCentsDistribute(othersOld, othersBudget);
    Object.assign(plan[mes], othersNew);

    const check = Object.values(plan[mes]).reduce((s, v) => s + n(v), 0);
    console.log(
      `M${mes} target=${money(targetTotal)} sum=${money(check)} Alfonso pin=${money(aPin)} → display≈${money(
        aPin + rebalanceAmt * (aPin / targetTotal)
      )}`
    );
    if (Math.abs(check - targetTotal) > 0.05) throw new Error(`M${mes} sum mismatch`);
  }

  // Print matrix
  console.log('\n=== PLAN MATRIX ===');
  console.log('COD   |      Ago |      Sep |      Oct |      Nov |      Dic');
  for (const c of ACTIVE) {
    const line = [8, 9, 10, 11, 12].map((m) => money(plan[m][c]).padStart(9)).join(' |');
    console.log(`${c}   |${line}`);
  }
  console.log(
    'TOT  |' +
      [8, 9, 10, 11, 12]
        .map((m) => money(Object.values(plan[m]).reduce((s, v) => s + n(v), 0)).padStart(9))
        .join(' |')
  );

  // Write plan artifact
  const planPath = path.join(__dirname, 'objetivos-2026-ago-dic-plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dryRun,
        AUG_TARGET_TOTAL,
        NOV_ADD,
        DIC_ADD,
        ALFONSO_FINAL,
        plan,
        backupPath,
      },
      null,
      2
    )
  );
  console.log('Plan written:', planPath);

  // Apply upserts
  for (const mes of [8, 9, 10, 11, 12]) {
    for (const c of ACTIVE) {
      const obj = r2(plan[mes][c]);
      // Commissions: Alfonso Nov/Dic use FINAL escalera as base; others obj/1.10
      let base;
      if (c === ALFONSO && (mes === 11 || mes === 12)) {
        base = r2(ALFONSO_FINAL[mes] / 1.1);
      } else {
        base = r2(obj / 1.1);
      }
      await upsertPin(c, mes, obj, base, dryRun);
    }
  }

  if (!dryRun) {
    const verify = await queryWithParams(
      `SELECT MES, COUNT(*) N, SUM(IMPORTE_OBJETIVO) T
       FROM JAVIER.COMMERCIAL_TARGETS
       WHERE ANIO = ? AND ACTIVO = 1 AND MES BETWEEN 8 AND 12
       GROUP BY MES ORDER BY MES`,
      [ANIO]
    );
    console.log('\n=== VERIFY AFTER APPLY ===');
    for (const r of verify) console.log(`M${r.MES} n=${r.N} sum=${money(r.T)}`);

    const v15 = await queryWithParams(
      `SELECT MES, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION
       FROM JAVIER.COMMERCIAL_TARGETS
       WHERE ANIO = ? AND ACTIVO = 1 AND TRIM(CODIGOVENDEDOR) = '15' AND MES BETWEEN 7 AND 12
       ORDER BY MES`,
      [ANIO]
    );
    console.log('Alfonso Jul-Dic:');
    for (const r of v15) {
      console.log(`M${r.MES} obj=${money(r.IMPORTE_OBJETIVO)} base=${money(r.IMPORTE_BASE_COMISION)}`);
    }

    // Guard: Jul unchanged
    const jul = v15.find((r) => n(r.MES) === 7);
    if (!jul || Math.abs(n(jul.IMPORTE_OBJETIVO) - 33000) > 0.01) {
      throw new Error('SAFETY FAIL: Alfonso July changed or missing');
    }
    console.log('SAFETY OK: Alfonso July still 33000');
  }

  console.log(dryRun ? '\nDry-run done. Re-run with --apply to write.' : '\nAPPLY complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
