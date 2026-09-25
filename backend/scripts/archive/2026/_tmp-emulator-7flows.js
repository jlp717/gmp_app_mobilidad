// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-tmp | _-scratch gitignored; flujos emulador puntuales 7flows | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * [emulador] 7 flujos UI JEFE (diego). PIN via SSH, never printed.
 *   node backend/scripts/_tmp-emulator-7flows.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ADB = process.env.ADB_PATH || 'C:\\Android\\platform-tools\\adb.exe';
const SSH = process.env.SSH_PATH || 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
const SCP = process.env.SCP_PATH || 'C:\\Program Files\\Git\\usr\\bin\\scp.exe';
const SERIAL = process.env.EMU_SERIAL || 'emulator-5554';
const VENDOR = '98';
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
    if (opts.noRetry) throw error;
    try {
      execFileSync(ADB, ['wait-for-device'], { timeout: 20000, stdio: 'ignore' });
    } catch { /* ignore */ }
    return execFileSync(ADB, ['-s', SERIAL, ...args], { ...execOpts, timeout: opts.timeout || 20000 });
  }
}

function record(name, pass, detail, ms) {
  const extra = [
    ms != null ? `wall=${ms}ms` : '',
    detail || '',
  ].filter(Boolean).join(' ');
  console.log(`[emulador] [${pass ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`);
  results.push({ name, pass, ms });
  return pass;
}

function dumpXml() {
  const remote = '/data/local/tmp/uidump.xml';
  let lastErr = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      adb(['shell', 'uiautomator', 'dump', remote], { timeout: 20000 });
      return adb(['shell', 'cat', remote], { timeout: 15000 });
    } catch (error) {
      lastErr = error;
    }
  }
  throw lastErr || new Error('uiautomator dump failed');
}

function labels(xml) {
  return [...String(xml).matchAll(/content-desc="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
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

function tap(x, y) {
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

function tapText(xml, needle) {
  const exact = (node) => node.includes(`text="${needle}"`) || node.includes(`content-desc="${needle}"`);
  let points = allCenters(xml, exact);
  if (!points.length) {
    points = allCenters(xml, (node) => node.includes(needle));
  }
  if (!points.length) return false;
  tap(points[0].x, points[0].y);
  return true;
}

function typeDigits(value) {
  const map = {
    0: 'KEYCODE_0', 1: 'KEYCODE_1', 2: 'KEYCODE_2', 3: 'KEYCODE_3', 4: 'KEYCODE_4',
    5: 'KEYCODE_5', 6: 'KEYCODE_6', 7: 'KEYCODE_7', 8: 'KEYCODE_8', 9: 'KEYCODE_9',
  };
  for (const ch of String(value)) {
    const code = map[ch];
    if (!code) throw new Error('non-digit input blocked');
    adb(['shell', 'input', 'keyevent', code], { noRetry: true });
  }
}

function clearFocused() {
  try {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'], { noRetry: true });
  } catch { /* ignore */ }
  for (let i = 0; i < 40; i += 1) {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'], { noRetry: true });
  }
}

async function waitFor(predicate, { timeoutMs = 25000, everyMs = 1200 } = {}) {
  const started = Date.now();
  let xml = '';
  while (Date.now() - started < timeoutMs) {
    try {
      xml = dumpXml();
      if (predicate(xml)) return { xml, ms: Date.now() - started };
    } catch { /* dump blip */ }
    await sleep(everyMs);
  }
  return { xml, ms: Date.now() - started };
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
  if (!/^\d{3,8}$/.test(pin)) throw new Error('PIN remoto invalido o vacio');
  const charsLine = String(out).split(/\r?\n/).reverse().find((line) => line.includes('pin_chars=')) || `pin_chars=${pin.length}`;
  return { pin, charsLine };
}

function disableIme() {
  try { adb(['shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0'], { noRetry: true }); } catch { /* ignore */ }
  for (const ime of [GBOARD, 'com.google.android.inputmethod.latin/.LatinIME']) {
    try { adb(['shell', 'ime', 'disable', ime], { noRetry: true }); } catch { /* ignore */ }
  }
}

function restoreIme() {
  try { adb(['shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1']); } catch { /* ignore */ }
}

function grantPermissions() {
  const perms = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
  ];
  for (const perm of perms) {
    try { adb(['shell', 'pm', 'grant', PKG, perm], { noRetry: true }); } catch { /* ignore */ }
  }
}

function launchApp() {
  grantPermissions();
  adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]);
}

function evidenceShot(name) {
  const dir = path.resolve(__dirname, '../../build/ui-pass-7flows');
  fs.mkdirSync(dir, { recursive: true });
  const remote = `/data/local/tmp/gmp-7f-${name}.png`;
  adb(['shell', 'screencap', '-p', remote], { timeout: 15000 });
  execFileSync(ADB, ['-s', SERIAL, 'pull', remote, path.join(dir, `${name}.png`)], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isLogin(xml) {
  const s = String(xml);
  return s.includes('Iniciar Ses') || (s.includes('Bienvenido') && s.includes('Contraseña'));
}

function isJefeShell(xml) {
  const s = String(xml);
  if (isLogin(s)) return false;
  return s.includes('content-desc="Panel"')
    || (s.includes('content-desc="Objetivos"') && s.includes('content-desc="Facturas"'))
    || (s.includes('content-desc="Pedidos"') && s.includes('content-desc="Más"'));
}

function isComercialShell(xml) {
  const s = String(xml);
  if (isLogin(s)) return false;
  return s.includes('content-desc="Pedidos"') && s.includes('content-desc="Cobros"');
}

async function openOverflow(xml) {
  if (tapText(xml, 'Más') || tapText(xml, 'Mas') || tapText(xml, 'More')) {
    await sleep(800);
    return dumpXml();
  }
  const more = boundsCenter(xml, (node) =>
    (node.includes('Más') || node.includes('More') || node.includes('NavigationBar')) && node.includes('Más'),
  );
  if (more) {
    tap(more.x, more.y);
    await sleep(800);
    return dumpXml();
  }
  tap(980, 2260);
  await sleep(800);
  try { return dumpXml(); } catch { return xml; }
}

async function tapNav(name) {
  let xml = dumpXml();
  if (tapText(xml, name)) {
    await sleep(400);
    return dumpXml();
  }
  xml = await openOverflow(xml);
  if (tapText(xml, name)) {
    await sleep(400);
    return dumpXml();
  }
  return xml;
}

async function measureScreen(name, navigate, ready) {
  const t0 = Date.now();
  await navigate();
  const { xml, ms } = await waitFor(ready, { timeoutMs: 45000, everyMs: 1500 });
  const ok = ready(xml);
  try { evidenceShot(name); } catch { /* ignore */ }
  record(name, ok, `labels=${labels(xml).filter((l) => /Panel|Objetiv|Factur|Pedido|Histor|Ruta|Rutero|Liquid|€|Error|Reintent/.test(l)).slice(0, 8).join('|')}`, Date.now() - t0 || ms);
  return xml;
}

async function loginDiego(pin) {
  launchApp();
  await sleep(25000);
  let xml = '';
  try { xml = dumpXml(); } catch { xml = ''; }
  if (isJefeShell(xml) || isComercialShell(xml)) {
    record('login diego', true, `already shell labels=${labels(xml).slice(0, 10).join('|')}`, 0);
    return xml;
  }
  if (!xml.includes('Iniciar Ses')) {
    await sleep(8000);
    try { xml = dumpXml(); } catch { xml = ''; }
  }
  if (isJefeShell(xml) || isComercialShell(xml)) {
    record('login diego', true, `shell after wait labels=${labels(xml).slice(0, 10).join('|')}`, 0);
    return xml;
  }
  const user = boundsCenter(xml, (node) => node.includes('EditText') && node.includes('password="false"')) || { x: 540, y: 1333 };
  const pass = boundsCenter(xml, (node) => node.includes('EditText') && node.includes('password="true"')) || { x: 540, y: 1577 };
  const loginBtn = boundsCenter(xml, (node) => node.includes('Iniciar Ses')) || { x: 540, y: 1799 };
  tap(user.x, user.y);
  await sleep(300);
  clearFocused();
  adb(['shell', 'input', 'text', 'diego'], { noRetry: true });
  await sleep(300);
  tap(pass.x, pass.y);
  await sleep(300);
  clearFocused();
  typeDigits(pin);
  await sleep(400);
  disableIme();
  await sleep(300);
  tap(loginBtn.x, loginBtn.y);
  const t0 = Date.now();
  await sleep(15000);
  try { xml = dumpXml(); } catch { xml = ''; }
  if (xml.includes('Selecciona tu Rol') || (xml.includes('COMERCIAL') && xml.includes('REPARTIDOR'))) {
    if (!tapText(xml, 'JEFE de Ventas') && !tapText(xml, 'Jefe de Ventas') && !tapText(xml, 'JEFE')) {
      tapText(xml, 'COMERCIAL');
    }
    await sleep(400);
    try {
      const roleXml = dumpXml();
      tapText(roleXml, 'Confirmar') || tapText(roleXml, 'COMERCIAL');
    } catch { /* ignore */ }
    await sleep(2000);
    try { xml = dumpXml(); } catch { xml = ''; }
  }
  if (!isJefeShell(xml) && !isComercialShell(xml)) {
    const waited = await waitFor(
      (tree) => isJefeShell(tree) || isComercialShell(tree),
      { timeoutMs: 25000, everyMs: 1500 },
    );
    xml = waited.xml;
  }
  record('login diego', isJefeShell(xml) || isComercialShell(xml), `labels=${labels(xml).slice(0, 12).join('|')}`, Date.now() - t0);
  return xml;
}

async function main() {
  disableIme();
  const pkgs = adb(['shell', 'pm', 'list', 'packages', PKG]);
  if (!String(pkgs).includes(PKG)) throw new Error('APK no instalada en emulador');
  const { pin, charsLine } = fetchPinViaSsh();
  record('PIN VDPL1 via SSH', true, charsLine);
  try {
    let xml = await loginDiego(pin);
    try { evidenceShot('01-login'); } catch { /* ignore */ }

    await measureScreen('dashboard jefe', async () => {
      if (!isJefeShell(xml)) xml = await tapNav('Panel');
    }, (tree) => !isLogin(tree) && /content-desc="Panel"|content-desc="Objetivos"|KPI|Facturación/.test(tree));

    await measureScreen('objetivos', async () => {
      xml = await tapNav('Objetivos');
    }, (tree) => !isLogin(tree) && /content-desc="Objetivos"|evolución|Evoluci|meta 20/.test(tree));

    await measureScreen('facturas', async () => {
      xml = await tapNav('Facturas');
    }, (tree) => !isLogin(tree) && /content-desc="Facturas"|Importe|IVA/.test(tree));

    await measureScreen('historial', async () => {
      xml = await tapNav('Pedidos');
      await sleep(800);
      let tree = dumpXml();
      tapText(tree, 'Histórico') || tapText(tree, 'Historial') || tapText(tree, 'Evolución');
    }, (tree) => !isLogin(tree) && /Histor|content-desc="Pedidos"|YoY/.test(tree));

    await measureScreen('rutero', async () => {
      xml = await tapNav('Ruta');
      if (!/content-desc="Ruta"|Rutero/.test(xml)) xml = await tapNav('Rutero');
    }, (tree) => !isLogin(tree) && /content-desc="Ruta"|Rutero|parada/.test(tree));

    await measureScreen('liquidación', async () => {
      xml = await tapNav('Liquidación');
    }, (tree) => !isLogin(tree) && /Liquid|Devuelve|caja|efectivo/.test(tree));
  } finally {
    restoreIme();
  }
  const failed = results.filter((row) => !row.pass).length;
  console.log(`[emulador] done fail=${failed} n=${results.length}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  try { restoreIme(); } catch { /* ignore */ }
  console.error('[emulador] FATAL', error.message);
  process.exit(1);
});
