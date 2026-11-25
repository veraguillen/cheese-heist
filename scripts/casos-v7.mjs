// casos-v7.mjs — casos de prueba a mano para v7 (sprint para rematar).
// Uso: node scripts/casos-v7.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs y casos-v6.mjs, y corre
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

function mouseObs(over) {
  return Object.assign({
    turn: 1, maxTurns: 400, role: 'mouse', score: { cat: 0, mouse: 0 },
    you: { x: 0, y: 0, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null, bell: null, bellLoud: false,
    visible: [], cheese: [],
    events: [],
  }, over);
}

function lastD(sink) {
  const linea = sink.filter((l) => l.startsWith('D|')).pop();
  return linea ? JSON.parse(linea.slice(2)) : null;
}

// Sala abierta sin agujeros: piso de (1,1) a (5,3). Sirve para las pruebas
// de sprint, que solo necesitan línea recta y piso/pared alrededor; no usan
// agujeros (la rama PERSEGUIR no los toca).
function salaAbierta() {
  return {
    width: 7,
    height: 5,
    rows: [
      '#######',
      '#.....#',
      '#.....#',
      '#.....#',
      '#######',
    ],
    holes: [],
  };
}

// Pasillo de dos agujeros, igual al de casos-v5/v6.mjs: para los casos que
// sí necesitan SEGUIR_OLOR o EMBOSCADA (no tocados por v7).
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

// Dos agujeros cercanos (entradas a 2 casillas una de otra): sirve para
// bloquear las DOS entradas con una sola zona de peligro (radio 2).
function corridorDosHoyosCercanos() {
  return {
    width: 7,
    height: 3,
    rows: [
      '#H#H###',
      '#.....#',
      '#######',
    ],
    holes: [
      { x: 1, y: 0, entrance: { x: 1, y: 1 } },
      { x: 3, y: 0, entrance: { x: 3, y: 1 } },
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
caso("a) d=1 en línea recta, camino libre -> sprint, sp=1, move hacia el ratón", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  // Gato (2,2), ratón (3,2): misma fila, d=1, y (4,2) es piso -> sprint.
  sink.length = 0;
  const action = act(catObs({ you: { x: 2, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.move === 'E', `esperaba move 'E', salió ${action.move}`);
  assert(action.sprint === true, `esperaba sprint:true, salió ${action.sprint}`);
  assert(d.sp === 1, `esperaba sp=1 en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso b
caso("b) d=1 en línea recta, pero la casilla siguiente a la del ratón es pared -> sin sprint", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  // Gato (4,2), ratón (5,2): d=1, pero (6,2) es pared -> no conviene sprint
  // (caminando igual lo alcanza el turno que viene, contra la pared).
  sink.length = 0;
  const action = act(catObs({ you: { x: 4, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 5, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.move === 'E', `esperaba move 'E' (BFS normal), salió ${action.move}`);
  assert(action.sprint === undefined, `no esperaba sprint, salió ${action.sprint}`);
  assert(!('sp' in d), `no esperaba la clave sp en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso c
caso("c) d=2 en línea recta, ratón con queso y casilla del medio libre -> sprint, sp=2", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  // Gato (1,2), ratón (3,2) cargando queso: d=2, medio (2,2) es piso.
  sink.length = 0;
  const action = act(catObs({ you: { x: 1, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: true } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.move === 'E', `esperaba move 'E', salió ${action.move}`);
  assert(action.sprint === true, `esperaba sprint:true, salió ${action.sprint}`);
  assert(d.sp === 2, `esperaba sp=2 en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso d
caso("d) igual que c) pero sin queso -> sin sprint", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 1, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.sprint === undefined, `no esperaba sprint (sin queso), salió ${action.sprint}`);
  assert(!('sp' in d), `no esperaba la clave sp en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso e
caso("e) ratón visible pero fuera de línea recta (diagonal) -> sin sprint", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  // Gato (2,1), ratón (3,2): dx=1, dy=1, ninguno es 0 -> no está en línea recta.
  sink.length = 0;
  const action = act(catObs({ you: { x: 2, y: 1, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: true } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.sprint === undefined, `no esperaba sprint (diagonal), salió ${action.sprint}`);
  assert(!('sp' in d), `no esperaba la clave sp en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso f
caso("f) ratón visible en línea recta a distancia 3 -> sin sprint", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  // Gato (1,2), ratón (4,2): misma fila, d=3.
  sink.length = 0;
  const action = act(catObs({ you: { x: 1, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 4, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(d.md === 'PERSEGUIR', `esperaba PERSEGUIR, salió ${d.md}`);
  assert(action.sprint === undefined, `no esperaba sprint (d=3), salió ${action.sprint}`);
  assert(!('sp' in d), `no esperaba la clave sp en el registro, salió ${d.sp}`);
});

// ---------------------------------------------------------------- caso g
caso("g) sin sprint: la clave sp no existe en el registro (no es null, falta)", () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  sink.length = 0;
  act(catObs({ you: { x: 4, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 5, y: 2, carrying: false } }));
  const d = lastD(sink);
  assert(Object.prototype.hasOwnProperty.call(d, 'sp') === false, `esperaba que 'sp' no sea una clave propia, pero está: ${JSON.stringify(d)}`);
});

// ---------------------------------------------------------------- caso h
caso('h) SEGUIR_OLOR y EMBOSCADA no cambian (sin ratón visible)', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });

  // SEGUIR_OLOR: sin ratón visible, con rastro de olor.
  sink.length = 0;
  const a1 = act(catObs({ you: { x: 5, y: 1, facing: 'N', stamina: 30 }, scent: [[6, 1, 0.5]] }));
  const d1 = lastD(sink);
  assert(d1.md === 'SEGUIR_OLOR', `esperaba SEGUIR_OLOR, salió ${d1.md}`);
  assert(a1.sprint === undefined, `SEGUIR_OLOR no debería pedir sprint, salió ${a1.sprint}`);
  assert(!('sp' in d1), 'SEGUIR_OLOR no debería tener la clave sp');

  // EMBOSCADA: quieto en la entrada, pickup por el pasillo (igual al caso b
  // de casos-v6.mjs).
  sink.length = 0;
  const a2 = act(catObs({
    turn: 2, you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    events: [{ type: 'pickup', x: 4, y: 1 }],
  }));
  const d2 = lastD(sink);
  assert(d2.md === 'EMBOSCADA', `esperaba EMBOSCADA, salió ${d2.md}`);
  assert(a2.sprint === undefined, `EMBOSCADA no debería pedir sprint, salió ${a2.sprint}`);
  assert(!('sp' in d2), 'EMBOSCADA no debería tener la clave sp');
});

// ---------------------------------------------------------------- caso i
caso("i) el caso a) FALLA contra v6 (bot_v6.js, sin sprint)", () => {
  const { createBot, sink } = loadBot('bot_v6.js');
  const act = createBot({ role: 'cat', map: salaAbierta(), rules: RULES });
  sink.length = 0;
  const action = act(catObs({ you: { x: 2, y: 2, facing: 'N', stamina: 30 }, mouse: { x: 3, y: 2, carrying: false } }));
  assert(action.move === 'E', 'v6 también debería moverse hacia el E (si no, el setup cambió)');

  // Repite LITERALMENTE la aserción del caso a) contra v6: tiene que tirar,
  // porque v6 no pide sprint. Si no tira, el caso a) no prueba nada nuevo.
  let tiro = false;
  try {
    assert(action.sprint === true, `esperaba sprint:true, salió ${action.sprint}`);
  } catch (e) {
    tiro = true;
  }
  assert(tiro, 'el caso a) debía fallar contra v6 (sin sprint) y no falló: no distingue v6 de v7');
});

// ---------------------------------------------------------------- caso j
caso('j) atrapado en el agujero 0 (gato en su entrada), queso con ruta segura desde el 1 -> tunnel:1, CAMBIAR_AGUJERO', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: corridorDosHoyos(), rules: RULES });
  // Gato en la entrada 0 (1,1): zona de peligro {1,1; 2,1; 3,1}. Queso en
  // (7,1), fuera de la zona -> desde el agujero 0 no hay ruta segura
  // (hay que salir por (1,1), bloqueada); desde el 1, sí (entrada en 9,1).
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 1, y: 1, facing: 'S', stamina: 30 },
    cheese: [[7, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'CAMBIAR_AGUJERO', `esperaba CAMBIAR_AGUJERO, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba move STAY, salió ${action.move}`);
  assert(action.tunnel === 1, `esperaba tunnel:1, salió ${action.tunnel}`);
});

// ---------------------------------------------------------------- caso k
caso('k) las dos entradas en peligro -> ESCONDIDO, sin tunnel', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: corridorDosHoyosCercanos(), rules: RULES });
  // Gato en (2,1), entre las dos entradas (1,1) y (3,1): con radio 2 la
  // zona de peligro {1,1; 2,1; 3,1; 4,1} cubre las dos. Queso en (5,1), el
  // único piso que queda fuera de la zona, pero ninguna de las dos
  // entradas tiene ruta segura hasta ahí.
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 2, y: 1, facing: 'N', stamina: 30 },
    cheese: [[5, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'ESCONDIDO', `esperaba ESCONDIDO, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba move STAY, salió ${action.move}`);
  assert(action.tunnel === undefined, `no esperaba tunnel, salió ${action.tunnel}`);
});

// ---------------------------------------------------------------- caso l
caso('l) sin gato efectivo -> sale normal por su entrada (IR_AL_QUESO), sin tunnel', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: corridorDosHoyos(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: null,
    cheese: [[7, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'IR_AL_QUESO', `esperaba IR_AL_QUESO, salió ${d.md}`);
  assert(action.move === 'S', `esperaba move 'S' (saliendo por la entrada), salió ${action.move}`);
  assert(action.tunnel === undefined, `no esperaba tunnel, salió ${action.tunnel}`);
});

// ---------------------------------------------------------------- caso m
caso('m) sin vaivén: no vuelve al agujero de origen del último túnel dentro de los 10 turnos', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: corridorDosHoyos(), rules: RULES });

  // Turno 1: igual al caso j) -> tunela del agujero 0 al 1.
  sink.length = 0;
  const a1 = act(mouseObs({
    turn: 1,
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 1, y: 1, facing: 'S', stamina: 30 },
    cheese: [[7, 1]],
  }));
  assert(lastD(sink).md === 'CAMBIAR_AGUJERO' && a1.tunnel === 1, 'turno 1: setup del caso j no se cumplió');

  // Turno 5 (dentro de los 10): ya llegó al agujero 1 y ahora SU entrada
  // está en peligro; la entrada 0 está libre y sí tendría ruta segura al
  // queso -- pero es el origen del túnel anterior, así que no se usa.
  sink.length = 0;
  const a2 = act(mouseObs({
    turn: 5,
    you: { x: 9, y: 0, carrying: false, inHole: 1, tunneling: null, heavy: false },
    cat: { x: 9, y: 1, facing: 'W', stamina: 30 },
    cheese: [[4, 1]],
  }));
  const d2 = lastD(sink);
  assert(d2.md === 'ESCONDIDO', `turno 5: esperaba ESCONDIDO (0 excluido por sin vaivén), salió ${d2.md}`);
  assert(a2.tunnel === undefined, `turno 5: no esperaba tunnel, salió ${a2.tunnel}`);
});

// ---------------------------------------------------------------- caso n
caso('n) el caso j) FALLA contra v6 (bot_v6.js, sin CAMBIAR_AGUJERO)', () => {
  const { createBot, sink } = loadBot('bot_v6.js');
  const act = createBot({ role: 'mouse', map: corridorDosHoyos(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 1, y: 1, facing: 'S', stamina: 30 },
    cheese: [[7, 1]],
  }));
  assert(action.move === 'STAY', 'v6 también debería hacer STAY (si no, el setup cambió)');

  // Repite LITERALMENTE la aserción del caso j) contra v6: tiene que
  // tirar, porque v6 no tunela. Si no tira, el caso j) no prueba nada
  // nuevo.
  let tiro = false;
  try {
    assert(action.tunnel === 1, `esperaba tunnel:1, salió ${action.tunnel}`);
  } catch (e) {
    tiro = true;
  }
  assert(tiro, 'el caso j) debía fallar contra v6 (sin tunnel) y no falló: no distingue v6 de v7');
});

console.log('');
console.log(fallas === 0 ? `OK: los ${total} casos pasaron.` : `FALLÓ: ${fallas} de ${total} casos.`);
process.exit(fallas === 0 ? 0 : 1);
