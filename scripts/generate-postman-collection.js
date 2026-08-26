"use strict";

const fs = require("fs");
const path = require("path");

function loadYaml() {
  try {
    return require("js-yaml");
  } catch (_error) {
    return require("../backend/node_modules/js-yaml");
  }
}

const root = path.resolve(__dirname, "..");
const specPath = path.join(root, "docs", "openapi", "openapi.yaml");
const outputPath = path.join(root, "docs", "postman", "gmp-api.postman_collection.json");
const spec = loadYaml().load(fs.readFileSync(specPath, "utf8"));

function sampleFromSchema(schema = {}) {
  if (schema.example !== undefined) return schema.example;
  if (schema.type === "array") return [sampleFromSchema(schema.items || {})];
  if (schema.type === "object" || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties || {})
      .map(([key, value]) => [key, sampleFromSchema(value)]));
  }
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return 0;
  return "";
}

function requestBase(pathItem, operation) {
  const serverUrl = (operation.servers || pathItem.servers || spec.servers || [])[0]?.url || "/api";
  if (serverUrl === "/") return "{{rootUrl}}";
  if (serverUrl === "/api") return "{{baseUrl}}";
  if (serverUrl === "/api/v1") return "{{v1BaseUrl}}";
  if (/^https?:\/\//i.test(serverUrl)) return serverUrl.replace(/\/$/, "");
  return `{{rootUrl}}${serverUrl.replace(/\/$/, "")}`;
}

function fallbackCollection() {
  const folders = new Map();
  const inheritedSecurity = spec.security || [];

  for (const [openapiPath, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] || "Otros";
      if (!folders.has(tag)) folders.set(tag, []);

      const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];
      const requestPath = openapiPath.replace(/\{([^}]+)\}/g, ":$1");
      const query = parameters.filter((parameter) => parameter.in === "query").map((parameter) => ({
        key: parameter.name,
        value: String(parameter.example ?? parameter.schema?.example ?? ""),
        disabled: parameter.required !== true,
      }));
      const security = operation.security === undefined ? inheritedSecurity : operation.security;
      const securitySchemes = new Set(security.flatMap((requirement) => Object.keys(requirement)));
      const headers = securitySchemes.has("bearerAuth")
        ? [{ key: "Authorization", value: "Bearer {{bearerToken}}", type: "text" }]
        : [];
      const base = requestBase(pathItem, operation);
      const request = {
        method: method.toUpperCase(),
        header: headers,
        url: {
          raw: `${base}${requestPath}`,
          host: [base],
          path: requestPath.split("/").filter(Boolean),
          query,
        },
        description: operation.description || operation.summary || "",
      };

      if (securitySchemes.has("swaggerBasic")) {
        request.auth = {
          type: "basic",
          basic: [
            { key: "username", value: "{{swaggerBasicUser}}", type: "string" },
            { key: "password", value: "{{swaggerBasicPass}}", type: "string" },
          ],
        };
      }

      const media = operation.requestBody?.content?.["application/json"];
      if (media) {
        request.header.push({ key: "Content-Type", value: "application/json", type: "text" });
        request.body = {
          mode: "raw",
          raw: JSON.stringify(media.example ?? sampleFromSchema(media.schema), null, 2),
          options: { raw: { language: "json" } },
        };
      }
      folders.get(tag).push({ name: operation.summary || `${method.toUpperCase()} ${openapiPath}`, request });
    }
  }

  return {
    info: {
      name: "GMP Movilidad API",
      description: "Generada desde docs/openapi/openapi.yaml. Ejemplos ficticios.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "rootUrl", value: "http://localhost:3335" },
      { key: "baseUrl", value: "http://localhost:3335/api" },
      { key: "v1BaseUrl", value: "http://localhost:3335/api/v1" },
      { key: "bearerToken", value: "" },
      { key: "swaggerBasicUser", value: "" },
      { key: "swaggerBasicPass", value: "" },
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(fallbackCollection(), null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);
