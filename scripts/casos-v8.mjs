// casos-v8.mjs — casos de prueba a mano para v8 (ronda entre quesos).
// Uso: node scripts/casos-v8.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs y casos-v7.mjs, y corre
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

// Sala con un agujero en la pared oeste (entrada en (1,2)), piso de (1,1) a
// (7,3): sirve para los quesos de RONDA y para que elegirLook tenga a dónde
// mirar. Fila y=2 alcanza para que las distancias entre quesos no empaten.
function salaConHoyo() {
  return {
    width: 9,
    height: 5,
    rows: [
      '#########',
      '#.......#',
      'H.......#',
      '#.......#',
      '#########',
    ],
    holes: [{ x: 0, y: 2, entrance: { x: 1, y: 2 } }],
  };
}

// Pasillo de dos agujeros, igual al de casos-v5/v6/v7.mjs: para EMBOSCADA y
// PERSEGUIR+sprint, que no cambian en v8.
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
caso('a) 2 quesos sin visitar, A más cerca -> va hacia A, md RONDA', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  // Gato en (3,2): A=(2,2) a distancia 1, B=(5,2) a distancia 2.
  sink.length = 0;
  const action = act(catObs({ you: { x: 3, y: 2, facing: 'N', stamina: 30 }, cheese: [[2, 2], [5, 2]] }));
  const d = lastD(sink);
  assert(d.md === 'RONDA', `esperaba RONDA, salió ${d.md}`);
  assert(action.move === 'W', `esperaba move 'W' (hacia A), salió ${action.move}`);
  assert(d.tg === '2,2', `esperaba tg='2,2' (A), salió ${d.tg}`);
});

// ---------------------------------------------------------------- caso b
caso('b) llega a A -> STAY con look; el turno siguiente se mueve hacia B', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  const obsBase = { you: { x: 2, y: 2, facing: 'N', stamina: 30 }, cheese: [[2, 2], [5, 2]] };

  // Turno 1: ya está sobre A -> STAY, registra la visita, look hacia la
  // entrada (1,2), al W.
  sink.length = 0;
  const a1 = act(catObs(obsBase));
  const d1 = lastD(sink);
  assert(d1.md === 'RONDA', `turno 1: esperaba RONDA, salió ${d1.md}`);
  assert(a1.move === 'STAY', `turno 1: esperaba STAY, salió ${a1.move}`);
  assert(a1.look === 'W', `turno 1: esperaba look 'W' (hacia la entrada), salió ${a1.look}`);
  assert(d1.tg === '2,2', `turno 1: esperaba tg='2,2', salió ${d1.tg}`);

  // Turno 2: misma posición (no se movió), A ya visitado -> ahora va a B.
  sink.length = 0;
  const a2 = act(catObs({ ...obsBase, turn: 2 }));
  const d2 = lastD(sink);
  assert(d2.md === 'RONDA', `turno 2: esperaba RONDA, salió ${d2.md}`);
  assert(a2.move === 'E', `turno 2: esperaba move 'E' (hacia B), salió ${a2.move}`);
  assert(d2.tg === '5,2', `turno 2: esperaba tg='5,2' (B), salió ${d2.tg}`);
});

// ---------------------------------------------------------------- caso c
caso('c) yendo hacia B, A queda más cerca pero sigue hacia B (compromiso)', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  const cheese = [[2, 2], [5, 2]]; // A, B

  // Turno 1: gato en (4,2): A a distancia 2, B a distancia 1 -> elige B.
  sink.length = 0;
  const a1 = act(catObs({ you: { x: 4, y: 2, facing: 'N', stamina: 30 }, cheese }));
  assert(lastD(sink).tg === '5,2', 'turno 1: esperaba que elija B (más cerca)');
  assert(a1.move === 'E', 'turno 1: esperaba moverse al E hacia B');

  // Turno 2: ahora en (3,2): A queda a distancia 1 (más cerca), B a
  // distancia 2 -- pero el compromiso dice que sigue yendo a B.
  sink.length = 0;
  const a2 = act(catObs({ turn: 2, you: { x: 3, y: 2, facing: 'N', stamina: 30 }, cheese }));
  const d2 = lastD(sink);
  assert(d2.md === 'RONDA', `turno 2: esperaba RONDA, salió ${d2.md}`);
  assert(d2.tg === '5,2', `turno 2: esperaba seguir con B (compromiso), salió tg=${d2.tg}`);
  assert(a2.move === 'E', `turno 2: esperaba seguir al E hacia B, salió ${a2.move}`);
});

// ---------------------------------------------------------------- caso d
caso('d) B desaparece yendo hacia él -> elige otro queso (de los que quedan)', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  // A=(2,2) dist 2, B=(5,2) dist 1, C=(7,2) dist 3, desde (4,2) -> elige B.
  sink.length = 0;
  const a1 = act(catObs({ you: { x: 4, y: 2, facing: 'N', stamina: 30 }, cheese: [[2, 2], [5, 2], [7, 2]] }));
  assert(lastD(sink).tg === '5,2', 'turno 1: esperaba elegir B');
  assert(a1.move === 'E', 'turno 1: esperaba moverse al E hacia B');

  // Turno 2: B desaparece (lo levantó el ratón). Quedan A (dist 2) y C
  // (dist 3) -- ninguno visitado -> elige A, el más cercano.
  sink.length = 0;
  const a2 = act(catObs({ turn: 2, you: { x: 4, y: 2, facing: 'N', stamina: 30 }, cheese: [[2, 2], [7, 2]] }));
  const d2 = lastD(sink);
  assert(d2.md === 'RONDA', `turno 2: esperaba RONDA, salió ${d2.md}`);
  assert(d2.tg === '2,2', `turno 2: esperaba elegir A (el más cercano de los que quedan), salió tg=${d2.tg}`);
  assert(a2.move === 'W', `turno 2: esperaba moverse al W hacia A, salió ${a2.move}`);
});

// ---------------------------------------------------------------- caso e
caso('e) 1 solo queso -> VIGILAR_QUESO y STAY sobre él, igual que v7', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 3, y: 2, facing: 'N', stamina: 30 }, cheese: [[3, 2]] }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba VIGILAR_QUESO, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY (ya está sobre el único queso), salió ${action.move}`);
});

// ---------------------------------------------------------------- caso f
caso('f) EMBOSCADA activa (pickup a tiempo) -> igual que v7', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });
  // Igual al caso b de casos-v6/v7.mjs: gato en la entrada 0, pickup al E.
  sink.length = 0;
  const action = act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    events: [{ type: 'pickup', x: 4, y: 1 }],
  }));
  const d = lastD(sink);
  assert(d.md === 'EMBOSCADA', `esperaba EMBOSCADA, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY, salió ${action.move}`);
  assert(action.look === 'E', `esperaba look 'E' (hacia el pickup), salió ${action.look}`);
});

// ---------------------------------------------------------------- caso g
caso('g) ratón visible a 1 en línea recta -> PERSEGUIR con sprint, igual que v7', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 2, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.move === 'E', `esperaba move 'E', salió ${action.move}`);
  assert(action.sprint === true, `esperaba sprint:true, salió ${action.sprint}`);
  assert(d.sp === 1, `esperaba sp=1, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso h
caso('h) el caso b) (turno 2, moverse a B) FALLA contra v7 (bot_v7.js, sin RONDA)', () => {
  const { createBot, sink } = loadBot('bot_v7.js');
  const act = createBot({ role: 'cat', map: salaConHoyo(), rules: RULES });
  const obsBase = { you: { x: 2, y: 2, facing: 'N', stamina: 30 }, cheese: [[2, 2], [5, 2]] };

  sink.length = 0;
  act(catObs(obsBase)); // turno 1: en v7 esto es VIGILAR_QUESO, STAY sobre el queso más cercano (A).
  sink.length = 0;
  const a2 = act(catObs({ ...obsBase, turn: 2 }));
  assert(a2.move === 'STAY', 'v7 también debería seguir en STAY sobre A (sin RONDA); si no, el setup cambió');

  // Repite LITERALMENTE la aserción del caso b) (turno 2) contra v7: tiene
  // que tirar, porque v7 no tiene memoria de ronda y se queda en A.
  let tiro = false;
  try {
    assert(a2.move === 'E', `esperaba move 'E' (hacia B), salió ${a2.move}`);
  } catch (e) {
    tiro = true;
  }
  assert(tiro, 'el caso b) debía fallar contra v7 (sin RONDA) y no falló: no distingue v7 de v8');
});

console.log('');
console.log(fallas === 0 ? `OK: los ${total} casos pasaron.` : `FALLÓ: ${fallas} de ${total} casos.`);
process.exit(fallas === 0 ? 0 : 1);
