const path = require("path");
Object.assign(process.env, {
  NODE_ENV: "test",
  GMP_ENV_FILE: path.join(__dirname, "__missing-health-env"),
  REPARTO_ENVIRONMENT: "test",
  REPARTO_TABLE_SET: "isolated_test",
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: "24",
  REPARTO_WRITES_ENABLED: "true",
  REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: "false",
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: "false",
  ODBC_DSN: "GMP",
  REPARTIDOR_FINANCE_READ_SCHEMA: "DSEDAC",
  REPARTIDOR_FINANCE_APP_SCHEMA: "JAVIER",
  REPARTIDOR_FINANCE_ERP_SCHEMA: "JAVIER",
});
const request = require("supertest");
const app = require("../server");
describe("GET /api/health-check-e2e", () => {
  it("WHEN GET SHALL 200 {ok:true}", async () => {
    const res = await request(app).get("/api/health-check-e2e").set("User-Agent", "GMP-SRE-HealthCheck/1.0");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ts).toBeDefined();
  });
});