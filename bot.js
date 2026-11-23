// Midnight Kitchen — bot v1.
//
// Concepto único (DISENO_V1.md §1): moverse con BFS por caminos reales hacia
// el objetivo del modo activo, en los dos roles. Prioridad fija entre modos
// (máquina de estados) para evitar que el bot "dude" turno a turno.
// Sin memoria entre turnos para decidir (eso es v2): cada act() decide de
// cero a partir de la observación de ese turno. El único estado que
// sobrevive en el closure es el historial de modos, y existe solo para el
// registro ("D|"), nunca para decidir (DISENO_V1.md §2).
//
// Fuera de v1 (DISENO_V1.md §10): cascabel, HUIR, túneles iniciados por
// nosotros, sprint, look, drop, intercepción, memoria para decidir, regla de
// seguridad en la entrada. Por eso obs.cat, obs.bell y obs.bellLoud del
// ratón no se usan para decidir: solo se registran en la línea "D|" para
// estimar los números ocultos y diseñar v2 con datos reales.

// --------------------------------------------------------------- utilidades

const DIRS = ['N', 'S', 'E', 'W'];
// Delta de cada dirección según la convención de RULES.md: N es y-1, S es
// y+1, E es x+1, W es x-1.
const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Clave de tablero única por casilla, usada como llave del grafo. */
function keyOf(x, y) {
  return x + ',' + y;
}

function parseKey(key) {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

/** El ratón y el gato comparten esta noción de "piso": '.' y 'T'. */
function isFloorChar(ch) {
  return ch === '.' || ch === 'T';
}

/**
 * Grafo de piso puro: nodos '.'/'T', vecinos en orden N,S,E,W. Se usa tal
 * cual para el gato (nunca pisa 'H', así que no hace falta nada más) y es
 * la base del grafo del ratón.
 */
function buildFloorGraph(map) {
  const graph = {};
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isFloorChar(map.rows[y][x])) continue;
      const entry = { N: null, S: null, E: null, W: null };
      for (const dir of DIRS) {
        const [dx, dy] = DELTA[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (isFloorChar(map.rows[ny][nx])) entry[dir] = keyOf(nx, ny);
      }
      graph[keyOf(x, y)] = entry;
    }
  }
  return graph;
}

/** Dirección de (0,0) a (dx,dy) cuando son adyacentes; null si no lo son. */
function dirFromDelta(dx, dy) {
  for (const dir of DIRS) {
    const [ddx, ddy] = DELTA[dir];
    if (ddx === dx && ddy === dy) return dir;
  }
  return null;
}

/**
 * Grafo del ratón: piso puro, más cada agujero como nodo aparte con un único
 * vecino (su entrance). Esto hace que un agujero sea siempre una hoja del
 * grafo (un solo vecino), así que el BFS jamás lo puede usar como camino
 * intermedio hacia otro objetivo: para "pasar por ahí" tendría que entrar y
 * volver a salir por el mismo lado, lo que nunca es más corto. Por eso la
 * regla "H solo como destino o salida" sale sola de la forma del grafo, sin
 * código extra que la fuerce.
 */
function buildMouseGraph(map) {
  const graph = buildFloorGraph(map);
  for (const hole of map.holes) {
    const holeKey = keyOf(hole.x, hole.y);
    const entranceKey = keyOf(hole.entrance.x, hole.entrance.y);
    const dirEntranceToHole = dirFromDelta(hole.x - hole.entrance.x, hole.y - hole.entrance.y);
    const entry = { N: null, S: null, E: null, W: null };
    entry[OPPOSITE[dirEntranceToHole]] = entranceKey;
    graph[holeKey] = entry;
    // La entrance ya existe en el grafo de piso; le agregamos el borde hacia
    // el agujero (la celda 'H' no pasa el filtro isFloorChar, por eso no
    // apareció antes).
    if (!graph[entranceKey]) graph[entranceKey] = { N: null, S: null, E: null, W: null };
    graph[entranceKey][dirEntranceToHole] = holeKey;
  }
  return graph;
}

/**
 * BFS de una sola pasada desde `startKey` hasta el primer nodo que cumple
 * `isTarget`. El desempate entre caminos igual de cortos queda fijado por el
 * orden de exploración de vecinos (N, S, E, W) en cada nodo.
 * SUPUESTO: cuando hay varios objetivos a la misma distancia (p. ej. dos
 * quesos), el BFS corta en el primero que aparece en su orden de
 * exploración; DISENO_V1.md pide "el más cercano" pero no dice cómo
 * desempatar entre objetivos empatados en distancia.
 */
function bfsFirstStep(graph, startKey, isTarget) {
  if (isTarget(startKey)) return { dir: 'STAY', dist: 0, target: startKey, path: [startKey] };

  const visited = new Set([startKey]);
  const parent = new Map(); // clave -> { from, dir }
  const queue = [startKey];
  let foundKey = null;

  for (let i = 0; i < queue.length && !foundKey; i++) {
    const cur = queue[i];
    const neighbors = graph[cur];
    if (!neighbors) continue;
    for (const dir of DIRS) {
      const next = neighbors[dir];
      if (!next || visited.has(next)) continue;
      visited.add(next);
      parent.set(next, { from: cur, dir });
      if (isTarget(next)) { foundKey = next; break; }
      queue.push(next);
    }
  }
  if (!foundKey) return null;

  const path = [foundKey];
  let cur = foundKey;
  let firstDir = null;
  while (cur !== startKey) {
    const info = parent.get(cur);
    firstDir = info.dir; // el último valor asignado es el tramo que sale de startKey
    cur = info.from;
    path.push(cur);
  }
  path.reverse();
  return { dir: firstDir, dist: path.length - 1, target: foundKey, path };
}

/** Tiles de depuración a partir de una ruta BFS, recortados a debugMaxTiles. */
function routeToDebugTiles(path, maxTiles) {
  return path.slice(0, maxTiles).map((key) => {
    const [x, y] = parseKey(key);
    return [x, y, 1];
  });
}

function clampText(text, maxChars) {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// -------------------------------------------------------- resultado de modo

/**
 * Empaqueta el resultado de un modo que se resuelve con BFS: si no hay
 * camino, STAY y se explica en debug (regla general de DISENO_V1.md §4,
 * aplicada también al ratón).
 */
function moveResultFromBfs(mode, bfsResult, label) {
  if (!bfsResult) {
    return { mode, move: 'STAY', debug: `${label}: sin camino al objetivo`, target: null, dist: null, path: null };
  }
  if (bfsResult.dir === 'STAY') {
    return { mode, move: 'STAY', debug: `${label}: ya estoy en el objetivo`, target: bfsResult.target, dist: 0, path: bfsResult.path };
  }
  return {
    mode,
    move: bfsResult.dir,
    debug: `${label}: paso ${bfsResult.dir} hacia ${bfsResult.target} (dist ${bfsResult.dist})`,
    target: bfsResult.target,
    dist: bfsResult.dist,
    path: bfsResult.path,
  };
}

function stayResult(mode, debug) {
  return { mode, move: 'STAY', debug, target: null, dist: null, path: null };
}

// -------------------------------------------------------------- modo ratón

/**
 * Prioridad fija del ratón (DISENO_V1.md §3, gana la primera que se cumple).
 * Nada de esto mira al gato: no hay HUIR en v1 (riesgo aceptado en §1).
 */
function decideMouse(obs, graph, holeKeys) {
  const startKey = keyOf(obs.you.x, obs.you.y);

  // 1) TUNEL: viajando entre agujeros, no se puede hacer nada más.
  if (obs.you.tunneling !== null) {
    return stayResult('TUNEL', 'en túnel: no se puede actuar este turno');
  }

  // 2) VOLVER: con queso encima, ir al agujero más cercano (no tiene que
  // ser el de salida). Si está heavy, igual mandamos el paso: el servidor
  // lo descarta, nosotros no decidimos distinto por eso.
  if (obs.you.carrying) {
    const holeSet = new Set(holeKeys);
    const bfs = bfsFirstStep(graph, startKey, (k) => holeSet.has(k));
    return moveResultFromBfs('VOLVER', bfs, 'volviendo con el queso');
  }

  // 3) IR_AL_QUESO: hay queso en el piso, se sale a buscarlo sin mirar al
  // gato (ya no hay regla de seguridad en la entrada). Si justo estamos
  // parados sobre un agujero (inHole != null), el único vecino de ese nodo
  // es la entrance, así que el primer paso termina siendo la entrance sin
  // que tengamos que pedirlo a mano.
  if (obs.cheese.length > 0) {
    const cheeseSet = new Set(obs.cheese.map(([x, y]) => keyOf(x, y)));
    const bfs = bfsFirstStep(graph, startKey, (k) => cheeseSet.has(k));
    return moveResultFromBfs('IR_AL_QUESO', bfs, 'yendo al queso más cercano');
  }

  // 4) ESCONDIDO: ya adentro de un agujero y sin queso visible, esperar.
  if (obs.you.inHole !== null) {
    return stayResult('ESCONDIDO', 'escondido, sin queso en el piso');
  }

  // 5) ESCONDIDO (caso raro, confirmado en el diseño y vigilado en los
  // datos — DISENO_V1.md §3 fila 5): afuera y sin queso, se vuelve al
  // agujero más cercano.
  const holeSet = new Set(holeKeys);
  const bfs = bfsFirstStep(graph, startKey, (k) => holeSet.has(k));
  return moveResultFromBfs('ESCONDIDO', bfs, 'sin queso y fuera del agujero: vuelvo a esconderme');
}

// --------------------------------------------------------------- modo gato

/**
 * De todo obs.scent, la casilla con más fuerza de olor, ignorando la propia
 * casilla (DISENO_V1.md §4 fila 2). Si después de ignorar la propia no
 * queda nada, no hay objetivo real aunque obs.scent no esté vacío.
 * SUPUESTO: cuando varias casillas empatan en la fuerza máxima, se las deja
 * competir en el BFS y gana la más cercana; DISENO_V1.md no da una regla
 * de desempate aparte de "la que tiene más olor".
 */
function strongestScentTargets(scent, ownKey) {
  let maxStrength = -Infinity;
  for (const [x, y, strength] of scent) {
    if (keyOf(x, y) === ownKey) continue;
    if (strength > maxStrength) maxStrength = strength;
  }
  const targets = new Set();
  for (const [x, y, strength] of scent) {
    const k = keyOf(x, y);
    if (k === ownKey) continue;
    if (strength === maxStrength) targets.add(k);
  }
  return targets;
}

/** Prioridad fija del gato (DISENO_V1.md §4, gana la primera que se cumple). */
function decideCat(obs, graph) {
  const startKey = keyOf(obs.you.x, obs.you.y);

  // 1) PERSEGUIR: lo tenemos a la vista, vamos directo.
  if (obs.mouse !== null) {
    const mouseKey = keyOf(obs.mouse.x, obs.mouse.y);
    const bfs = bfsFirstStep(graph, startKey, (k) => k === mouseKey);
    return moveResultFromBfs('PERSEGUIR', bfs, 'persiguiendo al ratón visible');
  }

  // 2) SEGUIR_OLOR: no se ve, pero hay rastro.
  if (obs.scent.length > 0) {
    const targets = strongestScentTargets(obs.scent, startKey);
    if (targets.size === 0) {
      return stayResult('SEGUIR_OLOR', 'el olor está solo en mi propia casilla');
    }
    const bfs = bfsFirstStep(graph, startKey, (k) => targets.has(k));
    return moveResultFromBfs('SEGUIR_OLOR', bfs, 'siguiendo la casilla con más olor');
  }

  // 3) VIGILAR_QUESO: sin rastro ni vista, al menos cubrir el queso.
  if (obs.cheese.length > 0) {
    const cheeseSet = new Set(obs.cheese.map(([x, y]) => keyOf(x, y)));
    const bfs = bfsFirstStep(graph, startKey, (k) => cheeseSet.has(k));
    return moveResultFromBfs('VIGILAR_QUESO', bfs, 'vigilando el queso más cercano');
  }

  // 4) sin ratón, sin olor, sin queso: no hay nada que perseguir.
  return stayResult('VIGILAR_QUESO', 'sin ratón, olor ni queso: espero');
}

// ------------------------------------------------------------------ registro

/**
 * bounce = A,B,A visto en una ventana de hasta 3 turnos (DISENO_V1.md §6).
 * Es puramente observacional: modeHistory nunca se consulta para decidir,
 * solo para armar esta línea de log (DISENO_V1.md §2).
 */
function detectBounce(modeHistory) {
  return modeHistory.length === 3 && modeHistory[0] === modeHistory[2] && modeHistory[0] !== modeHistory[1];
}

/** Fuerza máxima en obs.scent, o null si no hay nada que oler. Solo para registro. */
function maxScentStrength(scent) {
  let max = null;
  for (let i = 0; i < scent.length; i++) {
    const strength = scent[i][2];
    if (max === null || strength > max) max = strength;
  }
  return max;
}

/** Rol codificado a un carácter, como pide LOGS.md: 'm' ratón, 'c' gato. */
function roleCode(role) {
  return role === 'mouse' ? 'm' : 'c';
}

/** Convención de LOGS.md: los booleanos se registran como 1/0, no true/false. */
function toBit(value) {
  return value ? 1 : 0;
}

/**
 * Formato de registro v2 (ver LOGS.md para el detalle completo de cada
 * clave). El motor corta cada console.log a unos 300 caracteres; con las
 * claves largas de v1 llegábamos a ~390 y el motor nos cortaba justo los
 * últimos campos (scentMax, mouse). Por eso v2 usa claves cortas y cada rol
 * imprime SOLO sus propias claves (menos campos por línea, no solo nombres
 * más cortos). Nada de esto se usa para decidir (DISENO_V1.md §2): esta
 * función solo arma el objeto que después se imprime con console.log.
 *
 * Leyenda resumida:
 *   comunes  → t=turno  r=rol(m/c)  md=modo  pm=modo anterior  b=rebote(1/0)
 *              x,y=posición propia  tg=objetivo "x,y" o null  d=distancia BFS
 *              ch=quesos en el piso  vc=casillas visibles  ev=tipos de evento
 *   ratón    → c=lleva queso(1/0)  h=heavy(1/0)  ih=num. de agujero o null
 *              bl=cascabel o null  bL=cascabel fuerte(1/0)
 *              cat=gato visto [x,y,dirección,estamina] o null
 *   gato     → st=estamina  f=dirección  sc=casillas con olor
 *              sm=olor más fuerte (0..1) o null
 *              mo=ratón visto [x,y,llevaQueso(1/0)] o null
 * `tunneling` no tiene clave propia: su único rastro en el registro es
 * "md":"TUNEL" (ver decideMouse); no hace falta repetirlo acá.
 */
function buildLogFields(obs, role, mode, prevMode, bounce, target, dist) {
  const isMouse = role === 'mouse';
  const common = {
    t: obs.turn,
    r: roleCode(role),
    md: mode,
    pm: prevMode,
    b: toBit(bounce),
    x: obs.you.x,
    y: obs.you.y,
    tg: target || null,
    d: dist === undefined ? null : dist,
    ch: obs.cheese.length,
    vc: obs.visible.length,
    ev: obs.events.map((e) => e.type),
  };
  const roleFields = isMouse
    ? {
        c: toBit(obs.you.carrying),
        h: toBit(obs.you.heavy),
        ih: obs.you.inHole,
        bl: obs.bell === undefined ? null : obs.bell,
        bL: toBit(obs.bellLoud),
        cat: obs.cat ? [obs.cat.x, obs.cat.y, obs.cat.facing, obs.cat.stamina] : null,
      }
    : {
        st: obs.you.stamina,
        f: obs.you.facing,
        sc: obs.scent.length,
        sm: maxScentStrength(obs.scent),
        mo: obs.mouse ? [obs.mouse.x, obs.mouse.y, toBit(obs.mouse.carrying)] : null,
      };
  return { ...common, ...roleFields };
}

/** Encabezado del turno 1 (LOGS.md "Línea de encabezado"), para ubicar capturas en la entrance. */
function logEntrances(map, obs, role) {
  const entrances = map.holes.map((hole) => [hole.entrance.x, hole.entrance.y]);
  console.log('D|' + JSON.stringify({
    hdr: 1,
    r: roleCode(role),
    w: map.width,
    hg: map.height,
    hc: map.holes.length,
    ch: obs.cheese.length,
    en: entrances,
  }));
}

// -------------------------------------------------------------------- bot

/**
 * @param {{ role: 'cat' | 'mouse', map: object, rules: object }} setup
 * @returns {(obs: object) => object}
 */
function createBot(setup) {
  const { role, map, rules } = setup;

  // Todo lo que no cambia turno a turno se precalcula una sola vez acá:
  // el grafo de movimiento y, para el ratón, la lista de agujeros como
  // claves listas para usar en los Set de objetivo.
  const graph = role === 'cat' ? buildFloorGraph(map) : buildMouseGraph(map);
  const holeKeys = role === 'mouse' ? map.holes.map((h) => keyOf(h.x, h.y)) : null;

  // Historial de modos: SOLO para el registro (prevMode, bounce), nunca
  // para decidir (DISENO_V1.md §2).
  const modeHistory = [];

  return function act(obs) {
    if (obs.turn === 1) logEntrances(map, obs, role);

    const decision = role === 'cat' ? decideCat(obs, graph) : decideMouse(obs, graph, holeKeys);

    const prevMode = modeHistory.length ? modeHistory[modeHistory.length - 1] : null;
    modeHistory.push(decision.mode);
    if (modeHistory.length > 3) modeHistory.shift();
    const bounce = detectBounce(modeHistory);

    const logLine = buildLogFields(obs, role, decision.mode, prevMode, bounce, decision.target, decision.dist);
    console.log('D|' + JSON.stringify(logLine));

    const action = { move: decision.move, debug: clampText(decision.debug, rules.debugMaxChars) };
    if (decision.path) {
      const debugTiles = routeToDebugTiles(decision.path, rules.debugMaxTiles);
      if (debugTiles.length) action.debugTiles = debugTiles;
    }
    return action;
  };
}