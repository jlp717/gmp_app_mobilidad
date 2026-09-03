"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const specPath = path.join(root, "docs", "openapi", "openapi.yaml");
const routeSources = [
  { file: "backend/routes/docs.js", prefix: "" },
  { file: "backend/routes/health-probes.js", prefix: "/health" },
  { file: "backend/routes/auth.js", prefix: "/api/auth" },
  { file: "backend/routes/health-check-e2e.js", prefix: "/api/health-check-e2e" },
  { file: "backend/routes/repartidor-finanzas.js", prefix: "/api/repartidor-finanzas" },
  { file: "backend/routes/repartidor.js", prefix: "/api/repartidor" },
  { file: "backend/routes/repartidor-history-routes.js", prefix: "/api/repartidor" },
  { file: "backend/routes/repartidor-document-routes.js", prefix: "/api/repartidor" },
  { file: "backend/routes/entregas.js", prefix: "/api/entregas" },
  { file: "backend/routes/dashboard.js", prefix: "/api/dashboard" },
  { file: "backend/routes/analytics.js", prefix: "/api/analytics" },
  { file: "backend/routes/master.js", prefix: "/api" },
  { file: "backend/routes/planner.js", prefix: "/api" },
  { file: "backend/routes/objectives.js", prefix: "/api/objectives" },
  { file: "backend/routes/export.js", prefix: "/api/export" },
  { file: "backend/routes/chatbot.js", prefix: "/api/chatbot" },
  { file: "backend/routes/filters.js", prefix: "/api/filters" },
  { file: "backend/routes/user-actions.js", prefix: "/api/logs" },
  { file: "backend/routes/facturas.js", prefix: "/api/facturas" },
  { file: "backend/routes/warehouse.js", prefix: "/api/warehouse" },
  { file: "backend/routes/bolsa.js", prefix: "/api/bolsa" },
  { file: "backend/routes/evolution.js", prefix: "/api/evolution" },
  { file: "backend/routes/pedidos.js", prefix: "/api/pedidos" },
  { file: "backend/routes/cobros.js", prefix: "/api/cobros" },
  { file: "backend/routes/clients.js", prefix: "/api/clients" },
  { file: "backend/routes/commissions.js", prefix: "/api/commissions" },
  { file: "backend/routes/products.js", prefix: "/api/products" },
  { file: "backend/kpi/routes.js", prefix: "/api/kpi" },
];
const dddFile = "backend/src/shared/routes/ddd-adapters.js";
const serverFile = "backend/server.js";
const serverSource = fs.readFileSync(path.join(root, serverFile), "utf8");
const appImport = /const app = require\(["']\.\/([^"']+)["']\)/.exec(serverSource)?.[1];
const runtimeApplicationFile = appImport ? `backend/${appImport}.js` : serverFile;
const applicationSourceFiles = [...new Set([serverFile, runtimeApplicationFile])];
const mountedDddFactories = [
  "createAuthRoutes",
  "createPedidosRoutes",
  "createCobrosRoutes",
  "createClientsRoutes",
  "createCommissionsRoutes",
];
const methods = ["get", "post", "put", "patch", "delete"];
const methodSet = new Set(methods);

function isExcludedSource(file) {
  return /(?:\.tmp(?:\.|$)|\.orig(?:\.|$))/i.test(path.basename(file));
}

function joinPaths(prefix, suffix) {
  const joined = `${prefix}/${suffix}`.replace(/\/+/g, "/");
  return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

function toSpecPath(actualPath) {
  const withoutApi = actualPath.replace(/^\/api(?=\/|$)/, "") || "/";
  return withoutApi
    .replace(/:([A-Za-z_]\w*)\([^/]+\)/g, ":$1")
    .replace(/:([A-Za-z_]\w*)/g, "{$1}");
}

function extractRoutes(source, owner) {
  const routes = new Set();
  const regex = /router\.(get|post|put|delete|patch)\s*\(\s*(["'`])([^"'`]+)\2/g;
  for (const match of source.matchAll(regex)) {
    routes.add(`${match[1]} ${toSpecPath(joinPaths(owner.prefix, match[3]))}`);
  }
  return routes;
}

function extractInlineRoutes(source) {
  const routes = new Set();
  const regex = /app\.(get|post|put|delete|patch)\s*\(\s*(["'`])([^"'`]+)\2/g;
  for (const match of source.matchAll(regex)) {
    routes.add(`${match[1]} ${toSpecPath(match[3])}`);
  }
  return routes;
}

function extractDddMounts(serverSource) {
  const factoryByVariable = new Map();
  for (const match of serverSource.matchAll(/(ddd\w+Routes)\s*=\s*dddAdapters\.(create\w+Routes)\(\)/g)) {
    factoryByVariable.set(match[1], match[2]);
  }

  const mounts = new Map();
  for (const match of serverSource.matchAll(/app\.use\(\s*(["'])(\/api(?:\/[^"']*)?)\1\s*,([^;]+)\);/g)) {
    const [, , prefix, middleware] = match;
    const directFactory = /dddAdapters\.(create\w+Routes)\(\)/.exec(middleware)?.[1];
    if (directFactory) mounts.set(directFactory, prefix);
    for (const [variable, factory] of factoryByVariable) {
      if (new RegExp(`\\b${variable}\\b`).test(middleware)) mounts.set(factory, prefix);
    }
  }
  return [...mounts].map(([factory, prefix]) => ({ factory, prefix }));
}

function dddFactoryBoundaries(source) {
  const factories = [...source.matchAll(/^function (create\w+Routes)\(/gm)].map((match) => match[1]);
  return new Map(factories.map((factory, index) => [factory, factories[index + 1] || null]));
}

function factorySource(source, factory, nextFactory) {
  const start = source.indexOf(`function ${factory}(`);
  const end = nextFactory
    ? source.indexOf(`function ${nextFactory}(`, start + 1)
    : source.indexOf("module.exports", start + 1);
  if (start < 0 || end < 0) throw new Error(`DDD factory boundary not found: ${factory}`);
  return source.slice(start, end);
}

function sortSet(values) {
  return [...values].sort();
}

function runtimeDocsProbe(nodeEnv, extraEnv = {}) {
  const probe = [
    'const request = require("supertest");',
    'const runtime = require("./server");',
    'const app = runtime.app || runtime;',
    'request(app).get("/docs.json").set("User-Agent", "GMP-OpenAPI-Contract-Test/1.0").then((res) => {',
    '  process.stdout.write("DOCS_PROBE:" + JSON.stringify({ status: res.status, openapi: res.body.openapi, pathCount: Object.keys(res.body.paths || {}).length, code: res.body.code }) + "\\n");',
    '  process.exit(0);',
    '}).catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(2); });',
  ].join(" ");
  const env = { ...process.env };
  const production = nodeEnv === "production";
  for (const name of [
    "SWAGGER_BASIC_USER",
    "SWAGGER_BASIC_PASS",
    "DOCS_PUBLIC",
    "REPARTO_CONFIRMATION_TABLE_SET",
    "DB2_WRITE_SCHEMA",
    "DB2_READ_SCHEMA",
    "PEDIDOS_CONFIRMATION_SCHEMA",
  ]) delete env[name];
  Object.assign(env, {
    NODE_ENV: nodeEnv,
    DOCS_PUBLIC: "true",
    SKIP_PRODUCTION_CONFIG_VALIDATION: "true",
    USE_TS_ROUTES: "false",
    USE_DDD_ROUTES: "false",
    CORS_ORIGIN: "http://localhost",
    REPARTO_ENVIRONMENT: production ? "production" : "test",
    REPARTO_TABLE_SET: production ? "production" : "isolated_test",
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: "24",
    REPARTO_WRITES_ENABLED: "false",
    REPARTO_PRODUCTION_WRITES_APPROVED: "false",
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: "false",
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: "false",
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: "false",
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: "false",
    ODBC_DSN: "GMP",
    REPARTIDOR_FINANCE_READ_SCHEMA: "DSEDAC",
    REPARTIDOR_FINANCE_APP_SCHEMA: "JAVIER",
    REPARTIDOR_FINANCE_ERP_SCHEMA: production ? "DSEDAC" : "JAVIER",
    ...extraEnv,
  });
  const result = spawnSync(process.execPath, ["-e", probe], {
    cwd: path.join(root, "backend"),
    encoding: "utf8",
    timeout: 110000,
    env,
  });
  const markerLine = (result.stdout || "").split(/\r?\n/).find((line) => line.startsWith("DOCS_PROBE:"));
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr,
    response: markerLine ? JSON.parse(markerLine.slice("DOCS_PROBE:".length)) : null,
  };
}

describe("OpenAPI contract", () => {
  test("matches every registered Express route and nothing else", () => {
    const implemented = new Set();
    for (const source of routeSources.filter(({ file }) => !isExcludedSource(file))) {
      const text = fs.readFileSync(path.join(root, source.file), "utf8");
      for (const route of extractRoutes(text, source)) implemented.add(route);
    }

    const runtimeApplicationSource = fs.readFileSync(path.join(root, runtimeApplicationFile), "utf8");
    const dddSource = fs.readFileSync(path.join(root, dddFile), "utf8");
    const docsMountPosition = runtimeApplicationSource.indexOf("app.use(docsRoutes)");
    const normalizationPosition = runtimeApplicationSource.indexOf("// Path normalization");
    expect(docsMountPosition).toBeGreaterThanOrEqual(0);
    expect(docsMountPosition).toBeLessThan(normalizationPosition);

    const dddMounts = extractDddMounts(runtimeApplicationSource);
    const boundaries = dddFactoryBoundaries(dddSource);
    expect(sortSet(dddMounts.map(({ factory }) => factory))).toEqual(sortSet(mountedDddFactories));
    for (const source of dddMounts) {
      const nextFactory = boundaries.get(source.factory);
      if (nextFactory === undefined) throw new Error(`DDD factory not found: ${source.factory}`);
      for (const route of extractRoutes(factorySource(dddSource, source.factory, nextFactory), source)) {
        implemented.add(route);
      }
    }

    for (const file of applicationSourceFiles.filter((name) => !isExcludedSource(name))) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      for (const route of extractInlineRoutes(text)) implemented.add(route);
    }

    const spec = yaml.load(fs.readFileSync(specPath, "utf8"));
    const documented = new Set();
    for (const [specPathKey, pathItem] of Object.entries(spec.paths || {})) {
      for (const method of Object.keys(pathItem || {})) {
        if (methodSet.has(method)) documented.add(`${method} ${specPathKey}`);
      }
    }

    expect(sortSet(documented)).toEqual(sortSet(implemented));
    expect(spec.servers.map(({ url }) => url)).toEqual(["/api", "/api/v1"]);
    expect(spec.paths["/health/version-check"].get.servers.map(({ url }) => url)).toEqual(["/", "/api"]);
    expect(spec.paths["/health/live"].get.servers[0].url).toBe("/");
    expect(spec.paths["/health/ready"].get.responses[503]).toBeDefined();
  });
});

describe("OpenAPI documentation quality", () => {
  const spec = yaml.load(fs.readFileSync(specPath, "utf8"));
  const operations = Object.entries(spec.paths).flatMap(([routePath, pathItem]) =>
    methods.filter((method) => pathItem[method]).map((method) => ({ routePath, operation: pathItem[method] })),
  );

  test("every operation has descriptions, examples, security, and valid path parameters", () => {
    const operationIds = new Set();
    for (const { routePath, operation } of operations) {
      expect(operation.summary).toEqual(expect.any(String));
      expect(operation.description).toEqual(expect.any(String));
      expect(operation.tags).not.toHaveLength(0);
      expect(operation.operationId).toEqual(expect.any(String));
      expect(operationIds.has(operation.operationId)).toBe(false);
      operationIds.add(operation.operationId);

      const security = operation.security === undefined ? spec.security : operation.security;
      expect(Array.isArray(security)).toBe(true);

      const declaredPathParameters = new Set((operation.parameters || [])
        .filter((parameter) => parameter.in === "path" && parameter.required)
        .map((parameter) => parameter.name));
      for (const name of [...routePath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])) {
        expect(declaredPathParameters.has(name)).toBe(true);
      }

      for (const response of Object.values(operation.responses)) {
        const media = Object.values(response.content || {})[0];
        expect(media).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(media, "example")).toBe(true);
      }
    }
  });
});

describe("runtime API documentation mount", () => {
  jest.setTimeout(120000);

  test("serves the spec through the application exported by server.js", () => {
    const publicResult = runtimeDocsProbe("test");
    expect(publicResult.error).toBeUndefined();
    expect(publicResult.status).toBe(0);
    expect(publicResult.response).toEqual({
      status: 200,
      openapi: "3.1.0",
      pathCount: expect.any(Number),
    });
    expect(publicResult.response.pathCount).toBeGreaterThan(0);
  });
});

describe("API documentation router", () => {
  const envNames = ["NODE_ENV", "DOCS_PUBLIC", "SWAGGER_BASIC_USER", "SWAGGER_BASIC_PASS"];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

  function createApp(env = {}) {
    for (const name of envNames) delete process.env[name];
    Object.assign(process.env, env);
    jest.resetModules();
    const express = require("express");
    const app = express();
    app.use(require("../routes/docs"));
    return app;
  }

  afterEach(() => {
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    jest.resetModules();
  });

  test("is public only when explicitly enabled outside production", async () => {
    const request = require("supertest");
    const app = createApp({ NODE_ENV: "development", DOCS_PUBLIC: "true" });
    await request(app).get("/docs/").expect(200).expect(/swagger-ui/);
    await request(app).get("/docs.json").expect(200).expect(({ body }) => {
      expect(body.openapi).toBe("3.1.0");
    });
    await request(app).get("/docs/swagger-ui-init.js").expect(200).expect(/persistAuthorization.*true/s);
  });

  test("fails closed when documentation credentials are not configured", async () => {
    const request = require("supertest");
    await request(createApp({ NODE_ENV: "development" })).get("/docs.json").expect(503);
    const productionApp = createApp({ NODE_ENV: "production", DOCS_PUBLIC: "true" });
    await request(productionApp).get("/docs.json").expect(503);
    await request(productionApp).get("/docs/").expect(503);
  });

  test("uses browser Basic Auth for JSON, UI, and assets in production", async () => {
    const request = require("supertest");
    const app = createApp({
      NODE_ENV: "production",
      DOCS_PUBLIC: "true",
      SWAGGER_BASIC_USER: "docs-user",
      SWAGGER_BASIC_PASS: "docs-pass",
    });
    const authorization = `Basic ${Buffer.from("docs-user:docs-pass").toString("base64")}`;

    await request(app).get("/docs.json").expect(401).expect("WWW-Authenticate", /Basic/);
    await request(app).get("/docs.json").set("Authorization", "Basic invalid").expect(401);
    await request(app).get("/docs.json").set("Authorization", authorization).expect(200);
    await request(app).get("/docs/swagger-ui.css").set("Authorization", authorization).expect(200);
    await request(app).get("/docs/swagger-ui-init.js")
      .set("Authorization", authorization)
      .expect(200)
      .expect(/persistAuthorization.*false/s);
  });
});
