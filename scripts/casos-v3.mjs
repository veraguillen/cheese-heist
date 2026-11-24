// casos-v3.mjs — casos de prueba a mano para v3 (R2 del ratón, G2 del gato).
// Uso: node scripts/casos-v3.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs, y corre escenarios chicos
// hechos a mano donde se puede predecir el resultado esperado sin ambigüedad
// (sin empates de BFS). Cada caso imprime OK o FALLA con el motivo.

import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('bot.js', 'utf8');

const RULES = {
  maxTurns: 400, catchPoints: 3, cheesePoints: 3, hidingTaxEvery: 15,
  botTimeMs: 50, gameTimeMs: 5000, initTimeMs: 500, debugMaxChars: 200, debugMaxTiles: 400,
};

function loadBot() {
  const sink = [];
  const sandbox = { console: { log: (s) => sink.push(s) }, Math };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__createBot = createBot;', sandbox, { timeout: 2000 });
  return { createBot: sandbox.__createBot, sink };
}

// Mapa chico compartido: pasillo de UNA sola fila con un agujero en cada
// punta, para que la ruta más corta sea siempre única (si hubiera más de
// una fila transitable, ir derecho por la fila de las entradas y "subir y
// cruzar" por la fila de abajo miden lo mismo, y el desempate N/S/E/W elige
// N antes que E/W -- se verificó a mano antes de simplificar el mapa).
function corridorMap() {
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

function mouseObs(over) {
  return Object.assign({
    turn: 1, maxTurns: 400, role: 'mouse', score: { cat: 0, mouse: 0 },
    you: { x: 5, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: null, bell: null, bellLoud: false,
    visible: [], cheese: [],
    events: [],
  }, over);
}

function catObs(over) {
  return Object.assign({
    turn: 1, maxTurns: 400, role: 'cat', score: { cat: 0, mouse: 0 },
    you: { x: 2, y: 1, facing: 'N', stamina: 30 },
    mouse: null, visible: [], scent: [], cheese: [],
    events: [],
  }, over);
}

function lastD(sink) {
  const linea = sink.filter((l) => l.startsWith('D|')).pop();
  return linea ? JSON.parse(linea.slice(2)) : null;
}

let fallas = 0;
function caso(nombre, fn) {
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
caso('a) ratón con queso, gato cerca del agujero más cercano -> va al otro (mg>0)', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorMap(), rules: RULES });
  sink.length = 0;
  // Ratón en (5,1): a la misma distancia BFS de los dos agujeros (4 pasos
  // hasta la entrada de cada uno). Gato en (2,1), pegado a la entrada del
  // agujero 0 (dist 1) y lejos de la entrada del agujero 1 (dist 7): el
  // agujero 1 tiene mucho más margen.
  const action = act(mouseObs({
    you: { x: 5, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: { x: 2, y: 1, facing: 'N', stamina: 30 },
  }));
  const d = lastD(sink);
  assert(d.md === 'VOLVER', `esperaba md VOLVER, salió ${d.md}`);
  assert(d.tg === '9,0', `esperaba ir al agujero (9,0) (el de más margen), salió tg=${d.tg}`);
  assert(action.move === 'E', `esperaba moverse al Este (hacia el agujero 1), salió ${action.move}`);
  assert(typeof d.mg === 'number' && d.mg > 0, `esperaba mg>0, salió ${d.mg}`);
});

// ---------------------------------------------------------------- caso b
caso('b) ratón con queso sin gato visible -> igual que v2 (agujero más cercano)', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'mouse', map: corridorMap(), rules: RULES });
  sink.length = 0;
  // Ratón en (3,1): el agujero 0 (x=1) queda mucho más cerca (dist 3) que
  // el agujero 1 (x=9, dist 7). Sin gato, no hay margen que calcular.
  const action = act(mouseObs({
    you: { x: 3, y: 1, carrying: true, inHole: null, tunneling: null, heavy: false },
    cat: null,
  }));
  const d = lastD(sink);
  assert(d.md === 'VOLVER', `esperaba md VOLVER, salió ${d.md}`);
  assert(d.tg === '1,0', `esperaba ir al agujero más cercano (1,0), salió tg=${d.tg}`);
  assert(action.move === 'W', `esperaba moverse al Oeste, salió ${action.move}`);
  assert(d.mg === null, `sin gato visible, mg debe ser null (R2 no aplica), salió ${d.mg}`);
  assert(d.dv === null, `sin gato visible, dv debe ser null (como en v2), salió ${d.dv}`);
});

// ---------------------------------------------------------------- caso c
caso('c) gato sin ratón ni olor, con un queso -> va AL QUESO y hace STAY sobre él', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorMap(), rules: RULES });

  // El queso está en (8,1): sin pickup ni persecución, el gato vigila el
  // queso más cercano yendo derecho a su casilla (no a una entrada).
  sink.length = 0;
  const a1 = act(catObs({
    you: { x: 2, y: 1, facing: 'N', stamina: 30 },
    cheese: [[8, 1]],
  }));
  const d1 = lastD(sink);
  assert(d1.md === 'VIGILAR_QUESO', `esperaba md VIGILAR_QUESO, salió ${d1.md}`);
  assert(d1.tg === '8,1', `esperaba ir a la casilla del queso (8,1), salió tg=${d1.tg}`);
  assert(a1.move === 'E', `esperaba moverse al Este, salió ${a1.move}`);

  // Al llegar a la casilla del queso, con el mismo queso en el piso: STAY.
  sink.length = 0;
  const a2 = act(catObs({
    you: { x: 8, y: 1, facing: 'E', stamina: 30 },
    cheese: [[8, 1]],
  }));
  const d2 = lastD(sink);
  assert(a2.move === 'STAY', `esperaba STAY al llegar al queso, salió ${a2.move}`);
  assert(d2.md === 'VIGILAR_QUESO', `esperaba seguir en VIGILAR_QUESO, salió ${d2.md}`);
});

// ---------------------------------------------------------------- caso d
caso('d) gato sin queso en el piso y sin persecución activa -> STAY', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorMap(), rules: RULES });

  sink.length = 0;
  const a = act(catObs({ you: { x: 5, y: 1, facing: 'N', stamina: 30 }, cheese: [] }));
  const d = lastD(sink);
  assert(a.move === 'STAY', `sin queso en el piso, esperaba STAY, salió ${a.move}`);
  assert(d.md === 'VIGILAR_QUESO', `esperaba md VIGILAR_QUESO, salió ${d.md}`);
  assert(d.tg === null, `sin queso objetivo, esperaba tg null, salió tg=${d.tg}`);
});

// ---------------------------------------------------------------- caso e
caso('e) pickup de un queso -> no abandona esa entrada por otro queso que queda en el piso', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorMap(), rules: RULES });

  // Turno 1: dos quesos, A pegado al gato (1,1) y B lejos (8,1). El más
  // cercano es A, así que el gato ya está parado sobre él.
  sink.length = 0;
  const t1 = act(catObs({ you: { x: 1, y: 1, facing: 'N', stamina: 30 }, cheese: [[1, 1], [8, 1]] }));
  assert(t1.move === 'STAY', `turno 1: esperaba STAY sobre el queso A, salió ${t1.move}`);

  // Turno 2: el ratón levantó A (pickup en (1,1)). Queda B en el piso, cuya
  // entrada más cercana es la OTRA (9,1) -- pero el gato no debe ir ahí:
  // tiene que seguir esperando por A, que es el queso que de verdad va a
  // salir por (1,1).
  sink.length = 0;
  const t2 = act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [[8, 1]],
    events: [{ type: 'pickup', x: 1, y: 1 }],
  }));
  const d2 = lastD(sink);
  assert(d2.tg === '1,1', `esperaba seguir apuntando a (1,1) (la entrada de A), salió tg=${d2.tg}`);
  assert(t2.move === 'STAY', `esperaba quedarse en (1,1) y NO ir hacia B, salió ${t2.move}`);
});

// ---------------------------------------------------------------- caso f
caso('f) delivered -> el gato vuelve a elegir por el queso que queda en el piso', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorMap(), rules: RULES });

  // Turno 1: un solo queso A (2,1), el gato camina hacia él.
  sink.length = 0;
  act(catObs({ you: { x: 1, y: 1, facing: 'N', stamina: 30 }, cheese: [[2, 1]] }));

  // Turno 2: pickup de A. Memoria: persigue la entrada (1,1).
  sink.length = 0;
  act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [[8, 1]],
    events: [{ type: 'pickup', x: 2, y: 1 }],
  }));

  // Turno 3: A se entregó. Ahora sí importa B (8,1): el gato suelta la
  // entrada (1,1) y va derecho a la casilla del queso B.
  sink.length = 0;
  const t3 = act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [[8, 1]],
    events: [{ type: 'delivered', hole: 0 }],
  }));
  const d3 = lastD(sink);
  assert(d3.tg === '8,1', `esperaba volver a elegir por queso y apuntar a la casilla (8,1), salió tg=${d3.tg}`);
  assert(t3.move === 'E', `esperaba moverse al Este hacia el queso, salió ${t3.move}`);
});

// ---------------------------------------------------------------- caso g
caso('g) delivered en un turno con olor (SEGUIR_OLOR) también limpia persecucionQueso', () => {
  const { createBot, sink } = loadBot();
  const act = createBot({ role: 'cat', map: corridorMap(), rules: RULES });

  // Turno 1: queso A (2,1), el gato camina hacia él.
  act(catObs({ you: { x: 1, y: 1, facing: 'N', stamina: 30 }, cheese: [[2, 1]] }));

  // Turno 2: pickup de A -> persecucionQueso = (1,1).
  act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [],
    events: [{ type: 'pickup', x: 2, y: 1 }],
  }));

  // Turno 3: llega 'delivered' el MISMO turno en que hay olor (sin ratón a
  // la vista): el gato elige SEGUIR_OLOR, no EMBOSCADA. Si el evento solo
  // se leyera dentro de decideEmboscada, este 'delivered' nunca se vería.
  sink.length = 0;
  const t3 = act(catObs({
    you: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese: [[8, 1]],
    scent: [[5, 1, 0.5]],
    events: [{ type: 'delivered', hole: 0 }],
  }));
  const d3 = lastD(sink);
  assert(d3.md === 'SEGUIR_OLOR', `turno 3: esperaba SEGUIR_OLOR, salió ${d3.md}`);
  assert(t3.move === 'E', `turno 3: esperaba moverse al Este siguiendo el olor, salió ${t3.move}`);

  // Turno 4: sin olor ni ratón, con un queso B nuevo. Si persecucionQueso
  // no se hubiera limpiado, seguiría apuntando a (1,1) en vez de volver a
  // vigilar B directamente.
  sink.length = 0;
  const t4 = act(catObs({ you: { x: 1, y: 1, facing: 'N', stamina: 30 }, cheese: [[8, 1]] }));
  const d4 = lastD(sink);
  assert(d4.md === 'VIGILAR_QUESO', `turno 4: esperaba VIGILAR_QUESO, salió ${d4.md}`);
  assert(d4.tg === '8,1', `turno 4: esperaba que persecucionQueso estuviera limpio y apuntara al queso (8,1), salió tg=${d4.tg}`);
  assert(t4.move === 'E', `turno 4: esperaba moverse al Este hacia (8,1), salió ${t4.move}`);
});

console.log('');
console.log(fallas === 0 ? `OK: los ${7} casos pasaron.` : `FALLÓ: ${fallas} de 7 casos.`);
process.exit(fallas === 0 ? 0 : 1);
