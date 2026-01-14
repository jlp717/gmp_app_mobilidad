/**
 * REVERT TEST DATA SCRIPT
 * 
 * Since we have enabled SIMULATION_MODE in backend/routes/entregas.js,
 * no actual data is written to the DSEDAC tables during testing.
 * 
 * Therefore, NO REVERT ACTION IS NEEDED.
 * 
 * To restore production writing:
 * 1. Open backend/routes/entregas.js
 * 2. Set const SIMULATION_MODE = false;
 */

console.log('No data to revert. Simulation Mode was active.');
