'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('./reparto-isolated-ddl-manifest');

const FORBIDDEN_SQL = /\b(?:DROP|DELETE|TRUNCATE|MERGE|UPDATE|INSERT|CALL|QCMDEXC|GRANT|REVOKE|COMMIT|ROLLBACK|SAVEPOINT|AUTOCOMMIT)\b|\b(?:SET|START)\s+TRANSACTION\b/i;
const IDENTIFIER = '[A-Z][A-Z0-9_$#]*';

class RunnerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'RunnerError';
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new RunnerError('INVALID_ARGUMENT');
  const parsed = { execute: false };
  const seen = new Set();
  for (const arg of argv) {
    let key;
    let value;
    if (arg === '--execute') {
      key = 'execute';
      value = true;
    } else {
      const match = /^--(migration|environment|confirm)=(.+)$/.exec(arg);
      if (!match) throw new RunnerError('INVALID_ARGUMENT');
      [, key, value] = match;
    }
    if (seen.has(key)) throw new RunnerError('DUPLICATE_ARGUMENT');
    seen.add(key);
    parsed[key] = value;
  }
  if (!['033', '034', '035'].includes(parsed.migration)) {
    throw new RunnerError('MIGRATION_NOT_ALLOWLISTED');
  }
  if (parsed.environment !== undefined && parsed.environment !== manifest.environment) {
    throw new RunnerError('ENVIRONMENT_NOT_ALLOWLISTED');
  }
  if (parsed.confirm !== undefined && parsed.confirm !== manifest.confirmation) {
    throw new RunnerError('CONFIRMATION_MISMATCH');
  }
  if (parsed.execute &&
      (parsed.environment !== manifest.environment || parsed.confirm !== manifest.confirmation)) {
    throw new RunnerError('EXECUTION_GUARD_INCOMPLETE');
  }
  return parsed;
}

function splitSql(sql) {
  const statements = [];
  let buffer = '';
  let delimiter = ';';
  let i = 0;
  let state = 'normal';
  let lineStart = true;

  while (i < sql.length) {
    if (state === 'normal' && lineStart) {
      const directive = /^[ \t]*--#SET[ \t]+TERMINATOR[ \t]+([^\s])[ \t]*(?:\r?\n|$)/i.exec(sql.slice(i));
      if (directive) {
        if (buffer.trim()) throw new RunnerError('TERMINATOR_DIRECTIVE_INSIDE_STATEMENT');
        delimiter = directive[1];
        i += directive[0].length;
        lineStart = true;
        continue;
      }
    }

    const char = sql[i];
    const next = sql[i + 1];
    if (state === 'line_comment') {
      if (char === '\n') {
        buffer += '\n';
        state = 'normal';
        lineStart = true;
      }
      i += 1;
      continue;
    }
    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        i += 2;
      } else {
        if (char === '\n') {
          buffer += '\n';
          lineStart = true;
        }
        i += 1;
      }
      continue;
    }
    if (state === 'single_quote') {
      buffer += char;
      if (char === "'" && next === "'") {
        buffer += next;
        i += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      lineStart = char === '\n';
      i += 1;
      continue;
    }
    if (state === 'double_quote') {
      buffer += char;
      if (char === '"' && next === '"') {
        buffer += next;
        i += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      lineStart = char === '\n';
      i += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      state = 'line_comment';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block_comment';
      i += 2;
      continue;
    }
    if (char === "'") {
      state = 'single_quote';
      buffer += char;
      lineStart = false;
      i += 1;
      continue;
    }
    if (char === '"') {
      state = 'double_quote';
      buffer += char;
      lineStart = false;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = '';
      lineStart = false;
      i += 1;
      continue;
    }
    buffer += char;
    lineStart = char === '\n' || (lineStart && (char === ' ' || char === '\t' || char === '\r'));
    i += 1;
  }

  if (state === 'single_quote' || state === 'double_quote' || state === 'block_comment') {
    throw new RunnerError('UNTERMINATED_SQL_TOKEN');
  }
  if (buffer.trim()) throw new RunnerError('UNTERMINATED_SQL_STATEMENT');
  return statements;
}

function sha256(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex').toUpperCase();
}

function sameSet(actual, expected) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isIdentStart(char) {
  return /[A-Za-z]/.test(char);
}

function isIdentChar(char) {
  return /[A-Za-z0-9_$#]/.test(char);
}

function readIdentifier(source, start) {
  if (!isIdentStart(source[start])) return null;
  let end = start + 1;
  while (end < source.length && isIdentChar(source[end])) end += 1;
  return { value: source.slice(start, end), end };
}

function skipWhitespaceAndComments(source, start) {
  let i = start;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      i += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      if (i >= source.length) throw new RunnerError('UNTERMINATED_SQL_TOKEN');
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function readStringLiteral(source, start) {
  if (source[start] !== "'") return null;
  let i = start + 1;
  let decoded = '';
  while (i < source.length) {
    const char = source[i];
    if (char === "'" && source[i + 1] === "'") {
      decoded += "'";
      i += 2;
      continue;
    }
    if (char === "'") return { raw: source.slice(start, i + 1), value: decoded, end: i + 1 };
    decoded += char;
    i += 1;
  }
  throw new RunnerError('UNTERMINATED_SQL_TOKEN');
}

function rejectQuotedOrConfusableIdentifier(source, start) {
  const char = source[start];
  if (char === '"' || char === '`') throw new RunnerError('QUOTED_IDENTIFIER_FORBIDDEN');
  if (char && char.charCodeAt(0) > 127) throw new RunnerError('IDENTIFIER_ENCODING_FORBIDDEN');
}

function countExecuteImmediate(statement) {
  let count = 0;
  let i = 0;
  let state = 'normal';
  while (i < statement.length) {
    const char = statement[i];
    const next = statement[i + 1];
    if (state === 'line_comment') {
      if (char === '\n') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === 'single_quote') {
      if (char === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'double_quote') {
      if (char === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      i += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line_comment';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block_comment';
      i += 2;
      continue;
    }
    if (char === "'") {
      state = 'single_quote';
      i += 1;
      continue;
    }
    if (char === '"') {
      state = 'double_quote';
      i += 1;
      continue;
    }
    if (isIdentStart(char)) {
      const ident = readIdentifier(statement, i);
      if (ident.value.toUpperCase() === 'EXECUTE') {
        const afterWs = skipWhitespaceAndComments(statement, ident.end);
        const second = readIdentifier(statement, afterWs);
        if (second && second.value.toUpperCase() === 'IMMEDIATE') {
          count += 1;
          i = second.end;
          continue;
        }
      }
      i = ident.end;
      continue;
    }
    i += 1;
  }
  return count;
}

function dynamicSqlPayloads(statement) {
  const payloads = [];
  let i = 0;
  let state = 'normal';
  while (i < statement.length) {
    const char = statement[i];
    const next = statement[i + 1];
    if (state === 'line_comment') {
      if (char === '\n') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === 'single_quote') {
      if (char === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'double_quote') {
      if (char === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      i += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line_comment';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block_comment';
      i += 2;
      continue;
    }
    if (char === "'") {
      state = 'single_quote';
      i += 1;
      continue;
    }
    if (char === '"') {
      state = 'double_quote';
      i += 1;
      continue;
    }
    if (!isIdentStart(char)) {
      i += 1;
      continue;
    }
    const first = readIdentifier(statement, i);
    if (first.value.toUpperCase() !== 'EXECUTE') {
      i = first.end;
      continue;
    }
    const afterExecute = skipWhitespaceAndComments(statement, first.end);
    const second = readIdentifier(statement, afterExecute);
    if (!second || second.value.toUpperCase() !== 'IMMEDIATE') {
      i = first.end;
      continue;
    }
    const exprStart = skipWhitespaceAndComments(statement, second.end);
    rejectQuotedOrConfusableIdentifier(statement, exprStart);
    if (statement[exprStart] === 'X' || statement[exprStart] === 'x') {
      const maybeHex = readIdentifier(statement, exprStart);
      const afterHex = skipWhitespaceAndComments(statement, maybeHex.end);
      if (statement[afterHex] === "'") throw new RunnerError('DYNAMIC_SQL_MUST_BE_LITERAL');
    }
    const literal = readStringLiteral(statement, exprStart);
    if (!literal) throw new RunnerError('DYNAMIC_SQL_MUST_BE_LITERAL');
    const afterLiteral = skipWhitespaceAndComments(statement, literal.end);
    const trailer = statement[afterLiteral];
    if (trailer !== undefined && trailer !== ';') {
      throw new RunnerError('DYNAMIC_SQL_MUST_BE_LITERAL');
    }
    payloads.push(literal.value);
    i = literal.end;
  }
  if (payloads.length !== countExecuteImmediate(statement)) {
    throw new RunnerError('DYNAMIC_SQL_MUST_BE_LITERAL');
  }
  return payloads;
}

function collectCteNames(statement) {
  const names = new Set();
  let i = 0;
  let state = 'normal';
  while (i < statement.length) {
    const char = statement[i];
    const next = statement[i + 1];
    if (state === 'line_comment') {
      if (char === '\n') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === 'single_quote') {
      if (char === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'double_quote') {
      if (char === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      i += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line_comment';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block_comment';
      i += 2;
      continue;
    }
    if (char === "'") {
      state = 'single_quote';
      i += 1;
      continue;
    }
    if (char === '"') {
      state = 'double_quote';
      i += 1;
      continue;
    }
    if (!isIdentStart(char)) {
      i += 1;
      continue;
    }
    const withIdent = readIdentifier(statement, i);
    if (withIdent.value.toUpperCase() !== 'WITH') {
      i = withIdent.end;
      continue;
    }
    let cursor = skipWhitespaceAndComments(statement, withIdent.end);
    const recursive = readIdentifier(statement, cursor);
    if (recursive && recursive.value.toUpperCase() === 'RECURSIVE') {
      cursor = skipWhitespaceAndComments(statement, recursive.end);
    }
    while (cursor < statement.length) {
      rejectQuotedOrConfusableIdentifier(statement, cursor);
      const name = readIdentifier(statement, cursor);
      if (!name) break;
      names.add(name.value.toUpperCase());
      cursor = skipWhitespaceAndComments(statement, name.end);
      if (statement[cursor] === '(') {
        let depth = 1;
        cursor += 1;
        while (cursor < statement.length && depth > 0) {
          const c = statement[cursor];
          const n = statement[cursor + 1];
          if (c === "'" ) {
            const lit = readStringLiteral(statement, cursor);
            cursor = lit.end;
            continue;
          }
          if (c === '-' && n === '-') {
            cursor = skipWhitespaceAndComments(statement, cursor);
            continue;
          }
          if (c === '/' && n === '*') {
            cursor = skipWhitespaceAndComments(statement, cursor);
            continue;
          }
          if (c === '(') depth += 1;
          if (c === ')') depth -= 1;
          cursor += 1;
        }
        cursor = skipWhitespaceAndComments(statement, cursor);
      }
      const asIdent = readIdentifier(statement, cursor);
      if (!asIdent || asIdent.value.toUpperCase() !== 'AS') break;
      cursor = skipWhitespaceAndComments(statement, asIdent.end);
      if (statement[cursor] !== '(') break;
      let depth = 1;
      cursor += 1;
      while (cursor < statement.length && depth > 0) {
        const c = statement[cursor];
        const n = statement[cursor + 1];
        if (c === "'") {
          const lit = readStringLiteral(statement, cursor);
          cursor = lit.end;
          continue;
        }
        if (c === '-' && n === '-') {
          cursor = skipWhitespaceAndComments(statement, cursor);
          continue;
        }
        if (c === '/' && n === '*') {
          cursor = skipWhitespaceAndComments(statement, cursor);
          continue;
        }
        if (c === '(') depth += 1;
        if (c === ')') depth -= 1;
        cursor += 1;
      }
      cursor = skipWhitespaceAndComments(statement, cursor);
      if (statement[cursor] === ',') {
        cursor = skipWhitespaceAndComments(statement, cursor + 1);
        continue;
      }
      break;
    }
    i = cursor;
  }
  return names;
}

function readRelationReference(source, start) {
  let cursor = skipWhitespaceAndComments(source, start);
  rejectQuotedOrConfusableIdentifier(source, cursor);
  const first = readIdentifier(source, cursor);
  if (!first) return null;
  cursor = skipWhitespaceAndComments(source, first.end);
  if (source[cursor] === '.') {
    cursor = skipWhitespaceAndComments(source, cursor + 1);
    rejectQuotedOrConfusableIdentifier(source, cursor);
    const second = readIdentifier(source, cursor);
    if (!second) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
    return {
      schema: first.value.toUpperCase(),
      object: second.value.toUpperCase(),
      end: second.end,
      qualified: true,
    };
  }
  return {
    schema: null,
    object: first.value.toUpperCase(),
    end: first.end,
    qualified: false,
  };
}

function createdObjects(statements) {
  const objects = { tables: [], indexes: [], sequences: [] };
  const pattern = new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?(TABLE|INDEX|SEQUENCE)\\s+JAVIER\\.(${IDENTIFIER})`, 'gi');
  for (const statement of statements) {
    let match;
    while ((match = pattern.exec(statement)) !== null) {
      const bucket = { TABLE: 'tables', INDEX: 'indexes', SEQUENCE: 'sequences' }[match[1].toUpperCase()];
      objects[bucket].push(match[2].toUpperCase());
    }
  }
  return objects;
}

function assertAllowlistedRelation(reference, allowedObjects, allowedReadSchemas, cteNames, options = {}) {
  const names = new Set([
    ...allowedObjects.tables,
    ...allowedObjects.indexes,
    ...allowedObjects.sequences,
  ]);
  if (!reference.qualified) {
    if (options.allowCte && cteNames.has(reference.object)) return;
    throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
  }
  if (reference.schema === manifest.schema && names.has(reference.object)) return;
  if (allowedReadSchemas.has(reference.schema)) return;
  throw new RunnerError('QUALIFIED_REFERENCE_NOT_ALLOWLISTED');
}

function scanRelationKeyword(statement, start, keyword) {
  const ident = readIdentifier(statement, start);
  if (!ident || ident.value.toUpperCase() !== keyword) return null;
  return ident.end;
}

function validateQualifiedReferences(statements, allowedObjects, allowedReadSchemas) {
  for (const statement of statements) {
    const ctes = collectCteNames(statement);
    let i = 0;
    let state = 'normal';
    while (i < statement.length) {
      const char = statement[i];
      const next = statement[i + 1];
      if (state === 'line_comment') {
        if (char === '\n') state = 'normal';
        i += 1;
        continue;
      }
      if (state === 'block_comment') {
        if (char === '*' && next === '/') {
          state = 'normal';
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (state === 'single_quote') {
        if (char === "'" && next === "'") {
          i += 2;
          continue;
        }
        if (char === "'") state = 'normal';
        i += 1;
        continue;
      }
      if (state === 'double_quote') {
        if (char === '"' && next === '"') {
          i += 2;
          continue;
        }
        if (char === '"') state = 'normal';
        i += 1;
        continue;
      }
      if (char === '-' && next === '-') {
        state = 'line_comment';
        i += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block_comment';
        i += 2;
        continue;
      }
      if (char === "'") {
        state = 'single_quote';
        i += 1;
        continue;
      }
      if (char === '"') {
        state = 'double_quote';
        i += 1;
        continue;
      }
      if (!isIdentStart(char)) {
        i += 1;
        continue;
      }

      const ident = readIdentifier(statement, i);
      const upper = ident.value.toUpperCase();
      let handled = false;

      if (upper === 'CREATE') {
        let cursor = skipWhitespaceAndComments(statement, ident.end);
        const unique = readIdentifier(statement, cursor);
        if (unique && unique.value.toUpperCase() === 'UNIQUE') {
          cursor = skipWhitespaceAndComments(statement, unique.end);
        }
        const kind = readIdentifier(statement, cursor);
        if (kind && ['TABLE', 'INDEX', 'SEQUENCE'].includes(kind.value.toUpperCase())) {
          const objectRef = readRelationReference(statement, kind.end);
          if (!objectRef) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
          assertAllowlistedRelation(objectRef, allowedObjects, allowedReadSchemas, ctes, { allowCte: false });
          i = objectRef.end;
          if (kind.value.toUpperCase() === 'INDEX') {
            let afterIndex = skipWhitespaceAndComments(statement, objectRef.end);
            const onIdent = readIdentifier(statement, afterIndex);
            if (onIdent && onIdent.value.toUpperCase() === 'ON') {
              const target = readRelationReference(statement, onIdent.end);
              if (!target || !target.qualified) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
              assertAllowlistedRelation(target, allowedObjects, allowedReadSchemas, ctes, { allowCte: false });
              i = target.end;
            }
          }
          handled = true;
        }
      } else if (upper === 'ALTER') {
        let cursor = skipWhitespaceAndComments(statement, ident.end);
        const table = readIdentifier(statement, cursor);
        if (table && table.value.toUpperCase() === 'TABLE') {
          const reference = readRelationReference(statement, table.end);
          if (!reference) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
          assertAllowlistedRelation(reference, allowedObjects, allowedReadSchemas, ctes, { allowCte: false });
          i = reference.end;
          handled = true;
        }
      } else if (upper === 'REFERENCES') {
        const reference = readRelationReference(statement, ident.end);
        if (!reference) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
        assertAllowlistedRelation(reference, allowedObjects, allowedReadSchemas, ctes, { allowCte: false });
        i = reference.end;
        handled = true;
      } else if (upper === 'FROM' || upper === 'JOIN') {
        // IBM i compound guards cannot use WITH-CTE inside IF EXISTS; allow
        // parenthesized subqueries / VALUES tables and keep scanning inside.
        const afterFrom = skipWhitespaceAndComments(statement, ident.end);
        if (statement[afterFrom] === '(') {
          i = afterFrom;
          handled = true;
        } else {
          const reference = readRelationReference(statement, ident.end);
          if (!reference) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
          assertAllowlistedRelation(reference, allowedObjects, allowedReadSchemas, ctes, { allowCte: true });
          i = reference.end;
          handled = true;
        }
      } else if (['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS'].includes(upper)) {
        let cursor = skipWhitespaceAndComments(statement, ident.end);
        if (['LEFT', 'RIGHT', 'FULL'].includes(upper)) {
          const outer = readIdentifier(statement, cursor);
          if (outer && outer.value.toUpperCase() === 'OUTER') {
            cursor = skipWhitespaceAndComments(statement, outer.end);
          }
        }
        const join = scanRelationKeyword(statement, cursor, 'JOIN');
        if (join != null) {
          const afterJoin = skipWhitespaceAndComments(statement, join);
          if (statement[afterJoin] === '(') {
            i = afterJoin;
            handled = true;
          } else {
            const reference = readRelationReference(statement, join);
            if (!reference) throw new RunnerError('UNQUALIFIED_REFERENCE_FORBIDDEN');
            assertAllowlistedRelation(reference, allowedObjects, allowedReadSchemas, ctes, { allowCte: true });
            i = reference.end;
            handled = true;
          }
        }
      }

      if (!handled) i = ident.end;
    }
  }
}

function validateDdlSource(source, migration) {
  const statements = splitSql(source);
  if (statements.length !== migration.statementCount) throw new RunnerError('STATEMENT_COUNT_MISMATCH');
  for (const statement of statements) {
    if (FORBIDDEN_SQL.test(statement) || /\bDSEDAC\b/i.test(statement)) {
      throw new RunnerError('FORBIDDEN_SQL');
    }
  }

  if (migration.catalogMode === 'declarative_source') {
    for (const statement of statements) {
      if (!/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+JAVIER\.[A-Z][A-Z0-9_$#]*/i.test(statement) &&
          !/^ALTER\s+TABLE\s+JAVIER\.TEST_[A-Z0-9_$#]+\s+ADD\s+CONSTRAINT\b/i.test(statement)) {
        throw new RunnerError('DDL_STATEMENT_NOT_ALLOWLISTED');
      }
    }
    validateQualifiedReferences(statements, migration.objects, new Set(['QSYS2']));
  } else {
    for (const statement of statements) {
      if (!/^BEGIN\b/i.test(statement)) throw new RunnerError('COMPOUND_STATEMENT_REQUIRED');
      const payloads = dynamicSqlPayloads(statement);
      for (const payload of payloads) {
        if (FORBIDDEN_SQL.test(payload) || /\bDSEDAC\b/i.test(payload) ||
            !/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SEQUENCE)\s+JAVIER\.[A-Z][A-Z0-9_$#]*/i.test(payload)) {
          throw new RunnerError('DYNAMIC_SQL_NOT_ALLOWLISTED');
        }
      }
      validateQualifiedReferences([statement, ...payloads], migration.objects, new Set(['QSYS2']));
    }
  }
  const found = createdObjects(statements);
  for (const kind of ['tables', 'indexes', 'sequences']) {
    if (!sameSet(found[kind], migration.objects[kind])) throw new RunnerError('OBJECT_MANIFEST_MISMATCH');
  }
  return statements;
}

function validateVerifierSource(source) {
  const statements = splitSql(source);
  if (statements.length !== manifest.verifier.statementCount) {
    throw new RunnerError('STATEMENT_COUNT_MISMATCH');
  }
  for (const statement of statements) {
    if (!/^(?:SELECT|WITH)\b/i.test(statement) || FORBIDDEN_SQL.test(statement) || /\bDSEDAC\b/i.test(statement)) {
      throw new RunnerError('VERIFIER_NOT_READ_ONLY');
    }
  }
  validateQualifiedReferences(statements, { tables: [], indexes: [], sequences: [] }, new Set(['QSYS2', 'SYSIBM']));
  return statements;
}

function loadPinnedSql(entry, fsImpl = fs) {
  const sqlDirectory = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(path.join(__dirname, 'sql'))
    : fsImpl.realpathSync(path.join(__dirname, 'sql'));
  const nominalPath = path.join(sqlDirectory, entry.file);
  const stat = fsImpl.lstatSync(nominalPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RunnerError('SQL_PATH_NOT_REGULAR_FILE');
  const realPath = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(nominalPath)
    : fsImpl.realpathSync(nominalPath);
  if (path.dirname(realPath) !== sqlDirectory || realPath !== nominalPath) {
    throw new RunnerError('SQL_PATH_ESCAPE');
  }
  const source = fsImpl.readFileSync(realPath, 'utf8').replace(/\r\n/g, '\n');
  if (sha256(source) !== entry.sha256) throw new RunnerError('SQL_HASH_MISMATCH');
  return { source, realPath };
}

function loadPinnedRepositoryCatalog(fsImpl = fs) {
  const repositoryDirectory = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(path.join(__dirname, '..', 'repositories'))
    : fsImpl.realpathSync(path.join(__dirname, '..', 'repositories'));
  const nominalPath = path.join(repositoryDirectory, manifest.repositoryCatalog.file);
  const stat = fsImpl.lstatSync(nominalPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RunnerError('CATALOG_MANIFEST_PATH_NOT_REGULAR_FILE');
  const realPath = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(nominalPath)
    : fsImpl.realpathSync(nominalPath);
  if (path.dirname(realPath) !== repositoryDirectory || realPath !== nominalPath) {
    throw new RunnerError('CATALOG_MANIFEST_PATH_ESCAPE');
  }
  const source = fsImpl.readFileSync(realPath, 'utf8').replace(/\r\n/g, '\n');
  if (sha256(source) !== manifest.repositoryCatalog.sha256) {
    throw new RunnerError('CATALOG_MANIFEST_HASH_MISMATCH');
  }
  const contract = require(realPath);
  for (const exportName of [
    'REQUIRED_COLUMN_MANIFEST',
    'REQUIRED_CONSTRAINT_SIGNATURES',
    'REQUIRED_INDEX_SIGNATURES',
    'REQUIRED_SEQUENCE_METADATA',
  ]) {
    if (!contract[exportName] || typeof contract[exportName] !== 'object') {
      throw new RunnerError('CATALOG_MANIFEST_EXPORT_MISSING');
    }
  }
  for (const key of Object.values(manifest.repositoryCatalog.tableKeys)) {
    if (!contract.REQUIRED_COLUMN_MANIFEST[key] ||
        !contract.REQUIRED_CONSTRAINT_SIGNATURES[key] ||
        !contract.REQUIRED_INDEX_SIGNATURES[key]) {
      throw new RunnerError('CATALOG_MANIFEST_KEY_MISSING');
    }
  }
  return contract;
}

function splitTopLevel(value) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];
    if (char === "'") {
      current += char;
      if (quoted && next === "'") {
        current += next;
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (quoted || depth !== 0) throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function sizeInBytes(value) {
  const match = /^(\d+)([KM])?$/i.exec(String(value).trim());
  if (!match) throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  const multiplier = match[2] ? (match[2].toUpperCase() === 'K' ? 1024 : 1024 * 1024) : 1;
  return Number(match[1]) * multiplier;
}

function normalizeDefault(value) {
  return String(value ?? '').trim().toUpperCase().replace(/['"_\s()]/g, '');
}

function normalizeCheck(value) {
  return String(value ?? '').trim().toUpperCase().replace(/^CHECK\s*/i, '').replace(/[\s()]/g, '');
}

function parseConstraint(table, definition) {
  const match = new RegExp(`^CONSTRAINT\\s+(${IDENTIFIER})\\s+([\\s\\S]+)$`, 'i').exec(definition);
  if (!match) throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  const name = match[1].toUpperCase();
  const body = match[2].trim();
  let type;
  let keys = [];
  let check = '';
  let referencedTable = '';
  let referencedKeys = [];
  let detail;
  if ((detail = /^PRIMARY\s+KEY\s*\(([^)]+)\)$/i.exec(body))) {
    type = 'PRIMARY KEY';
    keys = detail[1].split(',').map((item) => item.trim().toUpperCase());
  } else if ((detail = /^UNIQUE\s*\(([^)]+)\)$/i.exec(body))) {
    type = 'UNIQUE';
    keys = detail[1].split(',').map((item) => item.trim().toUpperCase());
  } else if ((detail = /^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+JAVIER\.([A-Z0-9_$#]+)\s*\(([^)]+)\)$/i.exec(body))) {
    type = 'FOREIGN KEY';
    keys = detail[1].split(',').map((item) => item.trim().toUpperCase());
    referencedTable = detail[2].toUpperCase();
    referencedKeys = detail[3].split(',').map((item) => item.trim().toUpperCase());
  } else if ((detail = /^CHECK\s*\(([\s\S]+)\)$/i.exec(body))) {
    type = 'CHECK';
    check = normalizeCheck(detail[1]);
  } else {
    throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  }
  return { table, name, type, keys, check, referencedTable, referencedKeys };
}

function parseColumn(table, ordinal, definition) {
  const match = new RegExp(`^(${IDENTIFIER})\\s+([A-Z]+)(?:\\(([^)]+)\\))?([\\s\\S]*)$`, 'i').exec(definition);
  if (!match) throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  const [, rawName, rawType, rawArgs, tail] = match;
  const type = rawType.toUpperCase();
  const args = rawArgs ? rawArgs.split(',').map((item) => item.trim()) : [];
  let length = null;
  let precision = null;
  let scale = null;
  if (['CHAR', 'VARCHAR', 'CLOB', 'BLOB'].includes(type)) length = sizeInBytes(args[0]);
  if (['NUMERIC', 'DECIMAL'].includes(type)) {
    precision = Number(args[0]);
    scale = args.length > 1 ? Number(args[1]) : 0;
  }
  const defaultMatch = /\bDEFAULT\s+(.+?)\s*$/i.exec(tail);
  const identity = /\bGENERATED\s+ALWAYS\s+AS\s+IDENTITY\b/i.test(tail);
  return {
    table,
    name: rawName.toUpperCase(),
    ordinal,
    type,
    length,
    precision,
    scale,
    nullable: !/\bNOT\s+NULL\b/i.test(tail),
    defaultValue: normalizeDefault(defaultMatch ? defaultMatch[1] : ''),
    identity,
  };
}

function deriveDeclarativeCatalog(statements) {
  const catalog = { tables: [], columns: [], constraints: [], indexes: [] };
  for (const statement of statements) {
    let match = new RegExp(`^CREATE\\s+TABLE\\s+JAVIER\\.(${IDENTIFIER})\\s*\\(([\\s\\S]*)\\)$`, 'i').exec(statement);
    if (match) {
      const table = match[1].toUpperCase();
      catalog.tables.push(table);
      let ordinal = 0;
      for (const item of splitTopLevel(match[2])) {
        if (/^CONSTRAINT\b/i.test(item)) catalog.constraints.push(parseConstraint(table, item));
        else {
          ordinal += 1;
          catalog.columns.push(parseColumn(table, ordinal, item));
        }
      }
      continue;
    }
    match = new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+JAVIER\\.(${IDENTIFIER})\\s+ON\\s+JAVIER\\.(${IDENTIFIER})\\s*\\(([^)]+)\\)$`, 'i').exec(statement);
    if (match) {
      catalog.indexes.push({
        name: match[2].toUpperCase(),
        table: match[3].toUpperCase(),
        unique: Boolean(match[1]),
        keys: match[4].split(',').map((item) => `${item.trim().toUpperCase()}:A`),
      });
      continue;
    }
    match = new RegExp(`^ALTER\\s+TABLE\\s+JAVIER\\.(${IDENTIFIER})\\s+ADD\\s+([\\s\\S]+)$`, 'i').exec(statement);
    if (match) {
      catalog.constraints.push(parseConstraint(match[1].toUpperCase(), match[2]));
      continue;
    }
    throw new RunnerError('DECLARATIVE_DDL_PARSE_FAILED');
  }
  return catalog;
}

function rowValue(row, name) {
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const key = Object.keys(row).find((candidate) => candidate.toUpperCase() === name);
  return key ? row[key] : undefined;
}

function trimmed(value) {
  return value == null ? '' : String(value).trim();
}

function numeric(value) {
  if (value == null || value === '') return null;
  return Number(value);
}

function actualColumnSignature(row) {
  let type = trimmed(rowValue(row, 'DATA_TYPE')).toUpperCase();
  if (type === 'TIMESTMP') type = 'TIMESTAMP';
  const nullable = ['Y', 'YES'].includes(trimmed(rowValue(row, 'IS_NULLABLE')).toUpperCase());
  const identity = ['Y', 'YES'].includes(trimmed(rowValue(row, 'IS_IDENTITY')).toUpperCase());
  return JSON.stringify({
    table: trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase(),
    name: trimmed(rowValue(row, 'COLUMN_NAME')).toUpperCase(),
    ordinal: numeric(rowValue(row, 'ORDINAL_POSITION')),
    type,
    length: ['CHAR', 'VARCHAR', 'CLOB', 'BLOB'].includes(type) ? numeric(rowValue(row, 'LENGTH')) : null,
    precision: ['NUMERIC', 'DECIMAL'].includes(type) ? numeric(rowValue(row, 'NUMERIC_PRECISION')) : null,
    scale: ['NUMERIC', 'DECIMAL'].includes(type) ? numeric(rowValue(row, 'NUMERIC_SCALE')) : null,
    nullable,
    defaultValue: normalizeDefault(rowValue(row, 'COLUMN_DEFAULT')),
    identity,
  });
}

function expectedColumnSignature(column) {
  return JSON.stringify(column);
}

function groupConstraintRows(rows, references) {
  const grouped = new Map();
  for (const row of rows) {
    const name = trimmed(rowValue(row, 'CONSTRAINT_NAME')).toUpperCase();
    if (!grouped.has(name)) {
      grouped.set(name, {
        table: trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase(),
        name,
        type: trimmed(rowValue(row, 'CONSTRAINT_TYPE')).toUpperCase(),
        keys: [],
        check: normalizeCheck(rowValue(row, 'CONSTRAINT_TEXT')),
        referencedTable: '',
        referencedKeys: [],
      });
    }
    const key = trimmed(rowValue(row, 'COLUMN_NAME')).toUpperCase();
    if (key) grouped.get(name).keys.push([numeric(rowValue(row, 'ORDINAL_POSITION')) || 0, key]);
  }
  for (const item of grouped.values()) item.keys = item.keys.sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  for (const row of references) {
    const name = trimmed(rowValue(row, 'CONSTRAINT_NAME')).toUpperCase();
    const item = grouped.get(name);
    if (!item) continue;
    item.referencedTable = trimmed(rowValue(row, 'REFERENCED_TABLE_NAME')).toUpperCase();
    const key = trimmed(rowValue(row, 'REFERENCED_COLUMN_NAME')).toUpperCase();
    if (key) item.referencedKeys.push([numeric(rowValue(row, 'ORDINAL_POSITION')) || 0, key]);
  }
  for (const item of grouped.values()) item.referencedKeys = item.referencedKeys.sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  return grouped;
}

function constraintSignature(constraint) {
  return JSON.stringify({
    table: constraint.table,
    name: constraint.name,
    type: constraint.type,
    keys: constraint.keys,
    check: constraint.type === 'CHECK' ? constraint.check : '',
    referencedTable: constraint.type === 'FOREIGN KEY' ? constraint.referencedTable : '',
    referencedKeys: constraint.type === 'FOREIGN KEY' ? constraint.referencedKeys : [],
  });
}

function groupIndexRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const name = trimmed(rowValue(row, 'INDEX_NAME')).toUpperCase();
    if (!name) continue;
    if (!grouped.has(name)) {
      const unique = ['U', 'YES', 'Y'].includes(trimmed(rowValue(row, 'IS_UNIQUE')).toUpperCase());
      grouped.set(name, {
        name,
        table: trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase(),
        unique,
        keys: [],
      });
    }
    const key = trimmed(rowValue(row, 'COLUMN_NAME')).toUpperCase();
    const order = trimmed(rowValue(row, 'ORDERING')).toUpperCase() || 'A';
    if (key) grouped.get(name).keys.push([numeric(rowValue(row, 'ORDINAL_POSITION')) || 0, `${key}:${order}`]);
  }
  for (const item of grouped.values()) item.keys = item.keys.sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  return grouped;
}

function inList(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

async function verifyDeclarativeCatalog(connection, catalog) {
  const tableParams = catalog.tables;
  const constraintParams = catalog.constraints.filter((item) => item.type === 'FOREIGN KEY').map((item) => item.name);
  const columnRows = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,DATA_TYPE,LENGTH,
    NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE,COLUMN_DEFAULT,IS_IDENTITY
    FROM QSYS2.SYSCOLUMNS2 WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME IN (${inList(tableParams.length)})
    ORDER BY TABLE_NAME,ORDINAL_POSITION`, tableParams);
  const constraintRows = await connection.query(`SELECT C.TABLE_NAME,C.CONSTRAINT_NAME,C.CONSTRAINT_TYPE,
    CAST(C.CONSTRAINT_TEXT AS VARCHAR(4096)) AS CONSTRAINT_TEXT,
    K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSCST C LEFT JOIN QSYS2.SYSKEYCST K
    ON K.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=C.CONSTRAINT_NAME
    WHERE C.TABLE_SCHEMA='JAVIER' AND C.TABLE_NAME IN (${inList(tableParams.length)})
    ORDER BY C.CONSTRAINT_NAME,K.ORDINAL_POSITION`, tableParams);
  const referenceRows = constraintParams.length === 0 ? [] : await connection.query(`SELECT R.CONSTRAINT_NAME,
    U.TABLE_NAME AS REFERENCED_TABLE_NAME,K.COLUMN_NAME AS REFERENCED_COLUMN_NAME,K.ORDINAL_POSITION
    FROM QSYS2.SYSREFCST R JOIN QSYS2.SYSCST U
    ON U.CONSTRAINT_SCHEMA=R.UNIQUE_CONSTRAINT_SCHEMA AND U.CONSTRAINT_NAME=R.UNIQUE_CONSTRAINT_NAME
    LEFT JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA=U.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=U.CONSTRAINT_NAME
    WHERE R.CONSTRAINT_SCHEMA='JAVIER' AND R.CONSTRAINT_NAME IN (${inList(constraintParams.length)})
    ORDER BY R.CONSTRAINT_NAME,K.ORDINAL_POSITION`, constraintParams);
  const indexRows = await connection.query(`SELECT I.TABLE_NAME,I.INDEX_NAME,I.IS_UNIQUE,
    K.COLUMN_NAME,K.ORDINAL_POSITION,K.ORDERING FROM QSYS2.SYSINDEXES I LEFT JOIN QSYS2.SYSKEYS K
    ON K.INDEX_SCHEMA=I.INDEX_SCHEMA AND K.INDEX_NAME=I.INDEX_NAME
    WHERE I.TABLE_SCHEMA='JAVIER' AND I.TABLE_NAME IN (${inList(tableParams.length)})
    ORDER BY I.INDEX_NAME,K.ORDINAL_POSITION`, tableParams);

  if (!sameSet(columnRows.map(actualColumnSignature), catalog.columns.map(expectedColumnSignature))) return false;
  const actualConstraints = groupConstraintRows(constraintRows, referenceRows);
  for (const item of actualConstraints.values()) {
    const type = trimmed(item.type).toUpperCase();
    if (type === 'P' || type === 'PRIMARY KEY') item.type = 'PRIMARY KEY';
    else if (type === 'U' || type === 'UNIQUE') item.type = 'UNIQUE';
    else if (type === 'F' || type === 'FOREIGN KEY' || type === 'REFERENTIAL') item.type = 'FOREIGN KEY';
    else if (type === 'C' || type === 'CHECK') item.type = 'CHECK';
  }

  // IBM i: SYSCST.CONSTRAINT_TEXT is often null for CHECK; use SYSCHKCST.CHECK_CLAUSE.
  const emptyChecks = [...actualConstraints.values()]
    .filter((item) => item.type === 'CHECK' && !item.check)
    .map((item) => item.name);
  if (emptyChecks.length > 0) {
    const checkRows = await connection.query(
      `SELECT CONSTRAINT_NAME, CAST(CHECK_CLAUSE AS VARCHAR(4096)) AS CHECK_CLAUSE
         FROM QSYS2.SYSCHKCST
        WHERE CONSTRAINT_SCHEMA='JAVIER'
          AND CONSTRAINT_NAME IN (${inList(emptyChecks.length)})`,
      emptyChecks,
    );
    for (const row of checkRows) {
      const name = trimmed(rowValue(row, 'CONSTRAINT_NAME')).toUpperCase();
      const item = actualConstraints.get(name);
      if (item) item.check = normalizeCheck(rowValue(row, 'CHECK_CLAUSE'));
    }
  }

  if (!sameSet([...actualConstraints.values()].map(constraintSignature), catalog.constraints.map(constraintSignature))) {
    return false;
  }

  // IBM i: PRIMARY KEY / UNIQUE are constraints, not always SYSINDEXES rows.
  // Explicit CREATE INDEX objects are verified here; PK/UNIQUE keys already matched above.
  const actualIndexes = groupIndexRows(indexRows);
  const physicalSignature = (item) => JSON.stringify({
    table: item.table,
    unique: item.unique,
    keys: item.keys,
  });
  const actualExplicit = [...actualIndexes.values()]
    .filter((item) => catalog.indexes.some((expected) => expected.name === item.name))
    .map(physicalSignature);
  const expectedExplicit = catalog.indexes.map((item) => physicalSignature({
    table: item.table,
    unique: item.unique,
    keys: item.keys,
  }));
  return sameSet(actualExplicit, expectedExplicit);
}

function repositoryConstraintType(value) {
  const type = trimmed(value).toUpperCase();
  if (type === 'P') return 'PRIMARY KEY';
  if (type === 'U') return 'UNIQUE';
  if (type === 'C') return 'CHECK';
  return type;
}

function repositoryCheck(value) {
  return trimmed(value).toUpperCase().replace(/\s+/g, '')
    .replace(/^CHECK/, '').replace(/^\((.*)\)$/s, '$1');
}

function multisetEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  const remaining = new Map();
  for (const item of expected) remaining.set(item, (remaining.get(item) || 0) + 1);
  for (const item of actual) {
    const count = remaining.get(item) || 0;
    if (count < 1) return false;
    remaining.set(item, count - 1);
  }
  return true;
}

function repositoryColumnMatches(row, expected, ordinal) {
  const nullable = trimmed(rowValue(row, 'IS_NULLABLE')).toUpperCase()
    .replace(/^YES$/, 'Y').replace(/^NO$/, 'N');
  const hasDefault = trimmed(rowValue(row, 'HAS_DEFAULT')).toUpperCase()
    .replace(/^YES$/, 'Y').replace(/^NO$/, 'N');
  const identityGeneration = rowValue(row, 'IDENTITY_GENERATION') == null
    ? null : trimmed(rowValue(row, 'IDENTITY_GENERATION')).toUpperCase();
  const actual = {
    dataType: trimmed(rowValue(row, 'DATA_TYPE')).toUpperCase(),
    length: Number(rowValue(row, 'LENGTH')),
    numericPrecision: rowValue(row, 'NUMERIC_PRECISION') == null
      ? null : Number(rowValue(row, 'NUMERIC_PRECISION')),
    numericScale: rowValue(row, 'NUMERIC_SCALE') == null
      ? null : Number(rowValue(row, 'NUMERIC_SCALE')),
    isNullable: nullable,
    hasDefault,
    defaultValue: normalizeDefault(rowValue(row, 'COLUMN_DEFAULT')),
    isIdentity: trimmed(rowValue(row, 'IS_IDENTITY')).toUpperCase(),
    identityGeneration,
    identityStart: rowValue(row, 'IDENTITY_START') == null
      ? null : Number(rowValue(row, 'IDENTITY_START')),
    identityIncrement: rowValue(row, 'IDENTITY_INCREMENT') == null
      ? null : Number(rowValue(row, 'IDENTITY_INCREMENT')),
  };
  if (Number(rowValue(row, 'ORDINAL_POSITION')) !== ordinal) return false;
  return Object.entries(expected).every(([key, value]) => {
    const normalized = key === 'defaultValue' ? normalizeDefault(value) : value;
    return actual[key] === normalized;
  });
}

async function verifyRepositoryCatalog(connection, contract) {
  const mappings = Object.entries(manifest.repositoryCatalog.tableKeys);
  const tableNames = mappings.map(([table]) => table);
  const placeholders = inList(tableNames.length);
  const columnRows = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,DATA_TYPE,LENGTH,
    NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE,HAS_DEFAULT,COLUMN_DEFAULT,IS_IDENTITY,
    IDENTITY_GENERATION,IDENTITY_START,IDENTITY_INCREMENT FROM QSYS2.SYSCOLUMNS2
    WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME IN (${placeholders})`, tableNames);
  const rowsByTable = new Map();
  for (const row of columnRows) {
    const table = trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase();
    if (!rowsByTable.has(table)) rowsByTable.set(table, new Map());
    rowsByTable.get(table).set(trimmed(rowValue(row, 'COLUMN_NAME')).toUpperCase(), row);
  }
  for (const [table, key] of mappings) {
    const expectedColumns = Object.entries(contract.REQUIRED_COLUMN_MANIFEST[key]);
    const actualColumns = rowsByTable.get(table) || new Map();
    if (!sameSet([...actualColumns.keys()], expectedColumns.map(([name]) => name))) return false;
    if (expectedColumns.some(([name, expected], index) =>
      !repositoryColumnMatches(actualColumns.get(name), expected, index + 1))) return false;
  }

  const constraintRows = await connection.query(`SELECT X.TABLE_NAME,X.CONSTRAINT_TYPE,
    COALESCE(MIN(CAST(C.CHECK_CLAUSE AS VARCHAR(4096))),'') AS CHECK_CONDITION,
    COALESCE(LISTAGG(K.COLUMN_NAME,',') WITHIN GROUP (ORDER BY K.ORDINAL_POSITION),'') AS KEY_COLUMNS
    FROM QSYS2.SYSCST X
    LEFT JOIN QSYS2.SYSKEYCST K
      ON K.CONSTRAINT_SCHEMA=X.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=X.CONSTRAINT_NAME
    LEFT JOIN QSYS2.SYSCHKCST C
      ON C.CONSTRAINT_SCHEMA=X.CONSTRAINT_SCHEMA AND C.CONSTRAINT_NAME=X.CONSTRAINT_NAME
    WHERE X.TABLE_SCHEMA='JAVIER' AND X.TABLE_NAME IN (${placeholders})
    GROUP BY X.TABLE_NAME,X.CONSTRAINT_NAME,X.CONSTRAINT_TYPE`, tableNames);
  const constraintsByTable = new Map();
  for (const row of constraintRows) {
    const table = trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase();
    if (!constraintsByTable.has(table)) constraintsByTable.set(table, []);
    const type = repositoryConstraintType(rowValue(row, 'CONSTRAINT_TYPE'));
    const detail = type === 'CHECK'
      ? repositoryCheck(rowValue(row, 'CHECK_CONDITION'))
      : trimmed(rowValue(row, 'KEY_COLUMNS')).toUpperCase();
    constraintsByTable.get(table).push(`${type}:${detail}`);
  }
  for (const [table, key] of mappings) {
    if (!multisetEqual(
      constraintsByTable.get(table) || [],
      contract.REQUIRED_CONSTRAINT_SIGNATURES[key],
    )) return false;
  }

  const indexRows = await connection.query(`SELECT I.TABLE_NAME,I.INDEX_NAME,I.IS_UNIQUE,
    K.COLUMN_NAME,K.ORDINAL_POSITION,K.ORDERING FROM QSYS2.SYSINDEXES I JOIN QSYS2.SYSKEYS K
    ON K.INDEX_SCHEMA=I.INDEX_SCHEMA AND K.INDEX_NAME=I.INDEX_NAME
    WHERE I.TABLE_SCHEMA='JAVIER' AND I.TABLE_NAME IN (${placeholders})
    ORDER BY I.TABLE_NAME,I.INDEX_NAME,K.ORDINAL_POSITION`, tableNames);
  const indexGroups = new Map();
  for (const row of indexRows) {
    const table = trimmed(rowValue(row, 'TABLE_NAME')).toUpperCase();
    const name = trimmed(rowValue(row, 'INDEX_NAME')).toUpperCase();
    const groupKey = `${table}.${name}`;
    if (!indexGroups.has(groupKey)) {
      const flag = trimmed(rowValue(row, 'IS_UNIQUE')).toUpperCase();
      indexGroups.set(groupKey, { table, unique: ['YES', 'U'].includes(flag) ? 'U' : 'D', columns: [] });
    }
    const ordering = trimmed(rowValue(row, 'ORDERING')).toUpperCase() || 'A';
    indexGroups.get(groupKey).columns.push(
      [Number(rowValue(row, 'ORDINAL_POSITION')), `${trimmed(rowValue(row, 'COLUMN_NAME')).toUpperCase()}:${ordering}`],
    );
  }
  const indexesByTable = new Map();
  for (const group of indexGroups.values()) {
    if (!indexesByTable.has(group.table)) indexesByTable.set(group.table, []);
    const columns = group.columns.sort((a, b) => a[0] - b[0]).map((item) => item[1]);
    indexesByTable.get(group.table).push(`${group.unique}:${columns.join(',')}`);
  }
  for (const [table, key] of mappings) {
    if (!multisetEqual(indexesByTable.get(table) || [], contract.REQUIRED_INDEX_SIGNATURES[key])) return false;
  }

  const sequenceRows = await connection.query(`SELECT DATA_TYPE,
    CAST(NUMERIC_PRECISION AS VARCHAR(32)) AS NUMERIC_PRECISION,
    CAST(START AS VARCHAR(64)) AS START,
    CAST(INCREMENT AS VARCHAR(64)) AS INCREMENT,
    CAST(MINIMUM_VALUE AS VARCHAR(64)) AS MINIMUM_VALUE,
    CAST(MAXIMUM_VALUE AS VARCHAR(64)) AS MAXIMUM_VALUE,
    CYCLE_OPTION, CAST(CACHE AS VARCHAR(32)) AS CACHE,
    "ORDER" AS ORDER_OPTION
    FROM QSYS2.SYSSEQUENCES WHERE SEQUENCE_SCHEMA='JAVIER' AND SEQUENCE_NAME=?`,
  manifest.migrations['034'].objects.sequences);
  if (sequenceRows.length !== 1) return false;
  return Object.entries(contract.REQUIRED_SEQUENCE_METADATA).every(([field, expected]) => {
    const actual = rowValue(sequenceRows[0], field);
    return trimmed(actual).toUpperCase() === String(expected).toUpperCase();
  });
}

function stopToken(result) {
  if (!result || typeof result[Symbol.iterator] !== 'function') return null;
  for (const row of result) {
    for (const value of Object.values(row || {})) {
      const match = /\b(STOP_[A-Z0-9_]+)\b/i.exec(String(value));
      if (match) return match[1].toUpperCase();
    }
  }
  return null;
}

function dbErrorFields(error) {
  const first = Array.isArray(error && error.odbcErrors) ? error.odbcErrors[0] : null;
  return {
    sqlState: trimmed(first && (first.state || first.sqlstate || first.SQLSTATE)) || undefined,
    native: first && (first.code ?? first.native ?? first.nativeError) != null
      ? String(first.code ?? first.native ?? first.nativeError)
      : undefined,
  };
}

function safeEvent(event) {
  const allowed = ['label', 'ordinal', 'sqlState', 'native', 'elapsedMs', 'status'];
  return Object.fromEntries(allowed.filter((key) => event[key] !== undefined).map((key) => [key, event[key]]));
}

function emit(logger, event) {
  if (logger) logger(safeEvent(event));
}

async function runVerifier(connection, statements, logger, phase) {
  for (let index = 0; index < statements.length; index += 1) {
    const started = Date.now();
    const label = `${phase}_${manifest.verifier.labels[index]}`;
    try {
      const result = await connection.query(statements[index]);
      const stop = stopToken(result);
      if (stop) {
        emit(logger, { label, ordinal: index + 1, elapsedMs: Date.now() - started, status: stop });
        throw new RunnerError('CATALOG_DRIFT', { stop });
      }
      emit(logger, { label, ordinal: index + 1, elapsedMs: Date.now() - started, status: 'VERIFIED' });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      const fields = dbErrorFields(error);
      emit(logger, { label, ordinal: index + 1, elapsedMs: Date.now() - started, status: 'FAILED', ...fields });
      throw new RunnerError('VERIFIER_QUERY_FAILED', fields);
    }
  }
}

async function inspectOwnedObjects(connection, migration) {
  const sequenceClause = migration.sequencePrefix
    ? `UNION ALL SELECT 'SEQUENCE' AS OBJECT_KIND,SEQUENCE_NAME AS OBJECT_NAME FROM QSYS2.SYSSEQUENCES WHERE SEQUENCE_SCHEMA='JAVIER' AND SEQUENCE_NAME LIKE ?`
    : '';
  const params = [`${migration.tablePrefix}%`];
  if (migration.sequencePrefix) params.push(`${migration.sequencePrefix}%`);
  const rows = await connection.query(`SELECT 'TABLE' AS OBJECT_KIND,TABLE_NAME AS OBJECT_NAME
    FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME LIKE ? ${sequenceClause}
    ORDER BY OBJECT_KIND,OBJECT_NAME`, params);
  const actualTables = [];
  const actualSequences = [];
  for (const row of rows) {
    const kind = trimmed(rowValue(row, 'OBJECT_KIND')).toUpperCase();
    const name = trimmed(rowValue(row, 'OBJECT_NAME')).toUpperCase();
    if (kind === 'TABLE') actualTables.push(name);
    if (kind === 'SEQUENCE') actualSequences.push(name);
  }
  if (actualTables.length === 0 && actualSequences.length === 0) return 'ABSENT';
  if (!sameSet(actualTables, migration.objects.tables) ||
      !sameSet(actualSequences, migration.objects.sequences)) return 'DRIFT';
  return 'PRESENT';
}

async function inspectCatalog(
  connection,
  migration,
  ddlStatements,
  verifierStatements,
  repositoryContract,
  logger,
  phase,
) {
  let inventory;
  try {
    inventory = await inspectOwnedObjects(connection, migration);
  } catch (error) {
    const fields = dbErrorFields(error);
    emit(logger, { label: `${phase}_inventory`, ordinal: 0, status: 'FAILED', ...fields });
    throw new RunnerError('CATALOG_PREFLIGHT_FAILED', fields);
  }
  if (inventory === 'ABSENT') return 'ABSENT';
  if (inventory === 'DRIFT') return 'DRIFT';
  if (migration.catalogMode === 'sql_verifier_035') {
    try {
      await runVerifier(connection, verifierStatements, logger, phase);
      const repositoryExact = await verifyRepositoryCatalog(connection, repositoryContract);
      emit(logger, {
        label: `${phase}_repository_catalog`,
        ordinal: 0,
        status: repositoryExact ? 'VERIFIED' : 'DRIFT',
      });
      return repositoryExact ? 'EXACT' : 'DRIFT';
    } catch (error) {
      if (error.code === 'CATALOG_DRIFT') return 'DRIFT';
      throw error;
    }
  }
  const exact = await verifyDeclarativeCatalog(connection, deriveDeclarativeCatalog(ddlStatements));
  emit(logger, { label: `${phase}_declarative_catalog`, ordinal: 0, status: exact ? 'VERIFIED' : 'DRIFT' });
  return exact ? 'EXACT' : 'DRIFT';
}

async function executeDdl(connection, statements, migration, logger) {
  for (let index = 0; index < statements.length; index += 1) {
    const started = Date.now();
    try {
      await connection.query(statements[index]);
      emit(logger, {
        label: migration.labels[index],
        ordinal: index + 1,
        elapsedMs: Date.now() - started,
        status: 'EXECUTED',
      });
    } catch (error) {
      const fields = dbErrorFields(error);
      emit(logger, {
        label: migration.labels[index],
        ordinal: index + 1,
        elapsedMs: Date.now() - started,
        status: 'PARTIAL_UNKNOWN_STATE',
        ...fields,
      });
      throw new RunnerError('PARTIAL_UNKNOWN_STATE', fields);
    }
  }
}

function odbcValue(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new RunnerError(`MISSING_${name}`);
  if (/[\0\r\n]/.test(value)) throw new RunnerError(`INVALID_${name}`);
  return `{${value.replace(/}/g, '}}')}}`;
}

function connectionString(env) {
  const uid = odbcValue(env.ODBC_UID, 'ODBC_UID');
  const pwd = odbcValue(env.ODBC_PWD, 'ODBC_PWD');
  return `DSN=${manifest.dsn};UID=${uid};PWD=${pwd};DBQ=${manifest.schema};NAM=1;CCSID=1208;CMPTDM=1`;
}

async function closeResource(resource) {
  if (resource && typeof resource.close === 'function') await resource.close();
}

async function executeSelection(options) {
  const {
    argv,
    odbc,
    env = process.env,
    fsImpl = fs,
    logger = null,
  } = options;
  const args = parseArgs(argv);
  const entry = args.migration === '035' ? manifest.verifier : manifest.migrations[args.migration];
  const loaded = loadPinnedSql(entry, fsImpl);
  const statements = args.migration === '035'
    ? validateVerifierSource(loaded.source)
    : validateDdlSource(loaded.source, entry);
  let verifierStatements = null;
  let repositoryContract = null;
  if (args.migration === '034') {
    const verifier = loadPinnedSql(manifest.verifier, fsImpl);
    verifierStatements = validateVerifierSource(verifier.source);
    repositoryContract = loadPinnedRepositoryCatalog(fsImpl);
  }
  if (!args.execute) {
    emit(logger, { label: `migration_${args.migration}`, ordinal: 0, status: 'DRY_RUN' });
    return { status: 'DRY_RUN', migration: args.migration, sha256: entry.sha256, statementCount: statements.length };
  }
  if (!odbc || typeof odbc.pool !== 'function') throw new RunnerError('ODBC_POOL_UNAVAILABLE');

  let pool;
  let connection;
  let primaryError;
  try {
    pool = await odbc.pool(connectionString(env));
    connection = await pool.connect();
    if (args.migration === '035') {
      await runVerifier(connection, statements, logger, 'verification');
      return { status: 'VERIFIED', migration: args.migration };
    }

    const preflight = await inspectCatalog(
      connection,
      entry,
      statements,
      verifierStatements,
      repositoryContract,
      logger,
      'preflight',
    );
    if (preflight === 'EXACT') return { status: 'ALREADY_VERIFIED', migration: args.migration };
    if (preflight !== 'ABSENT') throw new RunnerError('CATALOG_DRIFT');

    await executeDdl(connection, statements, entry, logger);
    const postflight = await inspectCatalog(
      connection,
      entry,
      statements,
      verifierStatements,
      repositoryContract,
      logger,
      'postflight',
    );
    if (postflight !== 'EXACT') throw new RunnerError('PARTIAL_UNKNOWN_STATE');
    return { status: 'EXECUTED_AND_VERIFIED', migration: args.migration };
  } catch (error) {
    primaryError = error instanceof RunnerError ? error : new RunnerError('RUNNER_FAILED', dbErrorFields(error));
    throw primaryError;
  } finally {
    try {
      await closeResource(connection);
    } catch (error) {
      if (!primaryError) throw new RunnerError('CONNECTION_CLOSE_FAILED', dbErrorFields(error));
    } finally {
      try {
        await closeResource(pool);
      } catch (error) {
        if (!primaryError) throw new RunnerError('POOL_CLOSE_FAILED', dbErrorFields(error));
      }
    }
  }
}

async function main() {
  const odbc = require('odbc');
  const logger = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  try {
    const result = await executeSelection({ argv: process.argv.slice(2), odbc, logger });
    if (result.status !== 'DRY_RUN') {
      emit(logger, { label: `migration_${result.migration}`, ordinal: 0, status: result.status });
    }
  } catch (error) {
    emit(logger, { label: 'runner', ordinal: 0, status: error.code || 'RUNNER_FAILED' });
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  RunnerError,
  connectionString,
  createdObjects,
  deriveDeclarativeCatalog,
  dynamicSqlPayloads,
  executeSelection,
  inspectCatalog,
  loadPinnedSql,
  loadPinnedRepositoryCatalog,
  parseArgs,
  runVerifier,
  sha256,
  splitSql,
  stopToken,
  validateDdlSource,
  validateVerifierSource,
  verifyDeclarativeCatalog,
  verifyRepositoryCatalog,
};
