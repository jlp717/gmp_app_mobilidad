#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'certify-reparto-profile-v7.js'), 'utf8');
assert.match(source, /redirect:\s*'error'/);
assert.match(source, /hostname !== '127\.0\.0\.1'/);
assert.match(source, /const switched = \{ \.\.\.initial, \.\.\.identity\(switchResult\.body\) \}/);
assert.match(source, /\[401\]/); assert.match(source, /\[403\]/); assert.match(source, /if \(!pass\) failures \+= 1/);
assert.match(source, /ids\.join\(','\)/); assert.doesNotMatch(source, /'ALL'/);
assert.match(source, /MAX_OBJECTIVE_PAGES/); assert.match(source, /signature\.delivery/); assert.match(source, /receipt\.get/); assert.match(source, /vencimientos\.detail/); assert.match(source, /history\.documents\.all/);
assert.match(source, /const FLEET_FORBIDDEN = new Set\(\['rutero\.order', 'rutero\.geo', 'liquidacion\.breakdown', 'cuentas', 'chatbot\.message', 'albaran', 'pdf\.albaran', 'pdf\.invoice', 'signature\.delivery', 'receipt\.get', 'vencimientos\.detail', 'history\.documents'\]\)/);
assert.match(source, /fleetMode \? all\.filter\(\(\[endpoint\]\) => !FLEET_FORBIDDEN\.has\(endpoint\)\) : all/);
assert.match(source, /if \(!fleetMode\) \{ const answer = await request/);
assert.doesNotMatch(source, /confirm-delivery|send-email|share\/whatsapp|\/cobros['"`]|rutero\/order[^\n]*PUT/);
process.stdout.write('certify-reparto-profile-v7 static checks: PASS\n');
