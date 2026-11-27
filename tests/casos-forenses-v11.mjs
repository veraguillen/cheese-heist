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

test('gato: sprint de remate a 1 casilla en línea recta (regresión v7)', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 60,
    you: { x: 5, y: 5, facing: 'E', stamina: 30 },
    mouse: { x: 6, y: 5, carrying: false },
    visible: [[6, 5]],
  }));
  assert.equal(lastLog(sink).md, 'PERSEGUIR');
  assert.equal(action.move, 'E', 'no avanzó derecho hacia el ratón adyacente');
  assert.equal(action.sprint, true, 'no pidió sprint a 1 casilla: el ratón podría volver a quedar siempre 1 casilla adelante caminando');
});

test('gato: sin estamina, no pide sprint de remate a 1 casilla', () => {
  const { act } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 60,
    you: { x: 5, y: 5, facing: 'E', stamina: 0 },
    mouse: { x: 6, y: 5, carrying: false },
    visible: [[6, 5]],
  }));
  assert.ok(!action.sprint, 'pidió sprint sin estamina suficiente');
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

// ---------------------------------------------------- mirada dirigida (v11)
// Helper para primar dos vistas del ratón y establecer un heading antes de
// perderlo de vista, sin arrastrar estado de los tests anteriores.
function primedCat(sightings) {
  const { act, sink } = loadAct('cat', openHouse());
  for (const overrides of sightings) act(observation('cat', overrides));
  return { act, sink };
}

test('a) sin memoria de ratón: look igual que antes (chooseLook genérico)', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 50,
    you: { x: 2, y: 1, facing: 'E', stamina: 30 },
    events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  assert.equal(lastLog(sink).lm, 0, 'sin ninguna vista previa no debería haber memoria activa');
  assert.equal(action.look, 'S', 'sin memoria, el look debería salir de chooseLook (igual que antes de esta sesión)');
});

test('b) ratón perdido con heading N: el ciclo alterna N y los costados', () => {
  const { act, sink } = primedCat([
    { turn: 10, you: { x: 6, y: 6 }, mouse: { x: 6, y: 6, carrying: false } },
    { turn: 11, you: { x: 6, y: 6 }, mouse: { x: 6, y: 5, carrying: false } }, // dy=-1 -> heading N
  ]);
  const looks = [];
  for (let t = 12; t <= 15; t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 } }));
    looks.push(lastLog(sink).lk);
  }
  assert.deepEqual(looks, ['N', 'W', 'N', 'E'], 'el ciclo debería ser heading, izquierda, heading, derecha');
});

test('c) pasados más de 8 turnos sin ver al ratón: vuelve al look genérico (lm=0)', () => {
  const { act, sink } = primedCat([
    { turn: 10, you: { x: 6, y: 6 }, mouse: { x: 6, y: 6, carrying: false } },
    { turn: 11, you: { x: 6, y: 6 }, mouse: { x: 6, y: 5, carrying: false } },
  ]);
  let last;
  for (let t = 12; t <= 20; t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 } }));
    last = lastLog(sink);
  }
  assert.equal(last.lm, 0, 'a los 9 turnos sin ver al ratón (>8) la memoria ya debería estar vencida');
});

test('d) la mirada dirigida no cambia move ni sprint (INTERCEPTAR)', () => {
  const { act, sink } = primedCat([
    { turn: 48, you: { x: 5, y: 1 }, mouse: { x: 7, y: 1, carrying: false } },
    { turn: 49, you: { x: 5, y: 1 }, mouse: { x: 8, y: 1, carrying: false } }, // dx=1 -> heading E
  ]);
  const action = act(observation('cat', {
    turn: 50,
    you: { x: 2, y: 1, facing: 'E', stamina: 30 },
    events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  const d = lastLog(sink);
  assert.equal(d.md, 'INTERCEPTAR');
  assert.equal(action.move, 'E', 'move debería ser igual al caso sin memoria (a)');
  assert.equal(action.sprint, true, 'sprint debería ser igual al caso sin memoria (a)');
  assert.equal(d.lm, 1, 'acá sí debería haber memoria activa');
  assert.equal(action.look, 'E', 'con memoria, el look cambia a la dirección del heading (antes era S)');
});

test('e) ratón visto dos turnos sin moverse y luego perdido: conserva el heading', () => {
  const { act, sink } = primedCat([
    { turn: 10, you: { x: 6, y: 6 }, mouse: { x: 6, y: 4, carrying: false } }, // primera vista: sin heading previo
    { turn: 11, you: { x: 6, y: 6 }, mouse: { x: 6, y: 5, carrying: false } }, // dy=+1 -> heading S
    { turn: 12, you: { x: 6, y: 6 }, mouse: { x: 6, y: 5, carrying: false } }, // mismo lugar (delta 0,0): conserva S
  ]);
  act(observation('cat', { turn: 13, you: { x: 6, y: 6 } }));
  const d = lastLog(sink);
  assert.equal(d.lm, 1);
  assert.equal(d.lk, 'S', 'el heading S debería conservarse pese al turno sin movimiento');
});

test('f) delta diagonal (2,1): usa el eje de mayor |delta| (x)', () => {
  const { act, sink } = primedCat([
    { turn: 10, you: { x: 6, y: 6 }, mouse: { x: 5, y: 5, carrying: false } },
    { turn: 11, you: { x: 6, y: 6 }, mouse: { x: 7, y: 6, carrying: false } }, // dx=2, dy=1 -> eje x -> E
  ]);
  act(observation('cat', { turn: 12, you: { x: 6, y: 6 } }));
  const d = lastLog(sink);
  assert.equal(d.lm, 1);
  assert.equal(d.lk, 'E', 'con |dx|=2 > |dy|=1, el heading debería ser E');
});

test('g) el primer turno sin ver al ratón mira a primary, no a un costado', () => {
  const { act, sink } = primedCat([
    { turn: 10, you: { x: 6, y: 6 }, mouse: { x: 6, y: 6, carrying: false } },
    { turn: 11, you: { x: 6, y: 6 }, mouse: { x: 6, y: 5, carrying: false } }, // heading N
  ]);
  act(observation('cat', { turn: 12, you: { x: 6, y: 6 } })); // primer turno perdido
  const d = lastLog(sink);
  assert.equal(d.lk, 'N', 'el primer turno perdido debería usar primary (N), no un costado');
});

// --------------------------------------------------------- correa de PERSEGUIR (v11)
// Pared completa sin puerta en x=6: separa la casa en dos mitades que no se
// comunican por ningún camino -- para probar el caso "visible pero Infinity".
function splitHouse() {
  const width = 13;
  const height = 13;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'));
  for (let y = 1; y < height - 1; y++) rows[y][6] = '#';
  rows[0][1] = 'H';
  return {
    width, height, rows: rows.map((row) => row.join('')),
    holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }],
  };
}

test('a) ratón visible a 3 (dentro de la correa) -> PERSEGUIR', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1 }, mouse: { x: 5, y: 1, carrying: false }, cheese: [[6, 6]],
  }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(action.move, 'E');
  assert.equal(d.lj, 0, 'a d=3 no debería marcarse la correa');
});

test('b) ratón visible a 7 (fuera de la correa) -> no PERSEGUIR, cae a CENTINELA (hay queso)', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1 }, mouse: { x: 9, y: 1, carrying: false }, cheese: [[6, 6], [3, 9]],
  }));
  const d = lastLog(sink);
  assert.notEqual(d.md, 'PERSEGUIR', 'a d=7 no debería perseguir');
  assert.equal(d.md, 'CENTINELA', 'con queso en el piso, el fallback es CENTINELA, no PATRULLA');
  assert.equal(d.lj, 1, 'debería marcar la correa activa');
  assert.notEqual(action.move, 'STAY', 'no debería quedarse quieto con quesos alcanzables');
});

test('c) ratón visible a 7 con pickup reciente -> INTERCEPTAR (la correa no bloquea esto)', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', {
    turn: 1, you: { x: 2, y: 1 }, cheese: [[6, 6]], events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  const action = act(observation('cat', {
    turn: 2, you: { x: 2, y: 1 }, mouse: { x: 9, y: 1, carrying: false }, cheese: [[6, 6]],
  }));
  const d = lastLog(sink);
  assert.equal(d.md, 'INTERCEPTAR');
  assert.equal(d.lj, 1, 'el ratón sigue fuera de la correa aunque se intercepte por el pickup');
  assert.equal(action.move, 'E');
});

test('d) sprintRemate a 1 y 2 sigue igual (la correa no lo toca)', () => {
  const { act: act1 } = loadAct('cat', openHouse());
  const a1 = act1(observation('cat', {
    turn: 1, you: { x: 5, y: 5 }, mouse: { x: 6, y: 5, carrying: false }, visible: [[6, 5]],
  }));
  assert.equal(a1.move, 'E');
  assert.equal(a1.sprint, true, 'remate a d=1 sin cambios');

  const { act: act2 } = loadAct('cat', openHouse());
  const a2 = act2(observation('cat', {
    turn: 1, you: { x: 5, y: 5 }, mouse: { x: 7, y: 5, carrying: true }, visible: [[7, 5]],
  }));
  assert.equal(a2.move, 'E');
  assert.equal(a2.sprint, true, 'remate a d=2 con queso sin cambios');
});

test('e) ratón visible pero inalcanzable (Infinity) -> PATRULLA, no STAY fijo', () => {
  const { act, sink } = loadAct('cat', splitHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 3, y: 6 }, mouse: { x: 9, y: 6, carrying: false }, cheese: [[3, 3], [9, 9]],
  }));
  const d = lastLog(sink);
  assert.ok(['PATRULLA', 'INTERCEPTAR'].includes(d.md), `esperaba PATRULLA o INTERCEPTAR, salió ${d.md}`);
  assert.notEqual(action.move, 'STAY', 'no debería congelarse con un queso alcanzable del otro lado de la pared');
});

// ---------------------------------------------------------------- CENTINELA (v10, restaurado)
test('a) CENTINELA: 2 quesos en extremos opuestos -> va hacia el centro', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 1, y: 6 }, cheese: [[2, 2], [10, 10]],
  }));
  const d = lastLog(sink);
  assert.equal(d.md, 'CENTINELA');
  assert.equal(d.tg, '6,6', 'el centro de un cuarto simétrico 13x13 debería ser (6,6)');
  assert.notEqual(action.move, 'STAY');
});

test('b) CENTINELA en el centro: STAY con look rotando N,E,S,W', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const looks = [];
  for (let t = 1; t <= 4; t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
    const d = lastLog(sink);
    assert.equal(d.md, 'CENTINELA');
    looks.push(d.lk);
  }
  assert.deepEqual(looks, ['N', 'E', 'S', 'W'], 'el giro debería completar las 4 direcciones en orden');
});

test('c) CENTINELA recalcula cuando cambia el conjunto de quesos', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 6 }, cheese: [[2, 2], [10, 10]] }));
  const tgAntes = lastLog(sink).tg;
  act(observation('cat', { turn: 2, you: { x: 2, y: 6 }, cheese: [[2, 2], [5, 2]] }));
  const tgDespues = lastLog(sink).tg;
  assert.notEqual(tgAntes, tgDespues, 'con otro conjunto de quesos, el centro debería recalcularse');
});

test('d) CENTINELA con 1 solo queso: el centro es la casilla del queso', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 6 }, cheese: [[6, 6]] }));
  const d = lastLog(sink);
  assert.equal(d.md, 'CENTINELA');
  assert.equal(d.tg, '6,6');
});

test('f) sin ningún queso en el piso: PATRULLA, no CENTINELA', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 6 }, cheese: [] }));
  assert.equal(lastLog(sink).md, 'PATRULLA');
});

test('g) CENTINELA: tras 8 turnos seguidos sin señal, el 9no turno rompe a patrulla', () => {
  const { act, sink } = loadAct('cat', openHouse());
  for (let t = 1; t <= 8; t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
    assert.equal(lastLog(sink).md, 'CENTINELA', `turno ${t}: todavía debería estar en CENTINELA`);
  }
  act(observation('cat', { turn: 9, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
  assert.notEqual(lastLog(sink).md, 'CENTINELA', 'tras 8 turnos seguidos, el 9no debería romper a patrulla');
});

test('h) CENTINELA: una señal real (PERSEGUIR) resetea el contador', () => {
  const { act, sink } = loadAct('cat', openHouse());
  for (let t = 1; t <= 4; t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
  }
  act(observation('cat', { turn: 5, you: { x: 6, y: 6 }, mouse: { x: 7, y: 6, carrying: false }, cheese: [[2, 2], [10, 10]] }));
  assert.equal(lastLog(sink).md, 'PERSEGUIR');
  // Tras perder al ratón, OLOR lo cubre unos turnos mientras decae la
  // creencia (también cuenta como señal real: resetea el contador cada
  // vez) -- se deja correr hasta que vuelva a CENTINELA por su cuenta.
  let t = 6;
  let md;
  do {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
    md = lastLog(sink).md;
    t++;
  } while (md !== 'CENTINELA' && t < 60);
  assert.equal(md, 'CENTINELA', 'debería volver a CENTINELA una vez que decae la creencia de OLOR');
  // Desde que vuelve a CENTINELA, debería aguantar los 8 turnos completos
  // (no solo los 4 que le faltaban antes de la señal del turno 5).
  for (let i = 1; i <= 7; i++, t++) {
    act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
    assert.equal(lastLog(sink).md, 'CENTINELA', `turno ${t}: todavía deberían faltar turnos para completar los 8 desde el reseteo`);
  }
  act(observation('cat', { turn: t, you: { x: 6, y: 6 }, cheese: [[2, 2], [10, 10]] }));
  assert.notEqual(lastLog(sink).md, 'CENTINELA', 'tras 8 turnos seguidos desde el reseteo, debería romper a patrulla');
});

test('init rápido en mapas grandes (~800 casillas): sin esto, timeout real contra Imanol', () => {
  const width = 31;
  const height = 29;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'));
  const holes = [];
  for (let i = 0; i < 8; i++) {
    const x = 1 + (i * 3) % (width - 2);
    const top = i % 2 === 0;
    const y = top ? 0 : height - 1;
    rows[y][x] = 'H';
    holes.push({ x, y, entrance: { x, y: top ? 1 : height - 2 } });
  }
  const map = { width, height, rows: rows.map((row) => row.join('')), holes };
  const started = performance.now();
  loadAct('cat', map);
  const initMs = performance.now() - started;
  assert.ok(initMs < 200, `init tardó ${initMs.toFixed(1)} ms en un mapa de ~${(width - 2) * (height - 2)} casillas -- antes del umbral bajado a 250, esto tardaba 35-47 ms local (y timeouteó en meow.tel)`);
});

// ------------------------------------------------------------- sprint por radio
// Pared en forma de L: (1,1)->(2,1) 1 casilla al E y recién ahí dobla al S
// -- el camino más corto a (2,4) gira en el segundo paso, a propósito.
function bendHouse() {
  const width = 6;
  const height = 6;
  const rows = Array.from({ length: height }, () => Array(width).fill('#'));
  rows[1][1] = '.'; rows[1][2] = '.'; rows[2][2] = '.'; rows[3][2] = '.'; rows[4][2] = '.';
  rows[0][1] = 'H';
  return { width, height, rows: rows.map((row) => row.join('')), holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }] };
}

test('a) sprint por radio: con queso, d=4 en línea recta, estamina llena -> sprint', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 6, y: 1, carrying: true }, cheese: [[8, 8]],
  }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(action.move, 'E');
  assert.equal(action.sprint, true);
  assert.equal(d.sr, 1);
});

test('b) sprint por radio: igual pero sin queso -> sin sprint por radio', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 6, y: 1, carrying: false }, cheese: [[8, 8]],
  }));
  assert.notEqual(action.sprint, true);
  assert.equal(lastLog(sink).sr, 0);
});

test('c) sprint por radio: con queso pero estamina bajo la reserva -> sin sprint', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1, stamina: 3 }, mouse: { x: 6, y: 1, carrying: true }, cheese: [[8, 8]],
  }));
  assert.notEqual(action.sprint, true, 'con sprintCost default (2), la reserva pide >=4 de estamina');
  assert.equal(lastLog(sink).sr, 0);
});

test('d) sprint por radio: con queso pero el camino gira en el primer paso -> sin sprint', () => {
  const { act, sink } = loadAct('cat', bendHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 1, y: 1, stamina: 30 }, mouse: { x: 2, y: 4, carrying: true },
  }));
  const d = lastLog(sink);
  assert.equal(d.d, 4, 'la distancia por camino debería seguir siendo 4 (1 E + 3 S)');
  assert.notEqual(action.sprint, true, 'el camino dobla en el segundo paso (E, S), no es línea recta');
  assert.equal(d.sr, 0);
});

test('e) sprint por radio: a 1-2 alineado, sprintRemate sigue igual', () => {
  const { act: act1 } = loadAct('cat', openHouse());
  const a1 = act1(observation('cat', {
    turn: 1, you: { x: 5, y: 5, stamina: 30 }, mouse: { x: 6, y: 5, carrying: false }, visible: [[6, 5]],
  }));
  assert.equal(a1.move, 'E');
  assert.equal(a1.sprint, true);

  const { act: act2 } = loadAct('cat', openHouse());
  const a2 = act2(observation('cat', {
    turn: 1, you: { x: 5, y: 5, stamina: 30 }, mouse: { x: 7, y: 5, carrying: true }, visible: [[7, 5]],
  }));
  assert.equal(a2.move, 'E');
  assert.equal(a2.sprint, true);
});

test('f) sprint por radio: a 5 casillas -> fuera de la correa, sin sprint por radio', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 7, y: 1, carrying: true }, cheese: [[5, 5], [9, 9]],
  }));
  const d = lastLog(sink);
  assert.notEqual(d.md, 'PERSEGUIR');
  assert.equal(d.lj, 1);
  assert.equal(d.sr, 0);
});

test('g1) sprint por radio: sprintCost default y estamina >= 2*sprintCost -> sprint', () => {
  const { act, sink } = loadAct('cat', openHouse());
  const action = act(observation('cat', {
    turn: 1, you: { x: 2, y: 1, stamina: 4 }, mouse: { x: 6, y: 1, carrying: true },
  }));
  assert.equal(action.sprint, true);
  assert.equal(lastLog(sink).sr, 1);
});

test('g2) sprint por radio: sprintCost aprendido alto de forma consistente -> sin sprint', () => {
  const { act, sink } = loadAct('cat', openHouse());
  // Con el promedio móvil (ya no el Math.max de antes), una sola lectura
  // ruidosa no alcanza para inflar sprintCost -- hace falta una casa donde
  // el sprint sea caro DE VERDAD, de forma consistente en varios sprints.
  let turn = 1;
  for (let i = 0; i < 6; i++) {
    act(observation('cat', { turn: turn++, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 3, y: 1, carrying: false } }));
    act(observation('cat', { turn: turn++, you: { x: 3, y: 1, stamina: 10 } }));
  }
  const action = act(observation('cat', {
    turn: turn++, you: { x: 3, y: 1, stamina: 30 }, mouse: { x: 7, y: 1, carrying: true },
  }));
  assert.notEqual(action.sprint, true, 'con sprintCost aprendido alto de forma consistente, 2*sprintCost no entra en la estamina real');
  assert.equal(lastLog(sink).sr, 0);
});

test('g3) sprintCost: una lectura ruidosa ya no queda pegada (se corrige con una lectura real después)', () => {
  const { act: actOld } = loadAct('cat', openHouse());
  const { act: actNew } = loadAct('cat', openHouse());
  // Una sola lectura alta (ruido), y después varias lecturas reales bajas.
  for (const act of [actOld, actNew]) {
    act(observation('cat', { turn: 1, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 3, y: 1, carrying: false } }));
    act(observation('cat', { turn: 2, you: { x: 3, y: 1, stamina: 10 } })); // -20 de golpe, una vez
  }
  // 5 sprints reales más, con costo chico de verdad (-2 cada uno).
  let turn = 3;
  let lastAction;
  for (let i = 0; i < 5; i++) {
    actNew(observation('cat', { turn: turn, you: { x: 2, y: 1, stamina: 30 }, mouse: { x: 3, y: 1, carrying: false } }));
    lastAction = actNew(observation('cat', { turn: turn + 1, you: { x: 2, y: 1, stamina: 28 }, mouse: { x: 4, y: 1, carrying: true }, visible: [[4, 1]] }));
    turn += 2;
  }
  assert.equal(lastAction.sprint, true, 'con varias lecturas reales bajas después de una ruidosa, el sprint a d=2 debería volver a dispararse');
});

// ----------------------------------------------------- intercepción predictiva
// Pasillo de 1 casilla de ancho, largo, con el único agujero en una punta.
function corridorHouse() {
  const width = 10;
  const height = 3;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      y === 0 || y === height - 1 || x === 0 || x === width - 1 ? '#' : '.'));
  rows[0][1] = 'H';
  return { width, height, rows: rows.map((row) => row.join('')), holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }] };
}
// Pasillo angosto de 1 casilla que termina justo en la entrada de un agujero.
function holeCorridorHouse() {
  const width = 3;
  const height = 6;
  const rows = Array.from({ length: height }, () => Array(width).fill('#'));
  for (let y = 1; y < height - 1; y++) rows[y][1] = '.';
  rows[0][1] = 'H';
  return { width, height, rows: rows.map((row) => row.join('')), holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }] };
}

test('a) intercepción predictiva: pasillo recto con heading conocido -> corta adelante', () => {
  const { act, sink } = loadAct('cat', corridorHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 1 }, mouse: { x: 4, y: 1, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 2, y: 1 }, mouse: { x: 5, y: 1, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(d.pi, 1, 'con heading E en un pasillo recto, debería predecir adelante');
  assert.notEqual(d.tg, '5,1', 'el target no debería ser la casilla actual del ratón');
});

test('b) intercepción predictiva: cuarto abierto -> sin predicción (persigue la casilla actual)', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', { turn: 1, you: { x: 3, y: 6 }, mouse: { x: 5, y: 6, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 3, y: 6 }, mouse: { x: 6, y: 6, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(d.pi, 0, 'en un cuarto abierto (grado != 2) no debería confiar en la predicción');
  assert.equal(d.tg, '6,6', 'el target debería ser la casilla actual del ratón');
});

test('c) intercepción predictiva: sin heading (primera vista) -> persigue la casilla actual', () => {
  const { act, sink } = loadAct('cat', openHouse());
  act(observation('cat', { turn: 1, you: { x: 3, y: 6 }, mouse: { x: 6, y: 6, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 0);
  assert.equal(d.tg, '6,6');
});

test('d) intercepción predictiva: el pasillo termina en un agujero -> corta la entrada', () => {
  const { act, sink } = loadAct('cat', holeCorridorHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 4 }, mouse: { x: 1, y: 4, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 1, y: 4 }, mouse: { x: 1, y: 3, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 1);
  assert.equal(d.tg, '1,1', 'debería cortar en la entrada, no en el agujero mismo');
});

test('e) intercepción predictiva: sprintRemate sigue mirando la posición real del ratón', () => {
  const { act, sink } = loadAct('cat', corridorHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 1 }, mouse: { x: 4, y: 1, carrying: false } }));
  const action = act(observation('cat', { turn: 2, you: { x: 2, y: 1 }, mouse: { x: 3, y: 1, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 1, 'el target de la ruta sigue siendo predictivo (apunta a la entrada)');
  assert.equal(action.move, 'E');
  assert.equal(action.sprint, true, 'a d=1 real del ratón, sprintRemate debería disparar igual, sin importar el target predicho');
});

test('f) intercepción predictiva: con varios quesos en el piso no cambia nada', () => {
  const { act, sink } = loadAct('cat', corridorHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 1 }, mouse: { x: 4, y: 1, carrying: false }, cheese: [[5, 1]] }));
  const action = act(observation('cat', { turn: 2, you: { x: 2, y: 1 }, mouse: { x: 5, y: 1, carrying: false }, cheese: [[5, 1], [3, 1]] }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(d.pi, 1);
  assert.notEqual(action.move, 'STAY');
});

// ------------------------------------------ intercepción predictiva: bifurcaciones (v21)
// Pasillo horizontal que llega a una bifurcación en Y (sigue derecho al
// este, y además una rama angosta hacia el norte que no sigue el rumbo).
function yHouse() {
  return {
    width: 9,
    height: 4,
    rows: [
      '#########',
      '#####.###',
      '#.......#',
      '#########',
    ],
    holes: [],
  };
}
// Misma bifurcación en Y, pero la rama recta (este) termina en un agujero.
function yHoleHouse() {
  return {
    width: 10,
    height: 4,
    rows: [
      '##########',
      '#####.####',
      '#.......H#',
      '##########',
    ],
    holes: [{ x: 8, y: 2, entrance: { x: 7, y: 2 } }],
  };
}
// Bifurcación sin ninguna rama recta en el rumbo (solo norte y sur): nada
// "claro" para elegir.
function bifurcacionSinRectaHouse() {
  return {
    width: 5,
    height: 5,
    rows: [
      '#####',
      '###.#',
      '#...#',
      '###.#',
      '#####',
    ],
    holes: [],
  };
}
// Bifurcación en Y cuya rama recta se abre de inmediato a un cuarto (grado
// > 2 apenas un paso adentro): no es una rama angosta confiable.
function bifurcacionCuartoHouse() {
  return {
    width: 8,
    height: 5,
    rows: [
      '########',
      '###....#',
      '#......#',
      '####...#',
      '########',
    ],
    holes: [],
  };
}

test('g) bifurcación en Y: rama recta en el rumbo y angosta -> la sigue', () => {
  const { act, sink } = loadAct('cat', yHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 2 }, mouse: { x: 4, y: 2, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 2, y: 2 }, mouse: { x: 5, y: 2, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.md, 'PERSEGUIR');
  assert.equal(d.pi, 1, 'con heading E y una rama recta angosta en la bifurcación, debería seguirla');
  assert.notEqual(d.tg, '5,2', 'el target no debería ser la casilla actual del ratón (la bifurcación)');
});

test('h) bifurcación sin rama recta en el rumbo -> conservador (persigue la casilla actual)', () => {
  const { act, sink } = loadAct('cat', bifurcacionSinRectaHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 2 }, mouse: { x: 2, y: 2, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 1, y: 2 }, mouse: { x: 3, y: 2, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 0, 'sin ninguna rama recta en el rumbo (solo norte y sur), no hay nada "claro" que elegir');
  assert.equal(d.tg, '3,2', 'debería quedarse con la casilla actual del ratón');
});

test('i) bifurcación cuya rama recta se abre a un cuarto -> no la selecciona (conservador)', () => {
  const { act, sink } = loadAct('cat', bifurcacionCuartoHouse());
  act(observation('cat', { turn: 1, you: { x: 1, y: 2 }, mouse: { x: 2, y: 2, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 1, y: 2 }, mouse: { x: 3, y: 2, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 0, 'la rama recta abre de inmediato a un cuarto (grado > 2): no es una rama angosta confiable');
  assert.equal(d.tg, '3,2', 'debería quedarse con la casilla actual del ratón, no inventar una rama hacia el cuarto');
});

test('j) bifurcación en Y próxima a un agujero -> corta la entrada, no el agujero', () => {
  const { act, sink } = loadAct('cat', yHoleHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 2 }, mouse: { x: 4, y: 2, carrying: false } }));
  act(observation('cat', { turn: 2, you: { x: 2, y: 2 }, mouse: { x: 5, y: 2, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 1);
  assert.equal(d.tg, '7,2', 'debería cortar en la entrada del agujero, nunca en el agujero mismo');
});

test('k) bifurcación: ratón sin rumbo conocido (primera vista) -> no inventa un rumbo', () => {
  const { act, sink } = loadAct('cat', yHouse());
  act(observation('cat', { turn: 1, you: { x: 2, y: 2 }, mouse: { x: 5, y: 2, carrying: false } }));
  const d = lastLog(sink);
  assert.equal(d.pi, 0, 'sin ninguna vista anterior, no hay heading: no debe inventar un rumbo en la bifurcación');
  assert.equal(d.tg, '5,2');
});

console.log('OK: los 50 casos forenses v11 pasaron.');
