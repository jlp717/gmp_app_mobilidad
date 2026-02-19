/**
 * TEST LOAD PLAN — Simula POST /warehouse/load-plan
 * Ejecutar: node scripts/test_load_plan.js
 */
const loadPlanner = require('../services/loadPlanner');

async function main() {
  console.log('Testing load planner...\n');

  // Find a vehicle with orders for today
  const { query } = require('../config/db');
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();

  const vehicles = await query(`
    SELECT TRIM(CODIGOVEHICULO) AS VEH, COUNT(*) AS CNT
    FROM DSEDAC.OPP
    WHERE ANOREPARTO = ${y} AND MESREPARTO = ${m} AND DIAREPARTO = ${d}
      AND TRIM(CODIGOVEHICULO) <> ''
    GROUP BY TRIM(CODIGOVEHICULO)
    ORDER BY CNT DESC
    FETCH FIRST 1 ROWS ONLY
  `);

  if (!vehicles.length) {
    console.log('No vehicles with orders today');
    process.exit(0);
  }

  const veh = vehicles[0].VEH;
  console.log(`Vehicle: ${veh} (${vehicles[0].CNT} OPP lines for ${d}/${m}/${y})\n`);

  try {
    const result = await loadPlanner.planLoad(veh, y, m, d);

    console.log('=== TRUCK ===');
    console.log(`  Code: ${result.truck.code}`);
    console.log(`  Description: ${result.truck.description}`);
    console.log(`  Max Payload: ${result.truck.maxPayloadKg} kg`);
    console.log(`  Container Vol: ${result.truck.containerVolumeM3} m³`);
    console.log(`  Interior: ${result.truck.container.lengthCm}x${result.truck.container.widthCm}x${result.truck.container.heightCm} cm`);

    console.log('\n=== METRICS ===');
    const m2 = result.metrics;
    console.log(`  Total Boxes: ${m2.totalBoxes}`);
    console.log(`  Placed: ${m2.placedCount}`);
    console.log(`  Overflow: ${m2.overflowCount}`);
    console.log(`  Volume: ${m2.usedVolumeCm3} cm³ (${m2.volumeOccupancyPct}%)`);
    console.log(`  Weight: ${m2.totalWeightKg} kg (${m2.weightOccupancyPct}%)`);
    console.log(`  Max Payload: ${m2.maxPayloadKg} kg`);
    console.log(`  Status: ${m2.status}`);

    if (result.placed.length > 0) {
      console.log('\n=== FIRST 5 PLACED BOXES ===');
      result.placed.slice(0, 5).forEach((b, i) => {
        console.log(`  [${i+1}] ${b.label} | Order: ${b.orderNumber} | Client: ${b.clientCode} | ${b.w}x${b.d}x${b.h} cm | ${b.weight.toFixed(1)} kg | pos: (${b.x},${b.y},${b.z})`);
      });
    }

    if (result.overflow.length > 0) {
      console.log(`\n=== OVERFLOW (first 3 of ${result.overflow.length}) ===`);
      result.overflow.slice(0, 3).forEach((b, i) => {
        console.log(`  [${i+1}] ${b.label} | ${b.w}x${b.d}x${b.h} cm | ${b.weight.toFixed(1)} kg`);
      });
    }

    console.log('\n✅ Load plan completed successfully!');
  } catch (e) {
    console.error(`\n❌ Load plan FAILED: ${e.message}`);
    console.error(e.stack);
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
