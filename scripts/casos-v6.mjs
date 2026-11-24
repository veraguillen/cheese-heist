// casos-v6.mjs — casos de prueba a mano para v6 (mirar hacia la amenaza).
// Uso: node scripts/casos-v6.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs y casos-v5.mjs, y corre
// escenarios chicos hechos a mano donde se puede predecir el resultado
// esperado sin ambigüedad (sin empates de BFS).

import fs from 'node:fs';
import vm from 'node:vm';

const RULES = {
  maxTurns: 400, catchPoints: 3, cheesePoints: 3, hidingTaxEvery: 15,
  botTimeMs: 50, gameTimeMs: 5000, initTimeMs: 500, debugMaxChars: 200, debugMaxTiles: 400,
};

function loadBot(archivo) {
  const code = fs.readFileSync(archivo, 'utf8');
  const sink = [];
  const sandbox = { console: { log: (s) => sink.push(s) }, Math };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__createBot = createBot;', sandbox, { timeout: 2000 });
  return { createBot: sandbox.__createBot, sink };
}

function catObs(over) {
  return Object.assign({
    turn: 1, maxTurns: 400, role: 'cat', score: { cat: 0, mouse: 0 },
    you: { x: 0, y: 0, facing: 'N', stamina: 30 },
    mouse: null, visible: [], scent: [], cheese: [],
    events: [],
  }, over);
}

function lastD(sink) {
  const linea = sink.filter((l) => l.startsWith('D|')).pop();
  return linea ? JSON.parse(linea.slice(2)) : null;
}

// Pasillo de dos agujeros, igual al de casos-v5.mjs: cualquier distancia es
// única (sin empates de BFS) mientras el queso no quede justo al medio.
function corridorDosHoyos() {
  return {
    width: 11,
    height: 3,
    rows: [
      '#H#######H#',
      '#.........#',
      '###########',
    ],
    holes: [
      { x: 1, y: 0, entrance: { x: 1, y: 1 } },
      { x: 9, y: 0, entrance: { x: 9, y: 1 } },
    ],
  };
}

let fallas = 0;
let total = 0;
function caso(nombre, fn) {
  total++;
  try {
    fn();
    console.log(`OK   - ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA - ${nombre}: ${e.message}`);
  }
}

function assert(cond, mensaje) {
  if (!cond) throw new Error(mensaje);
}

// ---------------------------------------------------------------- caso a
caso("a) gato sobre el queso, entrada del agujero más cercano al W -> STAY, look 'W', lk='W'", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  // Queso en (3,1): agujero 0 (x=1) a distancia 3 por el grafo del ratón,
  // agujero 1 (x=9) a distancia 7 -- gana el 0, entrada (1,1), al oeste.
  sink.length = 0;
  const action = act(catObs({ you: { x: 3, y: 1, facing: 'N', stamina: 30 }, cheese: [[3, 1]] }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba VIGILAR_QUESO, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY (ya está sobre el queso), salió ${action.move}`);
  assert(action.look === 'W', `esperaba look 'W', salió ${action.look}`);
  assert(d.lk === 'W', `esperaba lk='W' en el registro, salió ${d.lk}`);
});

// ---------------------------------------------------------------- caso b
caso("b) EMBOSCADA: quieto en la entrada, pickup al E por el pasillo -> look 'E'", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  // Gato ya está en la entrada (1,1); pickup en (4,1): dRaton=4 (hasta el
  // agujero 0, el más cercano), dGato=0 (ya está ahí) -> a tiempo, EMBOSCADA.
  sink.length = 0;
  const action = act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    events: [{ type: 'pickup', x: 4, y: 1 }],
  }));
  const d = lastD(sink);
  assert(d.md === 'EMBOSCADA', `esperaba EMBOSCADA, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY, salió ${action.move}`);
  assert(action.look === 'E', `esperaba look 'E' (hacia el pickup), salió ${action.look}`);
  assert(d.lk === 'E', `esperaba lk='E', salió ${d.lk}`);
});

// ---------------------------------------------------------------- caso c
caso('c) PERSEGUIR (ratón visible) -> sin look', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 5, y: 1, facing: 'N', stamina: 30 }, mouse: { x: 1, y: 1, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.look === undefined, `no esperaba look en la acción, salió ${action.look}`);
  assert(d.lk === null, `esperaba lk=null, salió ${d.lk}`);
});

// ---------------------------------------------------------------- caso d
caso('d) VIGILAR_QUESO caminando (no STAY) -> sin look', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  // Gato lejos del queso (8,1 vs queso en 3,1): se mueve, no hace STAY.
  sink.length = 0;
  const action = act(catObs({ you: { x: 8, y: 1, facing: 'N', stamina: 30 }, cheese: [[3, 1]] }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba VIGILAR_QUESO, salió ${d.md}`);
  assert(action.move !== 'STAY', `esperaba moverse (no STAY), salió ${action.move}`);
  assert(action.look === undefined, `caminando no esperaba look, salió ${action.look}`);
  assert(d.lk === null, `esperaba lk=null caminando, salió ${d.lk}`);
});

// ---------------------------------------------------------------- caso e
caso('e) sin queso ni persecución, 4 turnos -> look N,E,S,W; el quinto vuelve a N', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  const esperado = ['N', 'E', 'S', 'W', 'N'];
  for (let turno = 1; turno <= 5; turno++) {
    sink.length = 0;
    const action = act(catObs({ turn: turno, you: { x: 5, y: 1, facing: 'N', stamina: 30 }, cheese: [] }));
    const d = lastD(sink);
    assert(d.md === 'VIGILAR_QUESO', `turno ${turno}: esperaba VIGILAR_QUESO (espero), salió ${d.md}`);
    assert(action.move === 'STAY', `turno ${turno}: esperaba STAY, salió ${action.move}`);
    assert(action.look === esperado[turno - 1], `turno ${turno}: esperaba look ${esperado[turno - 1]}, salió ${action.look}`);
    assert(d.lk === esperado[turno - 1], `turno ${turno}: esperaba lk=${esperado[turno - 1]}, salió ${d.lk}`);
  }
});

// ---------------------------------------------------------------- caso f
caso('f) tras delivered/caught, pickupKey queda null y EMBOSCADA no lo reusa', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });

  // Turno 1: igual al caso b) -> EMBOSCADA, look E (hacia el pickup).
  sink.length = 0;
  const a1 = act(catObs({
    turn: 1, you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    events: [{ type: 'pickup', x: 4, y: 1 }],
  }));
  assert(lastD(sink).md === 'EMBOSCADA' && a1.look === 'E', 'turno 1: setup del caso b no se cumplió');

  // Turno 2: delivered -> se borra persecucionQueso y pickupKey. Sin queso
  // en el piso ni rastro, cae al "espero" (D3): NO debe seguir mirando
  // hacia el viejo pickup (E); debe usar el giro, que en su primer uso da N.
  sink.length = 0;
  const a2 = act(catObs({
    turn: 2, you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [], events: [{ type: 'delivered', hole: 0 }],
  }));
  const d2 = lastD(sink);
  assert(d2.md === 'VIGILAR_QUESO', `turno 2: esperaba VIGILAR_QUESO (ya no EMBOSCADA), salió ${d2.md}`);
  assert(a2.look === 'N', `turno 2: esperaba look 'N' (giro, no el pickup viejo), salió ${a2.look}`);
});

// ---------------------------------------------------------------- caso g
caso('g) VIGILAR_QUESO con el gato ya en la entrada (distancia 0) -> usa el giro (look N)', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  // Queso justo en la entrada (1,1), con el gato ahí mismo: el agujero más
  // cercano al queso es el 0 (dist 1, entrada=1,1) y esa entrada es la
  // propia casilla del gato -> distancia 0 -> regla D3.
  sink.length = 0;
  const action = act(catObs({ you: { x: 1, y: 1, facing: 'N', stamina: 30 }, cheese: [[1, 1]] }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba VIGILAR_QUESO, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY (ya está sobre el queso), salió ${action.move}`);
  assert(action.look === 'N', `esperaba look 'N' (primer giro), salió ${action.look}`);
});

// ---------------------------------------------------------------- caso h
caso('h) el caso a) FALLA contra v5 (bot_v5.js, sin look)', () => {
  const { createBot, sink } = loadBot('bot_v5.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 3, y: 1, facing: 'N', stamina: 30 }, cheese: [[3, 1]] }));
  assert(action.move === 'STAY', 'v5 también debería hacer STAY sobre el queso (si no, el setup cambió)');

  // Repite LITERALMENTE la aserción del caso a) contra v5: tiene que tirar,
  // porque v5 no emite look. Si no tira, el caso a) no prueba nada nuevo.
  let tiro = false;
  try {
    assert(action.look === 'W', `esperaba look 'W', salió ${action.look}`);
  } catch (e) {
    tiro = true;
  }
  assert(tiro, 'el caso a) debía fallar contra v5 (sin look) y no falló: no distingue v5 de v6');
});

console.log('');
console.log(fallas === 0 ? `OK: los ${total} casos pasaron.` : `FALLÓ: ${fallas} de ${total} casos.`);
process.exit(fallas === 0 ? 0 : 1);
