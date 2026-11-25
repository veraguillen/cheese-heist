import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
const rules = {
  maxTurns: 400,
  catchPoints: 3,
  cheesePoints: 3,
  hidingTaxEvery: 15,
  botTimeMs: 50,
  gameTimeMs: 5000,
  initTimeMs: 500,
  debugMaxChars: 200,
  debugMaxTiles: 100,
};

function openHouse() {
  const width = 13;
  const height = 13;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'));
  rows[0][1] = 'H';
  rows[0][11] = 'H';
  rows[0][1] = 'H';
  rows[0][11] = 'H';
  return {
    width,
    height,
    rows: rows.map((row) => row.join('')),
    holes: [
      { x: 1, y: 0, entrance: { x: 1, y: 1 } },
      { x: 11, y: 0, entrance: { x: 11, y: 1 } },
    ],
  };
}

function loadAct(role, map) {
  const sink = [];
  const sandbox = { console: { log: (line) => sink.push(line) }, Math };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;globalThis.__createBot = createBot;', sandbox, { timeout: 2000 });
  const act = sandbox.__createBot({ role, map, rules });
  return { act, sink };
}

function observation(role, overrides = {}) {
  const base = role === 'mouse'
    ? {
        turn: 1,
        maxTurns: 400,
        role,
        score: { cat: 0, mouse: 0 },
        you: { x: 6, y: 5, carrying: false, inHole: null, tunneling: null, heavy: false },
        cat: null,
        bell: null,
        bellLoud: false,
        visible: [],
        cheese: [],
        events: [],
      }
    : {
        turn: 1,
        maxTurns: 400,
        role,
        score: { cat: 0, mouse: 0 },
        you: { x: 2, y: 1, facing: 'E', stamina: 30 },
        mouse: null,
        visible: [],
        scent: [],
        cheese: [],
        events: [],
      };
  return { ...base, ...overrides, you: { ...base.you, ...(overrides.you || {}) } };
}

function lastLog(sink) {
  const line = sink.filter((entry) => entry.startsWith('D|')).at(-1);
  assert.ok(line, 'bot did not write a D| log');
  return JSON.parse(line.slice(2));
}

function test(name, fn) {
  fn();
  console.log(`OK - ${name}`);
}

test('Lucas t91: evita el queso perdedor al escapar del gato', () => {
  const { act } = loadAct('mouse', openHouse());
  const action = act(observation('mouse', {
    turn: 91,
    you: { x: 6, y: 9 },
    cat: { x: 6, y: 10, facing: 'N', stamina: 10 },
    cheese: [[6, 8]],
    visible: [[6, 10]],
  }));
  assert.notEqual(action.move, 'N', 'escapar pisó el queso perdedor en (6,8)');
});

test('pickup t400 y t388: descarta quesos sin horizonte de entrega', () => {
  for (const turn of [388, 400]) {
    const { act, sink } = loadAct('mouse', openHouse());
    const action = act(observation('mouse', {
      turn,
      maxTurns: 400,
      you: { x: 9, y: 5 },
      cheese: [[8, 5]],
    }));
    assert.notEqual(action.move, 'W', `turno ${turn}: avanzó al pickup sin tiempo para entregarlo`);
    assert.notEqual(lastLog(sink).tg, '8,5', `turno ${turn}: seleccionó el queso imposible`);
  }
});

test('Timothy t394: mantiene el agujero comprometido sin bloqueo real', () => {
  const { act, sink } = loadAct('mouse', openHouse());
  act(observation('mouse', {
    turn: 393,
    you: { x: 2, y: 2, carrying: true },
    cat: { x: 8, y: 5, facing: 'W', stamina: 10 },
  }));
  const action = act(observation('mouse', {
    turn: 394,
    you: { x: 2, y: 1, carrying: true },
    cat: { x: 8, y: 5, facing: 'W', stamina: 10 },
  }));
  assert.equal(lastLog(sink).tg, '1,1', 'cambió de agujero pese a que la ruta actual no está bloqueada');
  assert.equal(action.move, 'W', 'no siguió hacia la entrada comprometida (1,1)');
});

test('bell 2.6 sin visión: no se expone al pickup con carrera perdida', () => {
  const { act, sink } = loadAct('mouse', openHouse());
  const action = act(observation('mouse', {
    turn: 120,
    you: { x: 6, y: 5 },
    cat: null,
    bell: 2.6,
    cheese: [[7, 5]],
  }));
  assert.notEqual(lastLog(sink).tg, '7,5', 'el belief por cascabel permitió el queso expuesto');
  assert.notEqual(action.move, 'E', 'se acercó al queso a pesar del cascabel cercano');
});

test('ratón pesado y acorralado: suelta el queso antes de regalar una captura', () => {
  const { act } = loadAct('mouse', openHouse());
  const action = act(observation('mouse', {
    turn: 180,
    you: { x: 6, y: 5, carrying: true, heavy: true },
    cat: { x: 6, y: 4, facing: 'S', stamina: 10 },
  }));
  assert.equal(action.move, 'STAY');
  assert.equal(action.drop, true);
});

test('gato: pickup lejano dispara intercepción y no STAY', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 50,
    you: { x: 2, y: 1, facing: 'E', stamina: 30 },
    events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  assert.equal(lastLog(sink).md, 'INTERCEPTAR');
  assert.equal(action.move, 'E', 'no avanzó hacia la entrada de corte del pickup lejano');
  assert.notEqual(action.move, 'STAY');
});

test('gato: sprint alineado de dos casillas para cerrar captura', () => {
  const { act } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 75,
    you: { x: 5, y: 5, facing: 'E', stamina: 30 },
    mouse: { x: 7, y: 5, carrying: true },
    visible: [[7, 5]],
  }));
  assert.equal(action.move, 'E');
  assert.equal(action.sprint, true);
});

test('fallback BFS cacheado funciona con más de 900 celdas', () => {
  const width = 35;
  const height = 30;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'));
  rows[0][2] = 'H';
  const map = {
    width,
    height,
    rows: rows.map((row) => row.join('')),
    holes: [{ x: 2, y: 0, entrance: { x: 2, y: 1 } }],
  };
  const started = performance.now();
  const { act } = loadAct('cat', map);
  const initMs = performance.now() - started;
  const action = act(observation('cat', {
    you: { x: 15, y: 15, facing: 'N', stamina: 30 },
    cheese: [[30, 25]],
  }));
  assert.ok(initMs < 500, `createBot excedió el límite: ${initMs.toFixed(2)} ms`);
  assert.ok(['N', 'S', 'E', 'W', 'STAY'].includes(action.move));
});

console.log('OK: los 8 casos forenses v11 pasaron.');
