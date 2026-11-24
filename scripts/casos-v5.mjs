// casos-v5.mjs — casos de prueba a mano para v5 (SOLTAR + memoria del ratón,
// EMBOSCADA a tiempo + sin vaivén por olor del gato).
// Uso: node scripts/casos-v5.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs y casos-v3.mjs, y corre
// escenarios chicos hechos a mano donde se puede predecir el resultado
// esperado sin ambigüedad (sin empates de BFS).

import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('bot.js', 'utf8');

const RULES = {
  maxTurns: 400, catchPoints: 3, cheesePoints: 3, hidingTaxEvery: 15,
  botTimeMs: 50, gameTimeMs: 5000, initTimeMs: 500, debugMaxChars: 200, debugMaxTiles: 400,
};

const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], STAY: [0, 0] };

function loadBot() {
  const sink = [];
  const sandbox = { console: { log: (s) => sink.push(s) }, Math };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__createBot = createBot;', sandbox, { timeout: 2000 });
  return { createBot: sandbox.__createBot, sink };
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

// ----------------------------------------------------------- mapa (ratón)
// Pasillo de una sola fila con UN agujero en la punta oeste: cualquier ruta
// al agujero tiene que pasar por el mismo tramo, así que la zona de peligro
// del gato (radio 2) corta la única ruta sin importar la distancia exacta
// (mientras el gato esté entre el ratón y el agujero). Esto aísla el umbral
// de cd (3 vs 2) del resto de la geometría.
function corridorUnHoyo() {
  return {
    width: 12,
    height: 3,
    rows: [
      '#H##########',
      '#..........#',
      '############',
    ],
    holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }],
  };
}

// ----------------------------------------------------------- mapa (gato)
// Mismo pasillo de dos agujeros que casos-v3.mjs, para los casos de EMBOSCADA.
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

// ---------------------------------------------------------------- caso a
caso('a) ratón con queso, sin ruta segura, gato a cd=3 -> SOLTAR (drop:true)', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorUnHoyo(), rules: RULES });
  sink.length = 0;
  // Ratón en (9,1) con el único agujero al oeste. Gato en (6,1): su zona de
  // peligro (radio 2) cubre x=4..8, cortando el único camino al agujero.
  const action = act(mouseObs({
    you: { x: 9, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: { x: 6, y: 1, facing: 'W', stamina: 20 },
  }));
  const d = lastD(sink);
  assert(d.cd === 3, `esperaba cd=3, salió ${d.cd}`);
  assert(d.md === 'SOLTAR', `esperaba md SOLTAR, salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY, salió ${action.move}`);
  assert(action.drop === true, `esperaba drop:true en la acción, salió ${JSON.stringify(action)}`);
});

// ---------------------------------------------------------------- caso b
caso('b) igual, pero gato a cd=2 -> ALEJARSE, sin drop', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorUnHoyo(), rules: RULES });
  sink.length = 0;
  // Mismo ratón en (9,1); gato en (7,1) -> cd=2, zona de peligro x=5..9.
  const action = act(mouseObs({
    you: { x: 9, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: { x: 7, y: 1, facing: 'W', stamina: 20 },
  }));
  const d = lastD(sink);
  assert(d.cd === 2, `esperaba cd=2, salió ${d.cd}`);
  assert(d.md === 'ALEJARSE', `esperaba md ALEJARSE, salió ${d.md}`);
  assert(!action.drop, `no esperaba drop, salió ${JSON.stringify(action)}`);
});

// ---------------------------------------------------------------- caso c
caso('c) mapa real contra Agustin: al perder de vista al gato no vuelve a (1,6) (sin vaivén N,S,N,S)', () => {
  const map = {
    width: 19,
    height: 13,
    rows: [
      '##H############H###',
      '#......#...TT.#...#',
      '#......#......#...#',
      '#.................#',
      '#.................#',
      '##..####..##..#...#',
      '#......#.T......TT#',
      '#........T....#...#',
      '#.............##..#',
      '#......#.....TT...#',
      '#.T....#......#...#',
      '#.T....#..........#',
      '#H###############H#',
    ],
    holes: [
      { x: 2, y: 0, entrance: { x: 2, y: 1 } },
      { x: 17, y: 12, entrance: { x: 17, y: 11 } },
      { x: 1, y: 12, entrance: { x: 1, y: 11 } },
      { x: 15, y: 0, entrance: { x: 15, y: 1 } },
    ],
  };
  const cheese = [[7, 8], [8, 3], [5, 4], [12, 7]];

  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map, rules: RULES });

  let pos = { x: 1, y: 6 };
  const posiciones = [{ ...pos }];
  const movimientos = [];
  for (let turn = 1; turn <= 6; turn++) {
    const veGato = turn % 2 === 1; // alterna ver / no ver, como pide el caso
    sink.length = 0;
    const action = act(mouseObs({
      turn,
      you: { x: pos.x, y: pos.y, carrying: false, inHole: null, tunneling: null, heavy: false },
      cat: veGato ? { x: 5, y: 3, facing: 'S', stamina: 20 } : null,
      cheese,
    }));
    const d = lastD(sink);
    movimientos.push(action.move);
    if (turn === 1) {
      assert(action.move === 'S', `turno 1: esperaba moverse al Sur hacia (1,7), salió ${action.move} (debug: ${d.tg})`);
    }
    const [dx, dy] = DELTA[action.move] || [0, 0];
    pos = { x: pos.x + dx, y: pos.y + dy };
    posiciones.push({ ...pos });
  }

  const vueltaA16 = posiciones.slice(1).some((p) => p.x === 1 && p.y === 6);
  assert(!vueltaA16, `el ratón volvió a (1,6) en 6 turnos: ${JSON.stringify(posiciones)} (movs ${movimientos.join(',')})`);

  let rebote = false;
  for (let i = 0; i + 3 < movimientos.length; i++) {
    if (movimientos[i] === movimientos[i + 2] && movimientos[i] !== movimientos[i + 1]
      && movimientos[i + 1] === movimientos[i + 3]) rebote = true;
  }
  assert(!rebote, `se repitió un patrón de vaivén (N,S,N,S) en los movimientos: ${movimientos.join(',')}`);
});

// ---------------------------------------------------------------- caso d
caso('d) gato: pickup lejos (no llega antes) -> sigue en VIGILAR_QUESO', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });

  // Gato en (2,1), pegado a la entrada del agujero 0. El pickup ocurrió en
  // (9,1), la entrada del agujero 1: dRaton=1 (pickup ya está en la entrada),
  // dGato=7 (todo el pasillo). 7 > 1: llega tarde, no vale la pena embocar.
  sink.length = 0;
  const action = act(catObs({
    you: { x: 2, y: 1, facing: 'N', stamina: 30 },
    cheese: [],
    events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba md VIGILAR_QUESO, salió ${d.md}`);
  assert(action.move === 'STAY', `sin queso en el piso ni persecución, esperaba STAY, salió ${action.move}`);
});

// ---------------------------------------------------------------- caso e
caso('e) gato: pickup cerca (llega antes) -> EMBOSCADA hacia esa entrada', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });

  // Gato en (8,1), a 1 casilla de la entrada (9,1), igual que dRaton=1:
  // llega a tiempo, así que pasa a EMBOSCADA.
  sink.length = 0;
  const action = act(catObs({
    you: { x: 8, y: 1, facing: 'E', stamina: 30 },
    cheese: [],
    events: [{ type: 'pickup', x: 9, y: 1 }],
  }));
  const d = lastD(sink);
  assert(d.md === 'EMBOSCADA', `esperaba md EMBOSCADA, salió ${d.md}`);
  assert(d.tg === '9,1', `esperaba apuntar a la entrada (9,1), salió tg=${d.tg}`);
  assert(action.move === 'E', `esperaba moverse al Este hacia la entrada, salió ${action.move}`);
});

// ---------------------------------------------------------------- caso f
caso('f) gato: dos casillas de olor donde ya estuvo -> no vuelve, pasa a VIGILAR_QUESO', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorDosHoyos(), rules: RULES });

  // Turno 1 y 2: el gato pisa A=(3,1) y B=(7,1) (sin rastro ni queso, solo
  // para que queden en su historial de posiciones).
  act(catObs({ you: { x: 3, y: 1, facing: 'N', stamina: 30 }, cheese: [] }));
  act(catObs({ you: { x: 7, y: 1, facing: 'N', stamina: 30 }, cheese: [] }));

  // Turno 3: huele A y B, las dos casillas donde ya estuvo. Sin ellas no
  // queda olor válido, así que no hace STAY esperando: pasa a VIGILAR_QUESO.
  sink.length = 0;
  const action = act(catObs({
    you: { x: 5, y: 1, facing: 'N', stamina: 30 },
    cheese: [],
    scent: [[3, 1, 0.5], [7, 1, 0.5]],
  }));
  const d = lastD(sink);
  assert(d.md === 'VIGILAR_QUESO', `esperaba md VIGILAR_QUESO (no SEGUIR_OLOR ni STAY por olor viejo), salió ${d.md}`);
  assert(action.move === 'STAY', `sin queso en el piso, esperaba STAY, salió ${action.move}`);
});

// ---------------------------------------------------------------- caso g
caso('g) después de SOLTAR, con el gato recordado, el queso soltado no es objetivo (qs=1, nunca STAY)', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorUnHoyo(), rules: RULES });

  // Turno 1: mismo arranque que el caso a) -> SOLTAR en (9,1), gato visto en
  // (6,1) (cd=3). El queso soltado queda en memory.quesoSoltado = "9,1".
  sink.length = 0;
  const a1 = act(mouseObs({
    turn: 1,
    you: { x: 9, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: { x: 6, y: 1, facing: 'W', stamina: 20 },
  }));
  assert(lastD(sink).md === 'SOLTAR', 'turno 1: esperaba SOLTAR (setup del caso a)');
  assert(a1.move === 'STAY' && a1.drop === true, 'turno 1: esperaba STAY con drop:true');

  // Turno 2: ya sin queso encima, el queso soltado sigue en su casilla
  // (9,1); el gato no se ve pero se vio hace 1 turno (recordado, gm=1).
  // El único queso candidato es el soltado: no debe convertirse en objetivo
  // (ignoraSoltado), así que el modo cae a la cadena de siempre (agujero o
  // ALEJARSE) y nunca hace STAY sobre él.
  sink.length = 0;
  const a2 = act(mouseObs({
    turn: 2,
    you: { x: 9, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null,
    cheese: [[9, 1]],
  }));
  const d2 = lastD(sink);
  assert(d2.gm === 1, `turno 2: esperaba gm=1 (gato recordado), salió ${d2.gm}`);
  assert(d2.qs === 1, `turno 2: esperaba qs=1 (queso soltado ignorado), salió ${d2.qs}`);
  assert(d2.md !== 'IR_AL_QUESO', `turno 2: no esperaba IR_AL_QUESO hacia el queso soltado, salió ${d2.md}`);
  assert(a2.move !== 'STAY', `turno 2: nunca STAY sobre el queso soltado, salió ${a2.move}`);

  // Turno 3: el ratón quedó al lado del queso soltado (se movió con a2) y el
  // gato sigue recordado (2 turnos, dentro de MEMORIA_GATO). No debe volver
  // a la casilla del queso soltado (9,1).
  const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const [dx, dy] = DELTA[a2.move];
  const pos3 = { x: 9 + dx, y: 1 + dy };
  sink.length = 0;
  const a3 = act(mouseObs({
    turn: 3,
    you: { x: pos3.x, y: pos3.y, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null,
    cheese: [[9, 1]],
  }));
  const d3 = lastD(sink);
  assert(d3.gm === 1, `turno 3: esperaba gm=1 (gato recordado), salió ${d3.gm}`);
  const [dx3, dy3] = DELTA[a3.move] || [0, 0];
  const pos4 = { x: pos3.x + dx3, y: pos3.y + dy3 };
  assert(!(pos4.x === 9 && pos4.y === 1), `turno 3: no debía volver a la casilla del queso soltado (9,1), salió move=${a3.move} desde ${JSON.stringify(pos3)}`);
});

// ---------------------------------------------------------------- caso h
caso('h) gato visto hace más de MEMORIA_GATO turnos -> el queso soltado vuelve a ser objetivo (qs=0)', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorUnHoyo(), rules: RULES });

  // Mismo arranque que el caso g): SOLTAR en el turno 1 con el gato visto.
  act(mouseObs({
    turn: 1,
    you: { x: 9, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: { x: 6, y: 1, facing: 'W', stamina: 20 },
  }));

  // Turno 13: pasaron más de MEMORIA_GATO (10) turnos sin ver al gato. Ya no
  // hay gato efectivo, así que memory.quesoSoltado se borra y el queso
  // vuelve a ser un candidato normal: IR_AL_QUESO, qs=0.
  sink.length = 0;
  const action = act(mouseObs({
    turn: 13,
    you: { x: 9, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null,
    cheese: [[9, 1]],
  }));
  const d = lastD(sink);
  assert(d.gm === null, `esperaba gm=null (ya no hay gato efectivo), salió ${d.gm}`);
  assert(d.md === 'IR_AL_QUESO', `esperaba volver a IR_AL_QUESO, salió ${d.md}`);
  assert(d.qs === 0, `esperaba qs=0 (ya no se ignora nada), salió ${d.qs}`);
  assert(action.move === 'STAY', `ya está sobre el queso (sin gato), esperaba STAY, salió ${action.move}`);
});

console.log('');
console.log(fallas === 0 ? `OK: los ${total} casos pasaron.` : `FALLÓ: ${fallas} de ${total} casos.`);
process.exit(fallas === 0 ? 0 : 1);
