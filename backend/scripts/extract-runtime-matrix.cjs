'use strict';

// Static inventory only. Sources are parsed as text/AST and are never imported.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const METHODS = new Set(['use', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const PROTECTED_NAME = /^(?:\.env[^/]*|.*\.(?:pem|key)|tokens[^/]*\.json|cline_mcp_settings\.json|CREDENCIALES\.md)$/i;
const SUPPORTED_MODES = Object.freeze([
  Object.freeze({ id: 'legacy', useDddRoutes: false, useTsRoutes: false }),
  Object.freeze({ id: 'ddd', useDddRoutes: true, useTsRoutes: false }),
]);

function isProtectedPath(file) { return path.resolve(file).split(path.sep).some((part) => PROTECTED_NAME.test(part)); }
function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function hasSafeRootAncestry(root) {
  let current = path.resolve(root);
  while (true) {
    if (isProtectedPath(current)) return false;
    let entry;
    try { entry = fs.lstatSync(current); } catch (_) { return false; }
    if (entry.isSymbolicLink()) return false;
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

// Reject links instead of following them: no scan can escape its chosen root.
function safeSourcePath(root, candidate) {
  const safeRoot = path.resolve(root);
  const safeCandidate = path.resolve(candidate);
  if (!hasSafeRootAncestry(safeRoot) || !isInside(safeRoot, safeCandidate) || isProtectedPath(safeCandidate)) return null;
  let current = safeRoot;
  for (const part of path.relative(safeRoot, safeCandidate).split(path.sep).filter(Boolean)) {
    if (PROTECTED_NAME.test(part)) return null;
    current = path.join(current, part);
    let entry;
    try { entry = fs.lstatSync(current); } catch (_) { return null; }
    if (entry.isSymbolicLink()) return null;
  }
  return safeCandidate;
}
function safeRead(root, candidate) {
  const safe = safeSourcePath(root, candidate);
  return safe ? fs.readFileSync(safe, 'utf8') : null;
}
function sourceFile(file, source) { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS); }
function lineOf(file, node) { return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1; }
function literal(node) { return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null; }
function location(file, node) { return { file: file.fileName, line: lineOf(file, node) }; }

function propertyCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  if (!ts.isIdentifier(node.expression.expression) || !METHODS.has(node.expression.name.text)) return null;
  return { receiver: node.expression.expression.text, method: node.expression.name.text };
}
function requireTarget(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1
    ? literal(node.arguments[0]) : null;
}
function resolveLocalModule(root, fromFile, target) {
  if (!target || !target.startsWith('.')) return null;
  const candidate = path.resolve(path.dirname(fromFile), target);
  for (const suffix of ['', '.js', '.ts', '.cjs', '/index.js', '/index.ts']) {
    const safe = safeSourcePath(root, candidate + suffix);
    if (safe) return safe;
  }
  return null;
}
function collectAliases(root, file, ast) {
  const aliases = new Map();
  function setAlias(name, target) { const resolved = resolveLocalModule(root, file, target); if (resolved) aliases.set(name, resolved); }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) { const target = node.initializer && requireTarget(node.initializer); if (target) setAlias(node.name.text, target); }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { const target = requireTarget(node.right); if (target) setAlias(node.left.text, target); }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return aliases;
}
function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return null;
}
function conditionDescriptor(file, node) {
  if (ts.isParenthesizedExpression(node)) return conditionDescriptor(file, node.expression);
  if (ts.isIdentifier(node) && node.text === 'USE_DDD_ROUTES') return { kind: 'known-ddd', ...location(file, node) };
  if (ts.isIdentifier(node) && node.text === 'USE_TS_ROUTES') return { kind: 'known-ts', ...location(file, node) };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return { kind: 'not', operand: conditionDescriptor(file, node.operand), ...location(file, node) };
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    return { kind: node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'and' : 'or', left: conditionDescriptor(file, node.left), right: conditionDescriptor(file, node.right), ...location(file, node) };
  }
  return { kind: 'unknown', ...location(file, node) };
}
function handlerReference(file, argument) {
  if (ts.isIdentifier(argument)) return { kind: 'identifier', name: argument.text, ...location(file, argument) };
  if (ts.isCallExpression(argument) && ts.isPropertyAccessExpression(argument.expression) && ts.isIdentifier(argument.expression.expression)) return { kind: 'factory', receiver: argument.expression.expression.text, name: argument.expression.name.text, ...location(file, argument) };
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return { kind: 'inline-function', ...location(file, argument) };
  return { kind: 'expression', ...location(file, argument) };
}

function parseBackendFile(root, file) {
  const source = safeRead(root, file);
  if (source === null) return null;
  const ast = sourceFile(file, source);
  const aliases = collectAliases(root, file, ast);
  const routerNames = new Set(['app']);
  const records = [];
  function gatherRouters(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'express' && expression.name.text === 'Router') routerNames.add(node.name.text);
      if (ts.isIdentifier(expression) && expression.text === 'Router') routerNames.add(node.name.text);
    }
    ts.forEachChild(node, gatherRouters);
  }
  gatherRouters(ast);
  function visit(node, conditions = [], owner = null) {
    if (ts.isIfStatement(node)) {
      const condition = conditionDescriptor(ast, node.expression);
      visit(node.thenStatement, [...conditions, condition], owner);
      if (node.elseStatement) visit(node.elseStatement, [...conditions, { kind: 'not', operand: condition, ...location(ast, node.expression) }], owner);
      return;
    }
    const nextOwner = functionName(node) || owner;
    const call = propertyCall(node);
    if (call && routerNames.has(call.receiver) && !(call.receiver === 'app' && call.method === 'get' && node.arguments.length < 2)) {
      const routePath = node.arguments[0] ? literal(node.arguments[0]) : null;
      records.push({ source: 'static-declared', ...location(ast, node), receiver: call.receiver, method: call.method.toUpperCase(), path: routePath, dynamicPath: routePath == null, handlers: node.arguments.slice(routePath == null ? 0 : 1).map((arg) => handlerReference(ast, arg)), conditions, owner: nextOwner });
    }
    ts.forEachChild(node, (child) => visit(child, conditions, nextOwner));
  }
  visit(ast);
  return { file, aliases, records };
}

function backendFiles(root) {
  const files = [];
  function walk(directory) {
    if (!safeSourcePath(root, directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const safe = !isProtectedPath(target) && safeSourcePath(root, target);
      if (!safe) continue;
      if (entry.isDirectory()) walk(safe);
      else if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name)) files.push(safe);
    }
  }
  walk(path.join(root, 'routes')); walk(path.join(root, 'src', 'shared', 'routes'));
  return files.sort();
}

function evaluateCondition(condition, mode) {
  function evaluate(node) {
    if (node.kind === 'known-ddd') return { known: true, value: mode.useDddRoutes };
    if (node.kind === 'known-ts') return { known: true, value: mode.useTsRoutes };
    if (node.kind === 'not') { const child = evaluate(node.operand); return child.known ? { known: true, value: !child.value } : child; }
    if (node.kind === 'and' || node.kind === 'or') {
      const left = evaluate(node.left); const right = evaluate(node.right); const and = node.kind === 'and';
      if (and && left.known && !left.value) return left;
      if (!and && left.known && left.value) return left;
      if (left.known && right.known) return { known: true, value: and ? left.value && right.value : left.value || right.value };
    }
    return { known: false, value: null };
  }
  return evaluate(condition);
}
function conditionApplies(conditions, mode) {
  let unknown = false;
  for (const condition of conditions) { const decision = evaluateCondition(condition, mode); if (decision.known && !decision.value) return { applies: false, unknown: false }; if (!decision.known) unknown = true; }
  return { applies: true, unknown };
}
function combinedPath(prefix, child) { return prefix == null || child == null ? null : prefix === '/' ? child : `${prefix.replace(/\/$/, '')}/${child.replace(/^\//, '')}`; }

function flutterConsumers(repoRoot) {
  const records = [];
  function callBody(source, start) {
    const open = source.indexOf('(', start); let depth = 0; let quote = null; let escaped = false;
    for (let i = open; i >= 0 && i < source.length; i += 1) { const char = source[i]; if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char; else if (char === '(') depth += 1; else if (char === ')' && --depth === 0) return source.slice(open + 1, i); }
    return null;
  }
  function firstArgument(body) {
    const value = body.trim(); const quote = value[0];
    if (quote !== '"' && quote !== "'") return { resolution: 'dynamic', reason: 'first-argument-nonliteral' };
    let escaped = false;
    for (let i = 1; i < value.length; i += 1) { const char = value[i]; if (escaped) { escaped = false; continue; } if (char === '\\') { escaped = true; continue; } if (char === quote) { const endpoint = value.slice(1, i); return /\$\{|\$[A-Za-z_]/.test(endpoint) ? { resolution: 'dynamic', reason: 'string-interpolation' } : { resolution: 'literal', path: endpoint }; } }
    return { resolution: 'unsupported', reason: 'unterminated-or-multiline-string' };
  }
  function walk(directory) {
    if (!safeSourcePath(repoRoot, directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name); const safe = !isProtectedPath(file) && safeSourcePath(repoRoot, file);
      if (!safe) continue;
      if (entry.isDirectory()) walk(safe);
      else if (entry.isFile() && entry.name.endsWith('.dart')) {
        const source = safeRead(repoRoot, safe); const expression = /(?:ApiClient|OfflineAwareApi)\.(get|post|put|delete)\s*\(/g;
        for (const match of source.matchAll(expression)) records.push({ source: 'consumer-declared', file: safe, line: source.slice(0, match.index).split(/\r?\n/).length, method: match[1].toUpperCase(), ...(callBody(source, match.index) === null ? { resolution: 'unsupported', reason: 'unbalanced-call' } : firstArgument(callBody(source, match.index))) });
      }
    }
  }
  walk(path.join(repoRoot, 'lib'));
  return records;
}
function openApiInventory(repoRoot) {
  const file = path.join(repoRoot, 'docs', 'openapi', 'openapi.yaml'); const source = safeRead(repoRoot, file); if (source === null) return [];
  const records = []; let inPaths = false;
  source.split(/\r?\n/).forEach((line, index) => { if (/^paths:\s*$/.test(line)) inPaths = true; else if (inPaths && /^\S/.test(line)) inPaths = false; const match = inPaths && /^  (\/[^:]+):\s*$/.exec(line); if (match) records.push({ source: 'openapi-declared', file, line: index + 1, path: match[1] }); });
  return records;
}

function extractRuntimeMatrix({ repoRoot, appFile = path.join(repoRoot, 'backend', 'app.js') }) {
  const root = path.resolve(repoRoot); const app = parseBackendFile(root, appFile); if (!app) throw new Error('APP_SOURCE_UNAVAILABLE');
  const parsed = new Map([[appFile, app]]); for (const file of backendFiles(path.dirname(appFile))) { const item = parseBackendFile(root, file); if (item) parsed.set(file, item); }
  const modes = {};
  for (const mode of SUPPORTED_MODES) {
    const declaredMounts = app.records.filter((record) => record.receiver === 'app').flatMap((record) => { const state = conditionApplies(record.conditions, mode); return state.applies ? [{ ...record, conditionUnknown: state.unknown }] : []; }).map((record, order) => ({ ...record, order }));
    const unresolved = []; const resolvedFactoryRoutes = [];
    for (const mount of declaredMounts) {
      if (mount.dynamicPath) unresolved.push({ kind: 'dynamic-mount-path', file: mount.file, line: mount.line });
      for (const handler of mount.handlers.filter((item) => item.kind === 'factory')) {
        const target = app.aliases.get(handler.receiver); const factoryRoutes = target && parsed.get(target)?.records.filter((record) => record.owner === handler.name);
        if (!factoryRoutes || !factoryRoutes.length) unresolved.push({ kind: 'unresolved-factory', name: handler.name, file: mount.file, line: mount.line });
        else for (const route of factoryRoutes) resolvedFactoryRoutes.push({ ...route, path: combinedPath(mount.path, route.path), parentMountLine: mount.line, resolution: route.dynamicPath ? 'dynamic' : 'factory-static' });
      }
    }
    const potentialOverlaps = [];
    for (let left = 0; left < declaredMounts.length; left += 1) for (let right = left + 1; right < declaredMounts.length; right += 1) if (declaredMounts[left].method === declaredMounts[right].method && declaredMounts[left].path != null && declaredMounts[left].path === declaredMounts[right].path) potentialOverlaps.push({ path: declaredMounts[left].path, method: declaredMounts[left].method, lines: [declaredMounts[left].line, declaredMounts[right].line], requiresContractReview: true });
    modes[mode.id] = { declaredMounts, resolvedFactoryRoutes, unresolved, potentialOverlaps };
  }
  return { schemaVersion: 1, observation: 'static-declared', appFile, supportedModes: SUPPORTED_MODES.map((mode) => mode.id), modes, routerRoutes: [...parsed.values()].flatMap((entry) => entry.records.filter((record) => record.receiver !== 'app')), consumers: { flutter: flutterConsumers(root), openapi: openApiInventory(root) }, coverage: { filesScanned: [...parsed.keys()].sort(), runtimeObserved: false } };
}
function main(argv) { process.stdout.write(`${JSON.stringify(extractRuntimeMatrix({ repoRoot: path.resolve(argv[0] || path.join(__dirname, '..', '..')) }), null, 2)}\n`); }
if (require.main === module) main(process.argv.slice(2));
module.exports = { extractRuntimeMatrix, parseBackendFile, conditionApplies, combinedPath, safeSourcePath };
