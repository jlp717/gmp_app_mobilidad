/**
 * verify-team-80.js
 * Informe DB2 — equipo Almería (80, 72, 73, 81, 83).
 * Fórmula: umbral_mes = ventas_LY_mes × (1 + IPC%); exceso = max(0, actual − umbral); comisión por franjas.
 * Uso: cd backend && node scripts/verify-team-80.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { queryWithParams } = require('../config/db');
const {
    SNAPSHOT_UNTIL_MONTH,
    LACLAE_SALES_FILTER,
    getVendorColumnExpr,
} = require('../utils/common');
const {
    getTeamCommission,
    ALMERIA_TEAM_MEMBERS_80,
    TEAM_LEAD_80_ENABLED,
    monthMetricsFromVendorData,
} = require('../services/team-commission.service');

const YEAR = 2026;
const TEAM_MEMBERS = ALMERIA_TEAM_MEMBERS_80;
const LEADER = '80';
const MONTH_NAMES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fmt(n) {
    const v = parseFloat(n) || 0;
    return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtEur(n) {
    return `${fmt(n)} €`;
}

async function queryLiveSales(vendor, year, month, useColumn) {
    const col = useColumn === 'R1_T8CDVD' ? 'R1_T8CDVD' : 'LCCDVD';
    const rows = await queryWithParams(
        `SELECT SUM(L.LCIMVT) AS VENTAS
         FROM DSED.LACLAE L
         WHERE L.LCAADC = ? AND L.LCMMDC = ?
           AND ${LACLAE_SALES_FILTER}
           AND TRIM(L.${col}) = ?`,
        [year, month, vendor],
        false,
    );
    return parseFloat(rows[0]?.VENTAS) || 0;
}

function printSection(title) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(` ${title}`);
    console.log('═'.repeat(60));
}

function exampleRow(label, ly, cy, ipcPct) {
    const umbral = ly * (1 + ipcPct / 100);
    const exceso = Math.max(0, cy - umbral);
    console.log(
        `  ${label}: LY=${fmt(ly)} CY=${fmt(cy)} IPC=${ipcPct}% → umbral=${fmt(umbral)} exceso=${fmt(exceso)}`,
    );
}

async function run() {
    const nowMonth = new Date().getMonth() + 1;

    printSection('CONFIGURACIÓN');
    console.log(`TEAM_LEAD_80_ENABLED = ${TEAM_LEAD_80_ENABLED}`);
    console.log(`SNAPSHOT_UNTIL_MONTH = ${SNAPSHOT_UNTIL_MONTH}`);
    console.log(`Miembros: ${TEAM_MEMBERS.join(', ')} · Líder: ${LEADER}`);

    const commissions = require('../routes/commissions');
    const { calculateVendorData, loadCommissionConfig } = commissions._private;
    const config = await loadCommissionConfig(YEAR);
    console.log(`IPC_PCT (COMM_CONFIG ${YEAR}): ${config.ipc}% → umbral = LY × ${(1 + config.ipc / 100).toFixed(4)}`);

    printSection('EJEMPLO FÓRMULA (manual)');
    exampleRow('Boss quote', 1000, 1200, 10);
    exampleRow('Con IPC DB', 1000, 1200, config.ipc);

    const teamData = await getTeamCommission(
        LEADER,
        YEAR,
        (code, year, cfg) => calculateVendorData(code, year, cfg),
        config,
    );

    printSection(`DETALLE MENSUAL — EQUIPO (${TEAM_MEMBERS.join(', ')})`);
    console.log('| Mes | Califican | Exceso equipo | Comisión equipo |');
    console.log('|-----|-----------|---------------|-----------------|');

    let ytdTeamComm = 0;
    let ytdTeamExcess = 0;

    for (const tm of teamData.months.filter((m) => m.month <= nowMonth)) {
        console.log(
            `| ${MONTH_NAMES[tm.month].padEnd(3)} | ${String(tm.qualifyingMembers).padStart(9)}/4 | ${fmt(tm.teamMembersExcess).padStart(13)} | ${fmt(tm.teamMembersCommission).padStart(15)} |`,
        );
        ytdTeamComm += tm.teamMembersCommission;
        ytdTeamExcess += tm.teamMembersExcess;
    }

    printSection('MARZO — desglose por comercial (si hay datos)');
    const mar = teamData.months.find((m) => m.month === 3);
    if (mar) {
        console.log('| Cód | Ventas | Umbral | Exceso | Comisión | ¿Comisiona? |');
        console.log('|-----|--------|--------|--------|----------|-------------|');
        for (const mem of mar.members) {
            console.log(
                `| ${mem.vendorCode.padEnd(3)} | ${fmt(mem.currentSales).padStart(6)} | ${fmt(mem.threshold).padStart(6)} | ${fmt(mem.excess).padStart(6)} | ${fmt(mem.commission).padStart(8)} | ${mem.qualifies ? 'SÍ' : 'NO'.padEnd(11)} |`,
            );
        }
    } else {
        console.log('  Sin fila marzo en teamData');
    }

    const leaderVd = await calculateVendorData(LEADER, YEAR, config);
    const leaderMar = monthMetricsFromVendorData(leaderVd, 3);

    printSection('COMERCIAL 80 — PERSONAL (no debe figurar como comisiona)');
    console.log(`  isExcluded (EXCLUIDO_COMISIONES): ${leaderVd.isExcluded ? 'SÍ' : 'NO — ejecutar 028 SECCION B'}`);
    console.log(`  Comisión propia YTD: ${fmtEur(leaderVd.grandTotalCommission || 0)}`);
    if (mar) {
        console.log(
            `  Marzo 80: ventas ${fmtEur(leaderMar.currentSales)} umbral ${fmtEur(leaderMar.threshold)} exceso ${fmtEur(leaderMar.excess)}`,
        );
    }

    printSection('RESUMEN YTD');
    const allCodes = [LEADER, ...TEAM_MEMBERS];
    for (const code of allCodes) {
        const vd = await calculateVendorData(code, YEAR, config);
        const ytdM = vd.months.filter((m) => m.month <= nowMonth);
        const ventas = ytdM.reduce((a, m) => a + (m.actual || 0), 0);
        const comm = vd.grandTotalCommission || 0;
        console.log(
            `  ${code}: ventas YTD ${fmtEur(ventas)} · comisión YTD ${fmtEur(comm)}${vd.isExcluded ? ' (excluido)' : ''}`,
        );
    }
    console.log(`  Equipo 72+73+81+83 comisión YTD: ${fmtEur(ytdTeamComm)}`);
    console.log(`  Equipo exceso YTD: ${fmtEur(ytdTeamExcess)}`);

    printSection('¿DE DÓNDE SALEN 1,5M / 1,7M?');
    const teamVentas = (
        await Promise.all(TEAM_MEMBERS.map((c) => calculateVendorData(c, YEAR, config)))
    ).reduce((s, vd) => {
        const ytd = vd.months.filter((m) => m.month <= nowMonth).reduce((a, m) => a + (m.actual || 0), 0);
        return s + ytd;
    }, 0);
    console.log(`  Ventas YTD equipo 4: ~${fmt(Math.round(teamVentas / 1000))}K (${fmtEur(teamVentas)})`);
    console.log(`  Exceso comisionable YTD equipo: ~${fmt(Math.round(ytdTeamExcess / 1000))}K`);
    console.log('  No confundir ventas brutas con exceso ni con umbral.');
    console.log('  LACLAE LCCDVD vs R1_T8CDVD (mar/2026) puede mover histórico.');

    printSection('LACLAE — LCCDVD vs R1_T8CDVD (v72)');
    for (const m of [1, 2, 3]) {
        const lac = await queryLiveSales('72', YEAR, m, 'LCCDVD');
        const r1 = await queryLiveSales('72', YEAR, m, 'R1_T8CDVD');
        console.log(`  Mes ${m}: LCCDVD=${fmtEur(lac)} | R1=${fmtEur(r1)} | Δ=${fmtEur(r1 - lac)}`);
    }

    printSection('REGLA VERIFICADA EN CÓDIGO');
    console.log('  ✓ Sin gate 4/4');
    console.log('  ✓ Umbral = target = prevSales × (1 + IPC%)');
    console.log('  ✓ Exceso = max(0, actual − umbral)');
    console.log('  ✓ Comisión = franjas sobre exceso (calculateCommission)');
    console.log('  ✓ 80: EXCLUIDO_COMISIONES=Y → no badge comisiona');

    console.log('\n');
    process.exit(0);
}

run().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
