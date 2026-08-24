const request = require("supertest");
const app = require("../server");
describe("GET /api/health-check-e2e", () => {
  it("WHEN GET SHALL 200 {ok:true}", async () => {
    const res = await request(app).get("/api/health-check-e2e");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ts).toBeDefined();
  });
});