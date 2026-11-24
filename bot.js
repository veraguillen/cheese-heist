// Midnight Kitchen — bot v3.1.
//
// Un bot, dos roles, prioridad fija por modo (máquina de estados simple).
// El ratón esquiva al gato que ve y, si vuelve con queso, elige el agujero
// que le da más ventaja de tiempo sobre el gato (no solo el más cercano).
// El gato vigila el queso más cercano (VIGILAR_QUESO); solo si el ratón
// levanta un queso, va a esperar en la entrada más cercana a ese pickup
// (EMBOSCADA), hasta que lo entrega, lo suelta o lo atrapan.

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
 *
 * `blocked` (opcional, DISENO_V2.md §5 "Ruta segura"): un Set de casillas
 * que no se pueden usar ni como paso intermedio ni como objetivo. Es la
 * "zona de peligro" vista desde el ratón. Si no se pasa (o es null/undefined,
 * como en todas las llamadas del gato y las de v1), el comportamiento es
 * idéntico al de antes: nada queda bloqueado. La casilla de partida nunca se
 * revisa contra `blocked` (solo se usan vecinos NUEVOS), así que siempre se
 * permite salir desde donde uno está, tal como pide el diseño.
 */
function bfsFirstStep(graph, startKey, isTarget, blocked) {
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
      if (!next || visited.has(next) || (blocked && blocked.has(next))) continue;
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

/**
 * Distancia BFS entre dos casillas de un grafo, o null si no hay camino.
 * Es una envoltura de `bfsFirstStep` (no duplica el recorrido): se usa para
 * `cd` (DISENO_V2.md §7) y para medir qué tan lejos queda cada candidato de
 * ALEJARSE respecto del gato (DISENO_V2.md §5).
 */
function distanceBetween(graph, fromKey, toKey) {
  const result = bfsFirstStep(graph, fromKey, (k) => k === toKey);
  return result ? result.dist : null;
}

/**
 * Zona de peligro (DISENO_V2.md §4): casillas a distancia ≤2 del gato por su
 * propio grafo (piso puro), incluida la casilla del gato. No reutiliza
 * `bfsFirstStep` porque ese corta en el PRIMER objetivo encontrado; acá hace
 * falta TODA la zona dentro del radio, no la casilla más cercana a algo. Los
 * agujeros nunca aparecen porque `catGraph` ni los tiene como nodos (el gato
 * no entra a 'H'), así que "los agujeros nunca están en peligro" sale solo.
 */
function computeDangerZone(catGraph, catKey) {
  const zone = new Set([catKey]);
  let frontier = [catKey];
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    for (const key of frontier) {
      const neighbors = catGraph[key];
      if (!neighbors) continue;
      for (const dir of DIRS) {
        const n = neighbors[dir];
        if (n && !zone.has(n)) {
          zone.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return zone;
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
 * dv (DISENO_V2.md §7): compara la ruta segura ya encontrada contra la ruta
 * directa que habría tomado v1 para el mismo conjunto de objetivos (mismo
 * BFS, sin `blocked`). Si la ruta segura existe, la directa también existe
 * siempre —es un subconjunto de los mismos movimientos—, así que no hace
 * falta manejar un resultado nulo acá. Solo tiene sentido llamarla cuando se
 * ve al gato (si no, no hay "ruta directa" distinta que comparar).
 */
function deviationBit(graph, startKey, isTarget, safeResult) {
  const direct = bfsFirstStep(graph, startKey, isTarget);
  return toBit(direct.dir !== safeResult.dir || direct.target !== safeResult.target);
}

/**
 * ALEJARSE (DISENO_V2.md §5, última fila): cuando ninguna ruta segura llega
 * al objetivo, el paso que más aleja del gato. Candidatos: quedarse y cada
 * vecino en el grafo DEL RATÓN (puede ser un agujero). La distancia de cada
 * candidato es su distancia real al gato por el grafo DEL GATO:
 * - un vecino que es agujero nunca aparece en `catGraph` (el gato no entra a
 *   'H'), así que `distanceBetween` da null ahí → se trata como infinito;
 * - una casilla a la que el gato no puede llegar por ningún camino también
 *   da null → mismo trato infinito.
 * Las dos reglas de "cuenta como infinito" de DISENO_V2.md salen de la misma
 * cuenta, sin casos especiales. Desempate fijo: N, S, E, W y, al final, STAY
 * (por eso se itera en ese orden y solo se reemplaza el mejor si es
 * estrictamente mayor).
 */
function alejarseResult(mouseGraph, catGraph, startKey, catKey, debug) {
  const candidates = DIRS.map((dir) => ({ dir, key: mouseGraph[startKey][dir] }));
  candidates.push({ dir: 'STAY', key: startKey });

  let bestDir = 'STAY';
  let bestSafety = -1;
  for (const candidate of candidates) {
    if (!candidate.key) continue; // pared en esa dirección
    const away = distanceBetween(catGraph, catKey, candidate.key);
    const safety = away === null ? Infinity : away;
    if (safety > bestSafety) {
      bestSafety = safety;
      bestDir = candidate.dir;
    }
  }

  // SUPUESTO: en ALEJARSE no hay un "objetivo" ni una "ruta directa" que
  // comparar (DISENO_V2.md no lo dice explícitamente), así que se registra
  // dv:1 siempre: por definición es lo más distinto posible de la ruta
  // directa de v1, que habría ido hacia el objetivo en vez de huir de él.
  return {
    mode: 'ALEJARSE',
    move: bestDir,
    debug: `${debug}: paso ${bestDir} (seguridad ${bestSafety === Infinity ? 'infinita' : bestSafety})`,
    target: null,
    dist: null,
    path: null,
    deviated: 1,
  };
}

/**
 * R2: entre los agujeros con ruta segura, el que le da más ventaja de
 * tiempo al ratón frente al gato (no necesariamente el más cercano). Un
 * agujero al que el gato no puede llegar cuenta como ventaja infinita,
 * igual que en ALEJARSE. Devuelve null si ninguno tiene ruta segura.
 */
function bestMarginHole(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey) {
  let best = null;
  for (let i = 0; i < holeKeys.length; i++) {
    const bfs = bfsFirstStep(mouseGraph, startKey, (k) => k === holeKeys[i], dangerZone);
    if (!bfs) continue;
    // La distancia que importa para el margen es a la ENTRADA, no al
    // agujero: un paso antes de estar ya a salvo. dist 0 (parado en el
    // propio agujero) no debería darse llevando queso; se trata igual que
    // "ya en la entrada" para no dividir por casos que no pasan en el juego.
    const miDist = bfs.dist === 0 ? 0 : bfs.dist - 1;
    const distGato = distanceBetween(catGraph, catKey, holeEntranceKeys[i]);
    const margin = (distGato === null ? Infinity : distGato) - miDist;
    if (!best || margin > best.margin || (margin === best.margin && miDist < best.miDist)) {
      best = { bfs, margin, miDist };
    }
  }
  return best;
}

/** Con queso: sin gato visible, al agujero más cercano (como v2); con gato visible, al de más margen (R2). */
function decideVolver(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey) {
  const holeSet = new Set(holeKeys);
  const isHole = (k) => holeSet.has(k);

  if (!catKey) {
    return moveResultFromBfs('VOLVER', bfsFirstStep(mouseGraph, startKey, isHole), 'volviendo con el queso');
  }

  const elegido = bestMarginHole(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey);
  if (!elegido) {
    return alejarseResult(mouseGraph, catGraph, startKey, catKey, 'sin ruta segura a ningún agujero: me alejo del gato');
  }
  const result = moveResultFromBfs('VOLVER', elegido.bfs, 'volviendo al agujero con más margen frente al gato');
  result.deviated = deviationBit(mouseGraph, startKey, isHole, elegido.bfs);
  result.margin = elegido.margin;
  return result;
}

/**
 * Fila 3 de DISENO_V2.md §5: ruta segura al queso más cercano; si no hay,
 * ruta segura al agujero más cercano (el modo pasa a ser VOLVER, como pide
 * el diseño). Si tampoco hay eso, ALEJARSE.
 */
function decideIrAlQueso(mouseGraph, catGraph, startKey, cheese, holeKeys, dangerZone, catKey) {
  const cheeseSet = new Set(cheese.map(([x, y]) => keyOf(x, y)));
  const isCheese = (k) => cheeseSet.has(k);
  const safeCheese = bfsFirstStep(mouseGraph, startKey, isCheese, dangerZone);
  // Mismo criterio que en decideVolver: sin gato, label igual al de v1.
  const cheeseLabel = catKey ? 'yendo al queso más cercano por ruta segura' : 'yendo al queso más cercano';
  if (safeCheese) {
    const result = moveResultFromBfs('IR_AL_QUESO', safeCheese, cheeseLabel);
    result.deviated = catKey ? deviationBit(mouseGraph, startKey, isCheese, safeCheese) : null;
    return result;
  }

  // Sin gato visible, v1 no tenía ningún fallback en este modo: se queda en
  // el STAY/"sin camino al objetivo" de siempre, igual que v1 (DISENO_V2.md
  // §5: "si el gato no se ve... todo funciona como en v1"). El fallback al
  // agujero de abajo es, por construcción, solo para cuando SÍ hay zona de
  // peligro que esquivar.
  if (!catKey) return moveResultFromBfs('IR_AL_QUESO', null, cheeseLabel);

  const holeSet = new Set(holeKeys);
  const isHole = (k) => holeSet.has(k);
  const safeHole = bfsFirstStep(mouseGraph, startKey, isHole, dangerZone);
  if (safeHole) {
    // dv = 1 siempre en este tramo (DISENO_V2.md §7): v1 habría ido al queso
    // y aquí el objetivo pasó a ser un agujero, así que la ruta ya es
    // distinta de la directa de v1. Compararla contra "ir al agujero" daría
    // 0 aunque el ratón sí se desvió.
    if (safeHole.dir === 'STAY') {
      // Ya está dentro de un agujero y la entrada está en peligro: se queda.
      // La acción es la misma (STAY); solo se registra como ESCONDIDO y no
      // como VOLVER, porque no lleva queso y no está "volviendo" a ningún
      // lado (claridad del registro, DISENO_V2.md §5 nota bajo la tabla).
      const stay = stayResult('ESCONDIDO', 'hay queso, pero la entrada está en peligro: me quedo adentro');
      stay.deviated = 1;
      return stay;
    }
    const result = moveResultFromBfs('VOLVER', safeHole, 'sin ruta segura al queso: vuelvo al agujero más cercano');
    result.deviated = 1;
    return result;
  }

  return alejarseResult(mouseGraph, catGraph, startKey, catKey, 'sin ruta segura al queso ni al agujero: me alejo del gato');
}

/**
 * Fila 5 de DISENO_V2.md §5 (caso raro de v1): fuera del agujero y sin
 * queso en el piso, ruta segura al agujero más cercano. Sin ruta segura,
 * ALEJARSE.
 */
function decideEscondidoFuera(mouseGraph, catGraph, startKey, holeKeys, dangerZone, catKey) {
  const holeSet = new Set(holeKeys);
  const isHole = (k) => holeSet.has(k);
  const safe = bfsFirstStep(mouseGraph, startKey, isHole, dangerZone);
  const label = catKey
    ? 'sin queso y fuera del agujero: vuelvo a esconderme por ruta segura'
    : 'sin queso y fuera del agujero: vuelvo a esconderme';
  if (safe) {
    const result = moveResultFromBfs('ESCONDIDO', safe, label);
    result.deviated = catKey ? deviationBit(mouseGraph, startKey, isHole, safe) : null;
    return result;
  }
  if (!catKey) return moveResultFromBfs('ESCONDIDO', null, label);
  return alejarseResult(mouseGraph, catGraph, startKey, catKey, 'sin ruta segura al agujero: me alejo del gato');
}

/**
 * Prioridad fija del ratón (DISENO_V1.md §3, con los cambios de
 * DISENO_V2.md §5 en negrita en el propio documento). El gato no cambia
 * (DISENO_V2.md §3): si `obs.cat` es null, `dangerZone` queda `null`,
 * `bfsFirstStep` no bloquea nada y el ratón decide exactamente igual que en
 * v1 — por eso las filas 1 y 4 (TUNEL y ESCONDIDO ya adentro) ni se tocan,
 * y por eso tampoco se puede llegar a ALEJARSE sin ver al gato.
 */
function decideMouse(obs, mouseGraph, holeKeys, catGraph, holeEntranceKeys) {
  const startKey = keyOf(obs.you.x, obs.you.y);
  const catKey = obs.cat ? keyOf(obs.cat.x, obs.cat.y) : null;

  // cd (DISENO_V2.md §7): pura observación, se calcula siempre que se vea
  // al gato, sin importar en qué modo termine el turno.
  const catDist = catKey ? distanceBetween(catGraph, catKey, startKey) : null;

  // Zona de peligro (DISENO_V2.md §4): solo existe con el gato a la vista.
  const dangerZone = catKey ? computeDangerZone(catGraph, catKey) : null;

  let result;
  if (obs.you.tunneling !== null) {
    // 1) TUNEL: sin cambios respecto de v1.
    result = stayResult('TUNEL', 'en túnel: no se puede actuar este turno');
  } else if (obs.you.carrying) {
    // 2) VOLVER.
    result = decideVolver(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey);
  } else if (obs.cheese.length > 0) {
    // 3) IR_AL_QUESO.
    result = decideIrAlQueso(mouseGraph, catGraph, startKey, obs.cheese, holeKeys, dangerZone, catKey);
  } else if (obs.you.inHole !== null) {
    // 4) ESCONDIDO: sin cambios. "No se activa ALEJARSE estando dentro de
    // un agujero" (DISENO_V2.md §5, nota bajo la tabla).
    result = stayResult('ESCONDIDO', 'escondido, sin queso en el piso');
  } else {
    // 5) ESCONDIDO (caso raro).
    result = decideEscondidoFuera(mouseGraph, catGraph, startKey, holeKeys, dangerZone, catKey);
  }

  result.catDist = catDist;
  if (result.deviated === undefined) result.deviated = null;
  if (result.margin === undefined) result.margin = null; // mg solo aplica cuando R2 elige agujero
  return result;
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

/**
 * Actualiza memory.persecucionQueso a partir de obs.events. Los eventos
 * solo duran UN turno (no se repiten al turno siguiente), así que esto hay
 * que leerlo siempre, sin importar el modo que termine eligiendo el gato
 * ese turno -- si se leyera recién dentro de EMBOSCADA, un pickup llegado
 * mientras el gato está en PERSEGUIR o SEGUIR_OLOR se perdería para siempre.
 */
function actualizarMemoriaGato(obs, mouseGraphForCat, entranceByHole, memory) {
  const holeSet = new Set(Object.keys(entranceByHole));
  for (const ev of obs.events) {
    if (ev.type === 'pickup') {
      const bfsHole = bfsFirstStep(mouseGraphForCat, keyOf(ev.x, ev.y), (k) => holeSet.has(k));
      if (bfsHole) memory.persecucionQueso = entranceByHole[bfsHole.target];
    } else if (ev.type === 'delivered' || ev.type === 'caught' || ev.type === 'dropped') {
      memory.persecucionQueso = null;
    }
  }
}

/**
 * EMBOSCADA: si el ratón ya levantó un queso (memory.persecucionQueso,
 * actualizada en actualizarMemoriaGato, no acá), el gato va a esperar a la
 * entrada del agujero más cercano a ese pickup.
 *
 * Sin eso, VIGILAR_QUESO: vigilar el queso más cercano (igual que v2).
 */
function decideEmboscada(obs, startKey, catGraph, memory) {
  if (memory.persecucionQueso) {
    const bfs = bfsFirstStep(catGraph, startKey, (k) => k === memory.persecucionQueso);
    return moveResultFromBfs('EMBOSCADA', bfs, 'el ratón lleva queso: espero en la entrada más cercana al pickup');
  }

  if (obs.cheese.length > 0) {
    const cheeseSet = new Set(obs.cheese.map(([x, y]) => keyOf(x, y)));
    const bfs = bfsFirstStep(catGraph, startKey, (k) => cheeseSet.has(k));
    return moveResultFromBfs('VIGILAR_QUESO', bfs, 'vigilando el queso más cercano');
  }

  return stayResult('VIGILAR_QUESO', 'sin ratón, olor ni queso: espero');
}

/** Prioridad fija del gato: PERSEGUIR, SEGUIR_OLOR, EMBOSCADA. */
function decideCat(obs, graph, mouseGraphForCat, entranceByHole, memory) {
  const startKey = keyOf(obs.you.x, obs.you.y);
  actualizarMemoriaGato(obs, mouseGraphForCat, entranceByHole, memory);

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

  // 3) EMBOSCADA / VIGILAR_QUESO: sin rastro ni vista, cubrir el queso.
  return decideEmboscada(obs, startKey, graph, memory);
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
 *              cd=(v2) distancia real del gato al ratón, o null
 *              dv=(v2) 1 si la ruta segura difiere de la directa de v1,
 *                 0 si es igual, null si no se ve al gato (DISENO_V2.md §7)
 *              mg=(v3) margen del agujero elegido en VOLVER (R2), o null
 *   gato     → st=estamina  f=dirección  sc=casillas con olor
 *              sm=olor más fuerte (0..1) o null
 *              mo=ratón visto [x,y,llevaQueso(1/0)] o null
 * `tunneling` no tiene clave propia: su único rastro en el registro es
 * "md":"TUNEL" (ver decideMouse); no hace falta repetirlo acá. `md` también
 * puede valer "ALEJARSE" desde v2 (DISENO_V2.md §5) o "EMBOSCADA" desde v3.
 */
function buildLogFields(obs, role, mode, prevMode, bounce, target, dist, catDist, deviated, margin) {
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
        cd: catDist === undefined ? null : catDist,
        dv: deviated === undefined ? null : deviated,
        mg: margin === undefined ? null : margin,
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
  // claves listas para usar en los Set de objetivo. Desde v2, el ratón
  // también precalcula el grafo DEL GATO (piso puro): lo necesita la zona
  // de peligro, `cd` y ALEJARSE (DISENO_V2.md §4 y §5), y es literalmente
  // `buildFloorGraph`, el mismo que usa el gato para moverse.
  const graph = role === 'cat' ? buildFloorGraph(map) : buildMouseGraph(map);
  const holeKeys = role === 'mouse' ? map.holes.map((h) => keyOf(h.x, h.y)) : null;
  const holeEntranceKeys = role === 'mouse' ? map.holes.map((h) => keyOf(h.entrance.x, h.entrance.y)) : null;
  const catGraph = role === 'mouse' ? buildFloorGraph(map) : null;

  // G2 necesita, desde el gato, el grafo del ratón (para ubicar el agujero
  // más cercano al queso) y la entrada de cada agujero (a dónde ir).
  const mouseGraphForCat = role === 'cat' ? buildMouseGraph(map) : null;
  const entranceByHole = role === 'cat'
    ? Object.fromEntries(map.holes.map((h) => [keyOf(h.x, h.y), keyOf(h.entrance.x, h.entrance.y)]))
    : null;
  // Memoria del gato: sobrevive entre turnos para decidir (no solo para
  // loguear), a diferencia de modeHistory de abajo.
  const catMemory = role === 'cat' ? { persecucionQueso: null } : null;

  // Historial de modos: SOLO para el registro (prevMode, bounce), nunca
  // para decidir (DISENO_V1.md §2).
  const modeHistory = [];

  return function act(obs) {
    if (obs.turn === 1) logEntrances(map, obs, role);

    const decision = role === 'cat'
      ? decideCat(obs, graph, mouseGraphForCat, entranceByHole, catMemory)
      : decideMouse(obs, graph, holeKeys, catGraph, holeEntranceKeys);

    const prevMode = modeHistory.length ? modeHistory[modeHistory.length - 1] : null;
    modeHistory.push(decision.mode);
    if (modeHistory.length > 3) modeHistory.shift();
    const bounce = detectBounce(modeHistory);

    const logLine = buildLogFields(
      obs, role, decision.mode, prevMode, bounce, decision.target, decision.dist,
      decision.catDist, decision.deviated, decision.margin,
    );
    console.log('D|' + JSON.stringify(logLine));

    const action = { move: decision.move, debug: clampText(decision.debug, rules.debugMaxChars) };
    if (decision.path) {
      const debugTiles = routeToDebugTiles(decision.path, rules.debugMaxTiles);
      if (debugTiles.length) action.debugTiles = debugTiles;
    }
    return action;
  };
}