// pre-ship.mjs — revisión local antes de subir el bot a meow.tel
// Uso: node scripts/pre-ship.mjs bot.js
//
// Qué revisa (según REGLAS.md):
//  1. Que el archivo no use imports, require, red ni sistema de archivos.
//  2. Que defina createBot y que tarde menos de 500 ms (initTimeMs).
//  3. Que act() responda acciones válidas en los dos roles, en casas distintas.
//  4. Que cada act() tarde menos de 50 ms y el total del juego menos de 5 s.
//  5. Que no lance excepciones (en el juego real, una excepción = STAY).
// No simula el juego real: usa observaciones inventadas pero con la forma correcta.

import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || 'bot.js';
const code = fs.readFileSync(file, 'utf8');

const RULES = {
  maxTurns: 400, catchPoints: 3, cheesePoints: 3, hidingTaxEvery: 15,
  botTimeMs: 50, gameTimeMs: 5000, initTimeMs: 500,
  debugMaxChars: 200, debugMaxTiles: 100,
};
const DIRS = ['N', 'S', 'E', 'W'];
const MOVES = [...DIRS, 'STAY'];

const errors = [];
const warnings = [];

// ---------- 1. Revisión estática ----------
const forbidden = [
  [/\brequire\s*\(/, 'usa require()'],
  [/^\s*import\s/m, 'usa import'],
  [/\bimport\s*\(/, 'usa import() dinámico'],
  [/\bfetch\s*\(/, 'usa fetch (red)'],
  [/\bprocess\./, 'usa process (no existe en el juego)'],
];
for (const [re, msg] of forbidden) if (re.test(code)) errors.push(`El archivo ${msg}.`);

// ---------- Generador de casas de prueba ----------
// Semilla fija para que el resultado sea reproducible.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const randInt = (n) => Math.floor(rand() * n);

function makeHouse(width, height, nHoles, nTables) {
  const g = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? '#' : '.'));
  for (let i = 0; i < nTables; i++) g[1 + randInt(height - 2)][1 + randInt(width - 2)] = 'T';
  const holes = [];
  while (holes.length < nHoles) {
    // Agujeros en la pared superior o inferior, con su entrada justo al lado.
    const x = 1 + randInt(width - 2);
    const top = rand() < 0.5;
    const y = top ? 0 : height - 1;
    if (g[y][x] === 'H') continue;
    g[y][x] = 'H';
    const ey = top ? 1 : height - 2;
    g[ey][x] = '.';
    holes.push({ x, y, entrance: { x, y: ey } });
  }
  return { width, height, rows: g.map((r) => r.join('')), holes };
}

const floorTiles = (map) => {
  const t = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      if (map.rows[y][x] === '.' || map.rows[y][x] === 'T') t.push([x, y]);
  return t;
};
const pick = (arr) => arr[randInt(arr.length)];

// ---------- Observaciones de prueba ----------
function catObs(map, turn, floor) {
  const [x, y] = pick(floor);
  const seesMouse = rand() < 0.3;
  const [mx, my] = pick(floor);
  return {
    turn, maxTurns: RULES.maxTurns, role: 'cat',
    score: { cat: randInt(10), mouse: randInt(10) },
    you: { x, y, facing: pick(DIRS), stamina: Math.round(rand() * 100) / 100 },
    mouse: seesMouse ? { x: mx, y: my, carrying: rand() < 0.5 } : null,
    visible: floor.slice(0, 10),
    scent: rand() < 0.5 ? [[mx, my, Math.round(rand() * 100) / 100]] : [],
    cheese: [pick(floor)],
    events: turn === 1 ? [] : randomEvents(map),
  };
}

function mouseObs(map, turn, floor) {
  const state = rand();
  const inHole = state < 0.2 ? randInt(map.holes.length) : null;
  const tunneling = state >= 0.2 && state < 0.3
    ? { to: randInt(map.holes.length), turnsLeft: 1 + randInt(5) } : null;
  const pos = inHole !== null ? map.holes[inHole] : null;
  const [x, y] = pos ? [pos.x, pos.y] : pick(floor);
  const carrying = rand() < 0.4;
  const seesCat = !tunneling && rand() < 0.3;
  const [cx, cy] = pick(floor);
  return {
    turn, maxTurns: RULES.maxTurns, role: 'mouse',
    score: { cat: randInt(10), mouse: randInt(10) },
    you: { x, y, carrying, inHole, tunneling, heavy: carrying && rand() < 0.5 },
    cat: seesCat ? { x: cx, y: cy, facing: pick(DIRS), stamina: rand() } : null,
    bell: tunneling || rand() < 0.5 ? null : Math.round(rand() * 80) / 10,
    bellLoud: rand() < 0.1,
    visible: tunneling ? [] : floor.slice(0, 10),
    cheese: rand() < 0.1 ? [] : [pick(floor)],
    events: turn === 1 ? [] : randomEvents(map),
  };
}

function randomEvents(map) {
  const r = rand();
  if (r < 0.03) return [{ type: 'caught', x: 1, y: 1, respawnHole: randInt(map.holes.length) }];
  if (r < 0.06) return [{ type: 'pickup', x: 2, y: 2 }];
  if (r < 0.08) return [{ type: 'dropped', x: 2, y: 2 }];
  if (r < 0.10) return [{ type: 'delivered', hole: randInt(map.holes.length) }];
  if (r < 0.12) return [{ type: 'cheeseSpawned' }];
  if (r < 0.14) return [{ type: 'hidingTax' }];
  return [];
}

// ---------- Validación de acciones ----------
function checkAction(a, role, map, ctx) {
  if (typeof a === 'string') {
    if (!MOVES.includes(a)) return `acción inválida "${a}" (cuenta como STAY)`;
    return null;
  }
  if (!a || typeof a !== 'object') return `acción inválida ${JSON.stringify(a)} (cuenta como STAY)`;
  if (!MOVES.includes(a.move)) return `move inválido ${JSON.stringify(a.move)} (cuenta como STAY)`;
  if (a.sprint !== undefined && role !== 'cat') warnings.push(`${ctx}: sprint solo sirve para el gato`);
  if (a.look !== undefined && !DIRS.includes(a.look)) return `look inválido ${JSON.stringify(a.look)}`;
  if (a.tunnel !== undefined) {
    if (role !== 'mouse') warnings.push(`${ctx}: tunnel solo sirve para el ratón`);
    else if (!Number.isInteger(a.tunnel) || a.tunnel < 0 || a.tunnel >= map.holes.length)
      return `tunnel a un agujero que no existe (${a.tunnel})`;
  }
  if (a.debug !== undefined && String(a.debug).length > RULES.debugMaxChars)
    warnings.push(`${ctx}: debug supera ${RULES.debugMaxChars} caracteres (se recorta)`);
  if (a.debugTiles !== undefined && (!Array.isArray(a.debugTiles) || a.debugTiles.length > RULES.debugMaxTiles))
    warnings.push(`${ctx}: debugTiles no es arreglo o supera ${RULES.debugMaxTiles} casillas`);
  return null;
}

// ---------- Ejecución ----------
function loadBot() {
  // Sandbox sin require, process ni fs: igual que en el juego.
  const sandbox = { console: { log: () => {} }, Math };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__createBot = typeof createBot === "function" ? createBot : null;', sandbox, { timeout: 2000 });
  return sandbox.__createBot;
}

const houses = [
  ['cabaña pequeña', makeHouse(9, 7, 2, 2)],
  ['mansión con pocos agujeros', makeHouse(31, 21, 2, 10)],
  ['rancho con muchos agujeros', makeHouse(21, 15, 8, 5)],
  ['despensa llena de mesas', makeHouse(15, 11, 3, 40)],
];

let createBot;
if (!errors.length) {
  try { createBot = loadBot(); } catch (e) { errors.push(`El archivo no se puede cargar: ${e.message}`); }
  if (!errors.length && !createBot) errors.push('No se encontró la función createBot.');
}

const stats = [];
if (!errors.length) {
  for (const [name, map] of houses) {
    const floor = floorTiles(map);
    for (const role of ['cat', 'mouse']) {
      const ctx0 = `${name} / ${role}`;
      const setup = { role, map: JSON.parse(JSON.stringify(map)), rules: { ...RULES } };
      let act;
      const t0 = performance.now();
      try { act = createBot(setup); } catch (e) { errors.push(`${ctx0}: createBot lanzó error: ${e.message}`); continue; }
      const initMs = performance.now() - t0;
      if (initMs > RULES.initTimeMs) errors.push(`${ctx0}: createBot tardó ${initMs.toFixed(0)} ms (máx ${RULES.initTimeMs})`);
      if (typeof act !== 'function') { errors.push(`${ctx0}: createBot no devolvió una función act`); continue; }

      let total = 0, max = 0, slow = 0, bad = 0, exc = 0;
      for (let turn = 1; turn <= RULES.maxTurns; turn++) {
        const obs = role === 'cat' ? catObs(map, turn, floor) : mouseObs(map, turn, floor);
        const t = performance.now();
        let a;
        try { a = act(obs); } catch (e) {
          exc++;
          if (exc <= 3) errors.push(`${ctx0} turno ${turn}: excepción: ${e.message}`);
          continue;
        }
        const ms = performance.now() - t;
        total += ms; max = Math.max(max, ms);
        if (ms > RULES.botTimeMs) slow++;
        const problem = checkAction(a, role, map, `${ctx0} turno ${turn}`);
        if (problem) { bad++; if (bad <= 3) errors.push(`${ctx0} turno ${turn}: ${problem}`); }
      }
      if (slow) errors.push(`${ctx0}: ${slow} turnos superaron ${RULES.botTimeMs} ms`);
      if (total > RULES.gameTimeMs) errors.push(`${ctx0}: el juego completo tardó ${total.toFixed(0)} ms (máx ${RULES.gameTimeMs})`);
      else if (total > RULES.gameTimeMs * 0.5) warnings.push(`${ctx0}: usa ${total.toFixed(0)} ms de ${RULES.gameTimeMs} (más de la mitad)`);
      stats.push({ casa: name, rol: role, 'init ms': initMs.toFixed(1), 'total ms': total.toFixed(1), 'máx turno ms': max.toFixed(2), excepciones: exc, inválidas: bad });
    }
  }
}

// ---------- Reporte ----------
console.log(`\nRevisión de ${file}\n`);
if (stats.length) console.table(stats);
const uniq = (a) => [...new Set(a)];
if (warnings.length) { console.log('\nAdvertencias:'); uniq(warnings).slice(0, 10).forEach((w) => console.log('  ⚠ ' + w)); }
if (errors.length) {
  console.log('\nErrores:'); uniq(errors).forEach((e) => console.log('  ✗ ' + e));
  console.log('\nNO SUBIR: corrige los errores primero.\n');
  process.exit(1);
}
console.log('\nOK: listo para subir.\n');
