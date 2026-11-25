// casos-v9.mjs — casos de prueba a mano para v9 (carrera antes de levantar, R-B).
// Uso: node scripts/casos-v9.mjs
//
// Carga bot.js con vm, igual que pre-ship.mjs y casos-v8.mjs, y corre
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

// Pasillo con un solo agujero (entrada en (1,1)), de (0,1) a (26,1). Ancho
// 27 para poder separar "cerca del agujero" (margen bueno) de "lejos"
// (margen malo) sin que la zona de peligro del gato (radio 2) tape el
// camino hacia el queso que SÍ conviene levantar.
function pasilloUnHoyo() {
  const width = 27;
  return {
    width,
    height: 3,
    rows: [
      '#H' + '#'.repeat(width - 2),
      '.'.repeat(width),
      '#'.repeat(width),
    ],
    holes: [{ x: 1, y: 0, entrance: { x: 1, y: 1 } }],
  };
}

// Dos agujeros, entradas en (1,1) y (19,1): para probar que el margen usa
// el MEJOR agujero (la carrera por el agujero que el gato no amenaza
// sigue firme aunque la otra sí se pierda).
function pasilloDosHoyos() {
  const width = 21;
  return {
    width,
    height: 3,
    rows: [
      '#H' + '#'.repeat(width - 4) + 'H#',
      '.'.repeat(width),
      '#'.repeat(width),
    ],
    holes: [
      { x: 1, y: 0, entrance: { x: 1, y: 1 } },
      { x: 19, y: 0, entrance: { x: 19, y: 1 } },
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
caso('a) A pierde la carrera (margen<-4) y B no -> va hacia B, rb=1', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloUnHoyo(), rules: RULES });
  // Gato en (23,1): a A=(19,1) [dQ=19] el margen es 22-19/0.73≈-4.03 (pierde);
  // a B=(3,1) [dQ=3] el margen es 22-3/0.73≈17.89 (gana). A es la más
  // cercana al ratón (sin R-B, la base iría ahí) -- por eso el caso vale.
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 17, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 23, y: 1, facing: 'W', stamina: 30 },
    cheese: [[19, 1], [3, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'IR_AL_QUESO', `esperaba IR_AL_QUESO, salió ${d.md}`);
  assert(d.tg === '3,1', `esperaba tg='3,1' (B), salió ${d.tg}`);
  assert(action.move === 'W', `esperaba move 'W' (hacia B), salió ${action.move}`);
  assert(d.rb === 1, `esperaba rb=1, salió ${d.rb}`);
});

// ---------------------------------------------------------------- caso b
caso('b) un solo queso con margen<-4 -> no va hacia él, sigue la cadena (vuelve al agujero)', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloUnHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 17, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 23, y: 1, facing: 'W', stamina: 30 },
    cheese: [[19, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'VOLVER', `esperaba VOLVER (sin queso candidato, vuelve al agujero), salió ${d.md}`);
  assert(action.move === 'W', `esperaba move 'W' (hacia el agujero), salió ${action.move}`);
  assert(d.rb === 1, `esperaba rb=1 (se descartó el único queso), salió ${d.rb}`);
});

// ---------------------------------------------------------------- caso c
caso('c) sin gato visto ni recordado -> va al más cercano, como la base, sin rb', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloUnHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 17, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null,
    cheese: [[19, 1], [3, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'IR_AL_QUESO', `esperaba IR_AL_QUESO, salió ${d.md}`);
  assert(d.tg === '19,1', `esperaba tg='19,1' (el más cercano, sin filtro), salió ${d.tg}`);
  assert(action.move === 'E', `esperaba move 'E' (hacia el más cercano), salió ${action.move}`);
  assert(!('rb' in d), `no esperaba la clave rb (sin gato no hay carrera), salió ${d.rb}`);
});

// ---------------------------------------------------------------- caso d
caso('d) margen >= -4 -> va al queso normal, sin rb', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloUnHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 17, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 23, y: 1, facing: 'W', stamina: 30 },
    cheese: [[3, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'IR_AL_QUESO', `esperaba IR_AL_QUESO, salió ${d.md}`);
  assert(d.tg === '3,1', `esperaba tg='3,1', salió ${d.tg}`);
  assert(action.move === 'W', `esperaba move 'W', salió ${action.move}`);
  assert(!('rb' in d), `no esperaba la clave rb (nada se descartó), salió ${d.rb}`);
});

// ---------------------------------------------------------------- caso e
caso('e) compromiso con A; A pasa a tener margen<-4 -> cambia a B', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloDosHoyos(), rules: RULES });
  const cheese = [[3, 1], [17, 1]]; // A cerca del agujero 0, B cerca del agujero 1.

  // Turno 1: gato lejos de las dos entradas (en el medio) -> A y B con
  // margen sano por las dos; el ratón, en (4,1), está pegado a A -> se
  // compromete con A.
  sink.length = 0;
  const a1 = act(mouseObs({
    turn: 1,
    you: { x: 4, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 10, y: 1, facing: 'N', stamina: 30 },
    cheese,
  }));
  assert(lastD(sink).tg === '3,1', 'turno 1: esperaba comprometerse con A (el más cercano)');
  assert(a1.move === 'W', 'turno 1: esperaba moverse hacia A');

  // Turno 2: el gato llega a la entrada del agujero 0 (la de A) -> el
  // margen de A se hunde (vía ese agujero) y el de B sigue sano (vía el
  // otro, que el gato no toca) -> suelta el compromiso y va a B.
  sink.length = 0;
  const a2 = act(mouseObs({
    turn: 2,
    you: { x: 4, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 1, y: 1, facing: 'N', stamina: 30 },
    cheese,
  }));
  const d2 = lastD(sink);
  assert(d2.md === 'IR_AL_QUESO', `turno 2: esperaba IR_AL_QUESO, salió ${d2.md}`);
  assert(d2.tg === '17,1', `turno 2: esperaba que suelte A y vaya a B, salió tg=${d2.tg}`);
  assert(a2.move === 'E', `turno 2: esperaba moverse hacia B (al E), salió ${a2.move}`);
  assert(d2.rb === 1, `turno 2: esperaba rb=1 (A descartado), salió ${d2.rb}`);
});

// ---------------------------------------------------------------- caso f
caso('f) atrapado: el túnel no elige un agujero cuyo único queso alcanzable está descartado', () => {
  const { createBot, sink } = loadBot('bot.js');
  const act = createBot({ role: 'mouse', map: pasilloDosHoyos(), rules: RULES });
  // Ratón adentro del agujero 0; único queso en el medio (10,1), lejos de
  // las dos entradas -> margen<-4 por los dos agujeros, descartado del
  // todo. Sin candidatos, agujeroAlternativo no encuentra ruta a nada.
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 1, y: 0, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 10, y: 1, facing: 'N', stamina: 30 },
    cheese: [[10, 1]],
  }));
  const d = lastD(sink);
  assert(d.md === 'ESCONDIDO', `esperaba ESCONDIDO (sin candidato para el túnel), salió ${d.md}`);
  assert(action.move === 'STAY', `esperaba STAY, salió ${action.move}`);
  assert(action.tunnel === undefined, `no esperaba tunnel, salió ${action.tunnel}`);
  assert(d.rb === 1, `esperaba rb=1 (el único queso quedó descartado), salió ${d.rb}`);
});

// ---------------------------------------------------------------- caso g
caso('g) el caso a) FALLA contra la base (bot_v8.js, sin R-B)', () => {
  const { createBot, sink } = loadBot('bot_v8.js');
  const act = createBot({ role: 'mouse', map: pasilloUnHoyo(), rules: RULES });
  sink.length = 0;
  const action = act(mouseObs({
    you: { x: 17, y: 1, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: { x: 23, y: 1, facing: 'W', stamina: 30 },
    cheese: [[19, 1], [3, 1]],
  }));
  assert(action.move === 'E', 'la base debería ir hacia A (el más cercano, sin R-B); si no, el setup cambió');

  // Repite LITERALMENTE la aserción del caso a) contra la base: tiene que
  // tirar, porque la base no descarta A por la carrera.
  let tiro = false;
  try {
    assert(action.move === 'W', `esperaba move 'W' (hacia B), salió ${action.move}`);
  } catch (e) {
    tiro = true;
  }
  assert(tiro, 'el caso a) debía fallar contra la base (sin R-B) y no falló: no distingue v9 de la base');
});

console.log('');
console.log(fallas === 0 ? `OK: los ${total} casos pasaron.` : `FALLÓ: ${fallas} de ${total} casos.`);
process.exit(fallas === 0 ? 0 : 1);
