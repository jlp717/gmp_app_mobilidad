/**
 * Ejecuta la migracion 027: TEAM_COMMISSION_CONFIG
 * Crea las tablas de configuracion de comisiones de equipo y datos iniciales.
 *
 * Uso: cd backend && node scripts/run-migration-027.js
 */

require('dotenv').config();
const odbc = require('odbc');

function buildConnStr() {
  const uid = process.env.ODBC_UID || '';
  const pwd = process.env.ODBC_PWD || '';
  return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;`;
}

async function main() {
  let conn;
  try {
    const connStr = buildConnStr();
    console.log('[027] Conectando a DSN=GMP...');
    conn = await odbc.connect(connStr);
    console.log('[027] Conexion establecida.');

    const statements = [
      `CREATE TABLE JAVIER.TEAM_COMMISSION_RULES (
        ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
        LEADER_CODE VARCHAR(20) NOT NULL,
        YEAR INTEGER NOT NULL,
        COMMISSION_RATE DECIMAL(5,2) NOT NULL DEFAULT 0.70,
        GROWTH_THRESHOLD_PCT DECIMAL(5,2) NOT NULL DEFAULT 10.00,
        ALL_MUST_QUALIFY CHAR(1) NOT NULL DEFAULT 'Y',
        ACTIVE CHAR(1) NOT NULL DEFAULT 'Y',
        CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ID)
      )`,
      `CREATE TABLE JAVIER.TEAM_COMMISSION_MEMBERS (
        ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
        RULE_ID INTEGER NOT NULL,
        MEMBER_CODE VARCHAR(20) NOT NULL,
        ACTIVE CHAR(1) NOT NULL DEFAULT 'Y',
        CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ID)
      )`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_RULES
        (LEADER_CODE, YEAR, COMMISSION_RATE, GROWTH_THRESHOLD_PCT, ALL_MUST_QUALIFY, ACTIVE)
       VALUES ('80', 2026, 0.70, 10.00, 'Y', 'Y')`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '72' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '73' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '80' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '81' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '83' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
      `INSERT INTO JAVIER.TEAM_COMMISSION_MEMBERS (RULE_ID, MEMBER_CODE)
       SELECT ID, '86' FROM JAVIER.TEAM_COMMISSION_RULES WHERE LEADER_CODE = '80' AND YEAR = 2026`,
    ];

    for (let i = 0; i < statements.length; i++) {
      try {
        await conn.query(statements[i]);
        console.log(`[027] OK ${i + 1}/${statements.length}`);
      } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('42710')) {
          console.log(`[027] SKIP ${i + 1} (ya existe)`);
        } else if (msg.includes('SQL0803') || msg.includes('duplicate')) {
          console.log(`[027] SKIP ${i + 1} (dato duplicado)`);
        } else {
          console.error(`[027] ERR ${i + 1}: ${msg}`);
        }
      }
    }

    // Verify
    const rules = await conn.query(`SELECT * FROM JAVIER.TEAM_COMMISSION_RULES`);
    console.log(`[027] Reglas: ${rules.length}`);
    const members = await conn.query(`
      SELECT m.MEMBER_CODE, r.LEADER_CODE, r.COMMISSION_RATE,
             r.GROWTH_THRESHOLD_PCT, r.ALL_MUST_QUALIFY
      FROM JAVIER.TEAM_COMMISSION_MEMBERS m
      JOIN JAVIER.TEAM_COMMISSION_RULES r ON m.RULE_ID = r.ID
      WHERE r.ACTIVE = 'Y' AND m.ACTIVE = 'Y'
    `);
    console.log(`[027] Miembros activos: ${members.length}`);
    members.forEach(m => {
      console.log(`  ${m.MEMBER_CODE} | lider:${m.LEADER_CODE} | rate:${m.COMMISSION_RATE}% | umbral:${m.GROWTH_THRESHOLD_PCT}% | all:${m.ALL_MUST_QUALIFY}`);
    });
    console.log('[027] DONE');
  } catch (err) {
    console.error('[027] FATAL:', err.message);
    process.exit(1);
  } finally {
    if (conn) { try { await conn.close(); } catch {} }
  }
}

main();
