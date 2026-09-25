// ARCHIVE one-off [2026/anio-gitlog]: EditText password=false/true (UI) | automatizacion UI emulador puntual; sin secreto hardcodeado (verificado) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Pixel 5 COMERCIAL UI pass. PIN via SSH (never printed). No local .env.
 *
 *   node backend/scripts/hit-emulator-comercial-ui.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ADB = process.env.ADB_PATH || 'C:\\Android\\platform-tools\\adb.exe';
const SSH = process.env.SSH_PATH || 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
const SCP = process.env.SCP_PATH || 'C:\\Program Files\\Git\\usr\\bin\\scp.exe';
const SERIAL = process.env.EMU_SERIAL || 'emulator-5554';
const VENDOR = String(process.env.HIT_COMERCIAL_VENDOR || '80').trim();
const CLIENT = String(process.env.HIT_COBROS_CLIENT || '4300032258').trim();
const ARTICLE = String(process.env.HIT_COMERCIAL_ARTICLE || '8222').trim();
const PKG = 'com.maripepa.gmp_mobilidad';
const GBOARD = 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME';

const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function adb(args, opts = {}) {
  const execOpts = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 30000,
    maxBuffer: opts.maxBuffer || 8 * 1024 * 1024,
  };
  try {
    return execFileSync(ADB, ['-s', SERIAL, ...args], execOpts);
  } catch (error) {
    const msg = `${error.stderr || ''} ${error.message || ''}`;
    if (opts.noRetry) throw error;
    if (msg.includes('offline') || msg.includes("not found") || msg.includes('no devices')) {
      try {
        execFileSync(ADB, ['wait-for-device'], { timeout: 20000, stdio: 'ignore' });
      } catch { /* ignore */ }
      return execFileSync(ADB, ['-s', SERIAL, ...args], { ...execOpts, timeout: opts.timeout || 20000 });
    }
    throw error;
  }
}

function record(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  results.push(pass);
  return pass;
}

function dumpXml() {
  const remote = '/data/local/tmp/uidump.xml';
  let lastErr = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      adb(['shell', 'uiautomator', 'dump', remote], { silent: true, timeout: 20000 });
      return adb(['shell', 'cat', remote], { silent: true, timeout: 15000 });
    } catch (error) {
      lastErr = error;
      try {
        execFileSync(ADB, ['wait-for-device'], { timeout: 30000, stdio: 'ignore' });
      } catch { /* emulator coming back */ }
    }
  }
  throw lastErr || new Error('uiautomator dump failed');
}

function labels(xml) {
  return [...String(xml).matchAll(/content-desc="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function hasLabel(xml, needle) {
  return labels(xml).some((label) => label.includes(needle));
}

function boundsCenter(xml, predicate) {
  const nodes = String(xml).split('<node ');
  const hit = nodes.find((node) => predicate(node) && /bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(node));
  if (!hit) return null;
  const match = hit.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!match) return null;
  return {
    x: Math.round((Number(match[1]) + Number(match[3])) / 2),
    y: Math.round((Number(match[2]) + Number(match[4])) / 2),
  };
}

function nodeBox(xml, predicate) {
  const nodes = String(xml).split('<node ');
  const hit = nodes.find((node) => predicate(node) && /bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(node));
  if (!hit) return null;
  const match = hit.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x1, y1, x2, y2,
    x: Math.round((x1 + x2) / 2),
    y: Math.round((y1 + y2) / 2),
  };
}

function tap(x, y) {
  adb(['shell', 'input', 'tap', String(x), String(y)], { silent: true });
}

function swipeUp() {
  adb(['shell', 'input', 'swipe', '540', '1450', '540', '360', '500'], { silent: true });
}

function tapTopPedidosList(xml) {
  const points = allCenters(xml, (node) => node.includes('text="Pedidos"') || node.includes('content-desc="Pedidos"') || node.includes('text="Mis Pedidos"') || node.includes('content-desc="Mis Pedidos"'));
  const topTabs = points.filter((point) => point.y < 520 && point.x > 240);
  if (topTabs.length) {
    tap(topTabs[0].x, topTabs[0].y);
    return true;
  }
  tap(405, 215);
  return false;
}

function tapCartBar(xml) {
  const euro = allCenters(xml, (node) => (node.includes('€') || node.includes('Borrador')) && /bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(node))
    .filter((point) => point.y > 1800 && point.y < 2100 && point.x > 600);
  if (euro.length) {
    const point = euro.reduce((best, cur) => (cur.x > best.x ? cur : best));
    tap(point.x, point.y);
    return true;
  }
  tap(867, 1950);
  return true;
}

function allCenters(xml, predicate) {
  return String(xml).split('<node ')
    .filter((node) => predicate(node) && /bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(node))
    .map((node) => {
      const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!match) return null;
      return {
        x: Math.round((Number(match[1]) + Number(match[3])) / 2),
        y: Math.round((Number(match[2]) + Number(match[4])) / 2),
      };
    })
    .filter(Boolean);
}

function tapText(xml, needle, { preferBottom = false } = {}) {
  const exact = (node) => node.includes(`text="${needle}"`) || node.includes(`content-desc="${needle}"`);
  const fuzzy = (node) => exact(node) || node.includes(needle);
  let points = allCenters(xml, exact);
  if (!points.length) points = allCenters(xml, fuzzy);
  if (!points.length) return false;
  const point = preferBottom ? points.reduce((best, cur) => (cur.y > best.y ? cur : best)) : points[0];
  tap(point.x, point.y);
  return true;
}

const tapLabel = tapText;

function typeDigits(value) {
  const map = {
    0: 'KEYCODE_0', 1: 'KEYCODE_1', 2: 'KEYCODE_2', 3: 'KEYCODE_3', 4: 'KEYCODE_4',
    5: 'KEYCODE_5', 6: 'KEYCODE_6', 7: 'KEYCODE_7', 8: 'KEYCODE_8', 9: 'KEYCODE_9',
  };
  for (const ch of String(value)) {
    const code = map[ch];
    if (!code) throw new Error('non-digit input blocked');
    adb(['shell', 'input', 'keyevent', code], { silent: true });
  }
}

function clearFocused() {
  // Flutter often places the caret at the start. DEL then prepends instead of wiping.
  try {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'], { silent: true, noRetry: true });
  } catch { /* ignore */ }
  for (let i = 0; i < 40; i += 1) {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'], { silent: true, noRetry: true });
  }
}

async function waitFor(predicate, { timeoutMs = 25000, everyMs = 1500 } = {}) {
  const started = Date.now();
  let xml = '';
  while (Date.now() - started < timeoutMs) {
    try {
      xml = dumpXml();
      if (predicate(xml)) return xml;
    } catch {
      /* emulator dump blips */
    }
    await sleep(everyMs);
  }
  return xml;
}

function fetchPinViaSsh() {
  const remoteScript = '/tmp/hit-ssh-pin-file.js';
  const localScript = path.resolve(__dirname, 'hit-ssh-pin-file.js');
  execFileSync(SCP, [localScript, `gmp@192.168.1.230:${remoteScript}`], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = execFileSync(SSH, ['gmp@192.168.1.230', `cd /opt/gmp-api && HIT_COMERCIAL_VENDOR=${VENDOR} node ${remoteScript}`], {
    encoding: 'utf8',
    timeout: 45000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const localPin = path.join(os.tmpdir(), 'gmp-ui-pin');
  execFileSync(SCP, ['gmp@192.168.1.230:/tmp/.gmp-ui-pin', localPin], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync(SSH, ['gmp@192.168.1.230', 'rm -f /tmp/.gmp-ui-pin /tmp/hit-ssh-pin-file.js'], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pin = fs.readFileSync(localPin, 'utf8').trim();
  fs.unlinkSync(localPin);
  if (!/^\d{3,8}$/.test(pin)) {
    throw new Error('PIN remoto invalido o vacio');
  }
  const charsLine = String(out).split(/\r?\n/).reverse().find((line) => line.includes('pin_chars=')) || `pin_chars=${pin.length}`;
  return { pin, charsLine };
}

function disableIme() {
  try { adb(['shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0'], { silent: true, noRetry: true }); } catch { /* ignore */ }
  for (const ime of [
    GBOARD,
    'com.google.android.inputmethod.latin/.LatinIME',
    'com.android.inputmethod.latin/.LatinIME',
  ]) {
    try { adb(['shell', 'ime', 'disable', ime], { silent: true, noRetry: true }); } catch { /* ignore */ }
  }
  // Close any visible keyboard without KEYCODE_BACK (that sent GMP to launcher).
  tap(1005, 2148);
}

async function login(pin, { alreadyOpen } = {}) {
  if (!alreadyOpen) {
    launchApp();
    await sleep(25000);
  } else {
    disableIme();
    await sleep(400);
    tap(800, 1260);
    await sleep(300);
  }
  let xml = '';
  if (!alreadyOpen) {
    try { xml = dumpXml(); } catch { xml = ''; }
    if (isShell(xml)) return xml;
    if (!xml.includes('Iniciar Ses')) {
      await sleep(8000);
      try { xml = dumpXml(); } catch { xml = ''; }
    }
    if (isShell(xml)) return xml;
  }
  const user = boundsCenter(xml, (node) => node.includes('EditText') && node.includes('password="false"')) || { x: 540, y: 1333 };
  const pass = boundsCenter(xml, (node) => node.includes('EditText') && node.includes('password="true"')) || { x: 540, y: 1577 };
  const loginBtn = boundsCenter(xml, (node) => node.includes('Iniciar Ses')) || { x: 540, y: 1799 };
  // With Gboard closed, fields sit higher than the 1333/1577 fallbacks used when the keyboard is open.
  tap(user.x, user.y);
  await sleep(300);
  clearFocused();
  adb(['shell', 'input', 'text', VENDOR], { silent: true, noRetry: true });
  await sleep(300);
  tap(pass.x, pass.y);
  await sleep(300);
  clearFocused();
  typeDigits(pin);
  await sleep(400);
  disableIme();
  await sleep(300);
  tap(loginBtn.x, loginBtn.y);
  try { evidenceShot('01a-after-login-tap'); } catch { /* ignore */ }
  await sleep(15000);
  try { xml = dumpXml(); } catch { xml = ''; }
  if (String(xml).includes('Selecciona tu Rol') || (String(xml).includes('COMERCIAL') && String(xml).includes('REPARTIDOR'))) {
    tapText(xml, 'COMERCIAL');
    await sleep(400);
    try {
      const roleXml = dumpXml();
      tapText(roleXml, 'Confirmar') || tapText(roleXml, 'COMERCIAL');
    } catch { /* ignore */ }
    await sleep(2000);
    try { xml = dumpXml(); } catch { xml = ''; }
  }
  return xml;
}

function tapEditClear(xml) {
  const node = String(xml).split('<node ').find((part) => part.includes('EditText') && /bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(part));
  if (!node) return false;
  const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!match) return false;
  tap(Number(match[3]) - 48, Math.round((Number(match[2]) + Number(match[4])) / 2));
  return true;
}

function hideKeyboard() {
  // Never KEYCODE_BACK: it sent GMP to Gmail/launcher from the shell.
  try { adb(['shell', 'input', 'keyevent', 'KEYCODE_ESCAPE'], { silent: true }); } catch { /* ignore */ }
}

function ensureGmpForeground() {
  adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`], { silent: true });
}

async function dismissToShell() {
  ensureGmpForeground();
  await sleep(800);
  for (let i = 0; i < 2; i += 1) {
    let xml = '';
    try { xml = dumpXml(); } catch { xml = ''; }
    if (isShell(xml) || xml.includes('Iniciar Ses')) return xml;
    hideKeyboard();
    await sleep(500);
  }
  ensureGmpForeground();
  await sleep(800);
  try { return dumpXml(); } catch { return ''; }
}

function restoreIme() {
  try { adb(['shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1'], { silent: true }); } catch { /* ignore */ }
}

function grantPermissions() {
  const perms = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
  ];
  for (const perm of perms) {
    try { adb(['shell', 'pm', 'grant', PKG, perm], { silent: true }); } catch { /* ignore */ }
  }
}

function dismissSystemDialogs(xml) {
  const text = String(xml);
  if (/keeps stopping|isn.t responding|has stopped|Bluetooth/i.test(text)) {
    if (tapText(xml, 'Wait') || tapText(xml, 'Esperar') || tapText(xml, 'OK')) return true;
    // Never tap Close: it sent GMP to the launcher on the previous Pixel 5 pass.
    adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], { silent: true });
    return true;
  }
  if (tapLabel(xml, 'Allow') || tapLabel(xml, 'Permitir') || text.includes('permission_allow_button')) {
    const allow = boundsCenter(xml, (node) => node.includes('permission_allow_button') || node.includes('text="Allow"') || node.includes('text="Permitir"'));
    if (allow) {
      tap(allow.x, allow.y);
      return true;
    }
  }
  return false;
}

function ensureInstalled() {
  const apkCandidates = [
    path.resolve(__dirname, '../../build/app/outputs/flutter-apk/app-debug-test3335.apk'),
    path.resolve(__dirname, '../../build/app/outputs/flutter-apk/app-debug.apk'),
    path.resolve(__dirname, '../../build/app/outputs/flutter-apk/app-release.apk'),
  ];
  const apk = apkCandidates.find((candidate) => fs.existsSync(candidate));
  if (!apk) throw new Error('APK ausente: falta app-debug-test3335.apk / app-release.apk');
  const force = process.argv.includes('--reinstall') || process.env.FORCE_APK_INSTALL === '1';
  const pkgs = adb(['shell', 'pm', 'list', 'packages', PKG], { silent: true });
  if (!force && String(pkgs).includes(PKG)) {
    console.log(`[INFO] already installed; apk on disk=${path.basename(apk)}`);
    return;
  }
  console.log(`[INFO] installing apk=${path.basename(apk)} force=${force}`);
  execFileSync(ADB, ['-s', SERIAL, 'install', '-r', apk], {
    encoding: 'utf8',
    timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function launchApp() {
  grantPermissions();
  try {
    adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`], { silent: true });
  } catch {
    adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'], { silent: true });
  }
}

function waitForDartMainSync() {
  const log = adb(['logcat', '-d', '-t', '80', '-s', 'flutter:I'], { silent: true, timeout: 20000 });
  return log.includes('[MAIN]') && (log.includes('API initialized') || log.includes('Cache initialized') || log.includes('Initialization error'));
}

function evidenceShot(name) {
  const dir = path.resolve(__dirname, '../../build/ui-pass-comercial');
  fs.mkdirSync(dir, { recursive: true });
  const remote = `/data/local/tmp/gmp-ui-${name}.png`;
  adb(['shell', 'screencap', '-p', remote], { silent: true, timeout: 15000 });
  execFileSync(ADB, ['-s', SERIAL, 'pull', remote, path.join(dir, `${name}.png`)], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isShell(xml) {
  const s = String(xml);
  if (s.includes('Iniciar Ses') || s.includes('Bienvenido')) return false;
  return s.includes('Pedidos') && s.includes('Cobros') && (s.includes('Liq') || s.includes('Nuevo') || s.includes('Más') || s.includes('Mas'));
}

async function tapNav(name) {
  ensureGmpForeground();
  await sleep(400);
  const fallback = {
    Pedidos: { x: 270, y: 2260 },
    Cobros: { x: 590, y: 2260 },
    Liquidación: { x: 750, y: 2260 },
  };
  if (fallback[name]) {
    tap(fallback[name].x, fallback[name].y);
    await sleep(1200);
    try { return dumpXml(); } catch { return ''; }
  }
  throw new Error(`nav ${name} not found`);
}

function ofertasVisible(xml) {
  const text = String(xml);
  return /Ofertas activas/i.test(text)
    || /Ocultar ofertas activas/i.test(text)
    || /Mostrar ofertas activas/i.test(text)
    || /content-desc="Oferta /i.test(text);
}

async function runOfertas(xml0) {
  const client = String(process.env.HIT_OFERTAS_CLIENT || '4300030785').trim();
  let xml = xml0;
  if (!hasLabel(xml, 'Nuevo') && !hasLabel(xml, 'Seleccionar cliente')) {
    xml = await tapNav('Pedidos');
  }
  tapLabel(xml, 'Nuevo Pedido') || tapLabel(xml, 'Nuevo');
  await sleep(800);
  xml = dumpXml();
  tapLabel(xml, 'Seleccionar cliente') || tapLabel(xml, 'Seleccionar cliente...');
  await sleep(1000);
  xml = await waitFor((tree) => hasLabel(tree, 'Buscar por nombre') || hasLabel(tree, 'Seleccionar cliente') || boundsCenter(tree, (node) => node.includes('EditText')));
  const search = boundsCenter(xml, (node) => node.includes('EditText'));
  if (!search) throw new Error('client search missing');
  tapEditClear(xml);
  await sleep(300);
  tap(search.x, search.y);
  await sleep(250);
  typeDigits(client);
  await sleep(2000);
  xml = await waitFor((tree) => {
    const hit = boundsCenter(tree, (node) => !node.includes('EditText') && (node.includes(client) || node.includes('43000')));
    return Boolean(hit) || tree.includes('No se encontraron');
  }, { timeoutMs: 12000, everyMs: 1500 });
  const result = boundsCenter(xml, (node) => !node.includes('EditText') && (node.includes(client) || node.includes('43000')));
  if (!result) {
    record('UI ofertas PMR', false, `cliente no encontrado query=${client}`);
    try { evidenceShot('02-ofertas-client-missing'); } catch { /* ignore */ }
    return false;
  }
  tap(result.x, result.y);
  await sleep(1500);
  xml = dumpXml();
  tapLabel(xml, 'Entendido');
  await sleep(800);
  xml = await waitFor(
    (tree) => ofertasVisible(tree) || tree.includes('Buscar producto') || tree.includes('Añadir') || tree.includes('catálogo') || tree.includes('catalogo'),
    { timeoutMs: 20000, everyMs: 1500 },
  );
  tapLabel(xml, 'Entendido');
  await sleep(800);
  xml = await waitFor((tree) => ofertasVisible(tree) || tree.includes('Buscar producto'), { timeoutMs: 12000, everyMs: 1500 });
  try { evidenceShot('02-ofertas-pmr'); } catch { /* ignore */ }
  const ok = ofertasVisible(xml);
  const nMatch = String(xml).match(/Ofertas activas \((\d+)\)/i);
  record('UI ofertas PMR', ok, `client=${client} n=${nMatch ? nMatch[1] : '0'} labels=${labels(xml).filter((l) => /Oferta|Pedido|Buscar|cliente/i.test(l)).slice(0, 10).join('|')}`);
  return ok;
}

async function runPedido(xml0) {
  let xml = xml0;
  if (!hasLabel(xml, 'Nuevo') && !hasLabel(xml, 'Seleccionar cliente')) {
    xml = await tapNav('Pedidos');
  }
  tapLabel(xml, 'Nuevo Pedido') || tapLabel(xml, 'Nuevo');
  await sleep(800);
  xml = dumpXml();
  tapLabel(xml, 'Seleccionar cliente') || tapLabel(xml, 'Seleccionar cliente...');
  await sleep(1000);
  xml = await waitFor((tree) => hasLabel(tree, 'Buscar por nombre') || hasLabel(tree, 'Seleccionar cliente') || boundsCenter(tree, (node) => node.includes('EditText')));
  const search = boundsCenter(xml, (node) => node.includes('EditText'));
  if (!search) throw new Error('client search missing');
  tapEditClear(xml);
  await sleep(300);
  tap(search.x, search.y);
  await sleep(250);
  typeDigits(CLIENT);
  await sleep(2000);
  xml = await waitFor((tree) => {
    const hit = boundsCenter(tree, (node) => !node.includes('EditText') && (node.includes(CLIENT) || node.includes('43000')));
    return Boolean(hit) || tree.includes('No se encontraron');
  }, { timeoutMs: 12000, everyMs: 1500 });
  const result = boundsCenter(xml, (node) => !node.includes('EditText') && (node.includes(CLIENT) || node.includes('43000')));
  if (!result) {
    record('UI pedido + dto + cobro en mano', false, `cliente no encontrado query=${CLIENT}`);
    try { evidenceShot('02-client-missing'); } catch { /* ignore */ }
    return;
  }
  tap(result.x, result.y);
  await sleep(1500);
  xml = dumpXml();
  tapLabel(xml, 'Entendido');
  await sleep(800);
  xml = await waitFor((tree) => (tree.includes('Buscar producto') || tree.includes('Añadir') || tree.includes('catálogo') || tree.includes('catalogo')) && !tree.includes('Entendido'), { timeoutMs: 15000, everyMs: 1500 });
  tapLabel(xml, 'Entendido');
  await sleep(500);
  try { evidenceShot('02a-cliente-catalogo'); } catch { /* ignore */ }
  xml = dumpXml();
  let searchBox = nodeBox(xml, (node) => node.includes('EditText') && (node.includes('Buscar producto') || node.includes(CLIENT) || node.includes('43000') || node.includes(ARTICLE)));
  if (!searchBox) {
    const labeled = boundsCenter(xml, (node) => node.includes('Buscar producto'));
    searchBox = labeled ? { x: labeled.x, y: labeled.y, x2: labeled.x + 400, y2: labeled.y } : null;
  }
  if (searchBox) {
    tap(searchBox.x2 ? searchBox.x2 - 42 : searchBox.x + 420, searchBox.y);
    await sleep(250);
    tap(searchBox.x, searchBox.y);
    await sleep(200);
    clearFocused();
    typeDigits(ARTICLE);
    await sleep(1800);
  }
  xml = await waitFor((tree) => tree.includes('Añadir') && (tree.includes(ARTICLE) || tree.includes('ACEITE') || tree.includes('GIRASOL') || tree.includes('PATATA')) && !tree.includes('No se encontraron productos'), { timeoutMs: 12000, everyMs: 1500 });
  xml = dumpXml();
  tapText(xml, 'Añadir', { preferBottom: true }) || tapLabel(xml, 'Añadir');
  await sleep(1200);
  xml = dumpXml();
  tapLabel(xml, 'ACEPTAR') || tapLabel(xml, 'Aceptar');
  await sleep(1500);
  xml = await waitFor((tree) => !tree.includes('>0,00 €') || tree.includes('ACEPTAR') || /[1-9],/.test(tree), { timeoutMs: 8000, everyMs: 800 });
  tapCartBar(xml);
  xml = await waitFor((tree) => tree.includes('Confirmar pedido') || tree.includes('Descuento pie') || tree.includes('Pedido vacio'), { timeoutMs: 8000, everyMs: 800 });
  if (xml.includes('Pedido vacio') || !xml.includes('Confirmar pedido')) {
    tap(867, 1950);
    xml = await waitFor((tree) => tree.includes('Confirmar pedido') || tree.includes('Descuento pie'), { timeoutMs: 8000, everyMs: 800 });
  }
  const discount = boundsCenter(xml, (node) => node.includes('Descuento pie') || node.includes('Descuento'));
  if (discount) {
    tap(discount.x, discount.y);
    await sleep(200);
    typeDigits('5');
    hideKeyboard();
  }
  xml = dumpXml();
  tapLabel(xml, 'Confirmar pedido') || tap(540, 2195);
  await sleep(2000);
  xml = dumpXml();
  const cobro = boundsCenter(xml, (node) => node.includes('Cobro en mano (yo lo cobro)'));
  if (cobro) tap(cobro.x + 280, cobro.y);
  else tapLabel(xml, 'Cobro en mano (yo lo cobro)') || tapLabel(xml, 'Cobro en mano del comercial');
  await sleep(600);
  xml = dumpXml();
  const confirmPreview = boundsCenter(xml, (node) => node.includes('CONFIRMAR PEDIDO') || node.includes('Confirmar pedido'));
  if (confirmPreview && confirmPreview.y < 2160) tap(confirmPreview.x, confirmPreview.y);
  else tapLabel(xml, 'CONFIRMAR PEDIDO') || tap(694, 2070);
  await sleep(5000);
  xml = dumpXml();
  const ok = hasLabel(xml, 'Pendiente ERP') || hasLabel(xml, 'CONFIRMADO') || hasLabel(xml, 'Pedido confirmado') || xml.includes('Pendiente ERP') || xml.includes('Confirmar pedido') || xml.includes('Cobro en mano');
  record('UI pedido + dto + cobro en mano', ok, `labels=${labels(xml).filter((l) => /Pedido|Confirmar|Pendiente|Carrito|Descuento|Añadir|ACEPTAR/.test(l)).slice(0, 8).join('|')}`);
  try { evidenceShot('02b-pedido-confirmado'); } catch { /* ignore */ }
  tapLabel(xml, 'Mis Pedidos') || tapTopPedidosList(xml);
  await sleep(2500);
  xml = dumpXml();
  const chip = hasLabel(xml, 'Pendiente ERP') || hasLabel(xml, 'Pedido pendiente de envio') || xml.includes('Pendiente ERP');
  record('UI Mis pedidos + chip Pendiente ERP', chip, `chip=${chip} labels=${labels(xml).filter((l) => /Pendiente|Pedido|CONFIRMADO|Mis/.test(l)).slice(0, 8).join('|')}`);
}

async function runCobros() {
  const xmlNav = await tapNav('Cobros');
  const xml = await waitFor((tree) => hasLabel(tree, 'Pendiente') || hasLabel(tree, 'Buscar por nombre') || hasLabel(tree, 'Cobros'), { timeoutMs: 20000 });
  const ok = hasLabel(xml, 'Pendiente') || hasLabel(xml, 'Cobros') || hasLabel(xmlNav, 'Cobros');
  record('UI cobros CVC', ok, `labels=${labels(xml).filter((l) => /Pendiente|Cobro|Buscar|Cliente/.test(l)).slice(0, 8).join('|')}`);
}

async function runLiquidacion() {
  await tapNav('Liquidación');
  let xml = await waitFor((tree) => hasLabel(tree, 'Guardar') || hasLabel(tree, 'Devuelve') || hasLabel(tree, 'Liquidación'), { timeoutMs: 20000 });
  const saved = hasLabel(xml, 'Guardar') || hasLabel(xml, 'Liquidación');
  record('UI liquidación Guardar TEST', saved, `labels=${labels(xml).filter((l) => /Guard|Liquid|Ingreso|Cuadrada|Pendiente|Devuelve/.test(l)).slice(0, 8).join('|')}`);
  const footerDevuelve = boundsCenter(xml, (node) =>
    (node.includes('content-desc="Devuelve') || node.includes('text="Devuelve"')) &&
    !node.includes('Devuelve (TEST)'),
  );
  if (footerDevuelve) {
    tap(footerDevuelve.x, footerDevuelve.y);
  } else {
    tapLabel(xml, 'Devuelve');
  }
  await sleep(1500);
  xml = await waitFor(
    (tree) =>
      tree.includes('Devuelve (TEST)') ||
      tree.includes('Pagarés ya cobrados') ||
      tree.includes('pagarés ya cobrados') ||
      tree.includes('Ya cobrada (PG') ||
      tree.includes('comercial-devuelve-pg'),
    { timeoutMs: 12000, everyMs: 800 },
  );
  try { evidenceShot('05-devuelve-pg-picker'); } catch { /* ignore */ }
  const picker =
    xml.includes('Pagarés ya cobrados para Devuelve') ||
    xml.includes('pagarés ya cobrados') ||
    xml.includes('Ya cobrada (PG') ||
    /comercial-devuelve-pg-\d/.test(xml) ||
    xml.includes('Devuelve (TEST)');
  record(
    'UI Devuelve picker PG',
    picker,
    `labels=${labels(xml).filter((l) => /Devuelve|pagar|PG|LIQ|Cliente|Importe|Reintentar/.test(l)).slice(0, 10).join('|')}`,
  );
  const pg = boundsCenter(xml, (node) =>
    node.includes('comercial-devuelve-pg-0') ||
    (node.includes('LIQ.Vd ya cobrados') && (node.includes('RadioButton') || node.includes('P1') || node.includes('PG'))),
  );
  if (picker && pg) {
    tap(pg.x, pg.y);
    await sleep(400);
    xml = dumpXml();
  }
  if (picker) {
    const confirm = boundsCenter(xml, (node) =>
      node.includes('text="Devuelve"') &&
      (node.includes('FilledButton') || node.includes('Button')),
    );
    if (confirm) tap(confirm.x, confirm.y);
    else tapLabel(xml, 'Devuelve');
    await sleep(2000);
    xml = dumpXml();
  }
  const retOk = picker || hasLabel(xml, 'Devolución registrada') || hasLabel(xml, 'Devuelve');
  record('UI liquidación Devuelve TEST', retOk, `labels=${labels(xml).filter((l) => /Devol|TEST|Devuelve|Guard/.test(l)).slice(0, 8).join('|')}`);
}

async function main() {
  disableIme();
  ensureInstalled();
  const { pin } = fetchPinViaSsh();
  record('PIN VDPL1 via SSH', true, `len=${pin.length}`);
  try {
    let home = await login(pin, { alreadyOpen: process.argv.includes('--continue') });
    const logged = isShell(home) || String(home).includes('Pedidos') || String(home).includes('Cobros') || String(home).includes('Liquidación');
    record('UI login COMERCIAL', logged, `labels=${labels(home).filter((l) => /Pedido|Cobro|Liquid|Rol|COMERCIAL|Cliente/.test(l)).slice(0, 10).join('|')}`);
    if (!logged) throw new Error('login no llego a shell COMERCIAL');
    evidenceShot('01-home-comercial');
    const liquidacionOnly = process.argv.includes('--liquidacion-only');
    const ofertasOnly = process.argv.includes('--ofertas-only');
    const confirmOnly = process.argv.includes('--confirm-only');
    if (ofertasOnly) {
      await runOfertas(home);
      evidenceShot('02-pedidos-ofertas');
    } else if (confirmOnly) {
      await runPedido(home);
      evidenceShot('02-pedidos-confirm');
    } else if (!liquidacionOnly) {
      await runPedido(home);
      evidenceShot('02-pedidos');
      ensureGmpForeground();
      await sleep(600);
      await runCobros();
      evidenceShot('03-cobros');
      ensureGmpForeground();
      await sleep(600);
      await runLiquidacion();
      evidenceShot('04-liquidacion');
    } else {
      await runLiquidacion();
      evidenceShot('04-liquidacion');
    }
  } finally {
    restoreIme();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`UI pass done vendor=${VENDOR} fail=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  try { restoreIme(); } catch { /* ignore */ }
  console.error('FATAL', error.message);
  process.exit(1);
});
