#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'certify-reparto-profile-v5.js'), 'utf8');
assert.match(source, /redirect:\s*'error'/, 'redirects must be rejected');
assert.match(source, /hostname !== '127\.0\.0\.1'/, 'final URL must remain loopback');
assert.match(source, /actor = \{ \.\.\.loginActor, \.\.\.switchedFacts \}/, 'switch-role token must replace initial token');
assert.match(source, /\[401\]/, 'anonymous route must expect 401');
assert.match(source, /\[403\]/, 'BOLA route must expect 403');
assert.match(source, /if \(!accepted\) failures \+= 1/, 'endpoint failures must affect exit status');
assert.match(source, /join\('%2C'\)/, 'fleet selector must be a CSV, never ALL');
assert.doesNotMatch(source, /'ALL'/, 'literal ALL selector is prohibited');
assert.match(source, /MAX_OBJECTIVE_PAGES/, 'objectives must page');
assert.match(source, /vencimientos\.detail/, 'vencimiento detail must be probed');
assert.match(source, /signature\.delivery/, 'delivery signature must be probed');
assert.match(source, /receipt\.get/, 'receipt GET must be probed');
assert.match(source, /history\.documents\.all/, 'fleet client drill-down must be probed');
assert.doesNotMatch(source, /confirm-delivery|\/cobros['"`]|liquidaciones['"`]|send-email|share\/whatsapp|rutero\/order[^\n]*['"]PUT/, 'read harness must contain no business write endpoint');
process.stdout.write('certify-reparto-profile-v5 static checks: PASS\n');
