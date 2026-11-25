// Midnight Kitchen — bot v9.
//
// Ratón: con el gato efectivo, descarta los quesos desde los que ya pierde
// la carrera de vuelta al agujero, antes de ir a levantarlos (ver R-B).
// Gato: sin cambios desde v7 (sprint para rematar en PERSEGUIR).

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
 * BFS completo desde startKey: distancia a TODAS las casillas alcanzables
 * (DISENO_V9.md). Los agujeros no se mueven, así que esto se calcula una
 * sola vez por agujero en createBot, no por turno.
 */
function bfsMapaDistancias(graph, startKey) {
  const dist = { [startKey]: 0 };
  const queue = [startKey];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const neighbors = graph[cur];
    if (!neighbors) continue;
    for (const dir of DIRS) {
      const next = neighbors[dir];
      if (next && !(next in dist)) {
        dist[next] = dist[cur] + 1;
        queue.push(next);
      }
    }
  }
  return dist;
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

/**
 * SOLTAR (DISENO_V5.md #1): sin ruta segura a ningún agujero, soltar cuesta
 * un turno completo, así que solo vale la pena si el gato está lejos. Con
 * cd null (el gato no tiene camino hasta el ratón) se trata como lejos,
 * mismo criterio de "null = infinito" que ya usa ALEJARSE.
 */
function soltarResult(debug) {
  return { mode: 'SOLTAR', move: 'STAY', drop: true, debug, target: null, dist: null, path: null, deviated: 1, margin: null };
}

/** Con queso: sin gato visible, al agujero más cercano (como v2); con gato visible, al de más margen (R2). */
function decideVolver(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey, catDist, memory) {
  const holeSet = new Set(holeKeys);
  const isHole = (k) => holeSet.has(k);

  if (!catKey) {
    return moveResultFromBfs('VOLVER', bfsFirstStep(mouseGraph, startKey, isHole), 'volviendo con el queso');
  }

  const elegido = bestMarginHole(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey);
  if (!elegido) {
    if (catDist === null || catDist >= 3) {
      // DISENO_V5.md #1b: queda marcado para que IR_AL_QUESO lo ignore
      // mientras el gato siga efectivo (visto o recordado).
      memory.quesoSoltado = startKey;
      return soltarResult('sin ruta segura a ningún agujero y el gato a 3 o más (cd): suelto el queso');
    }
    return alejarseResult(mouseGraph, catGraph, startKey, catKey, 'sin ruta segura a ningún agujero y el gato a 2 o menos (cd): me alejo');
  }
  const result = moveResultFromBfs('VOLVER', elegido.bfs, 'volviendo al agujero con más margen frente al gato');
  result.deviated = deviationBit(mouseGraph, startKey, isHole, elegido.bfs);
  result.margin = elegido.margin;
  return result;
}

/**
 * Compromiso (DISENO_V5.md #2): si el queso de memory.objetivoQueso sigue
 * en el piso y hay ruta (segura si hay zona de peligro), seguir yendo a ese
 * en vez de recalcular el más cercano cada turno -- así se evita el vaivén
 * de cambiar de objetivo apenas se pierde de vista al gato. Se actualiza el
 * compromiso cuando no hay uno vigente o cuando el elegido ya no sirve.
 */
function elegirQuesoObjetivo(mouseGraph, startKey, cheeseSet, dangerZone, memory) {
  if (memory.objetivoQueso && cheeseSet.has(memory.objetivoQueso)) {
    const bfs = bfsFirstStep(mouseGraph, startKey, (k) => k === memory.objetivoQueso, dangerZone);
    if (bfs) return bfs;
    memory.objetivoQueso = null; // sin ruta: hay que soltar el compromiso
  }
  const bfs = bfsFirstStep(mouseGraph, startKey, (k) => cheeseSet.has(k), dangerZone);
  if (bfs) memory.objetivoQueso = bfs.target;
  return bfs;
}

/** Fracción de turnos con queso que el ratón pasa pesado (DISENO_V9.md, logs de v5+v6: 0,25 a 0,29 en todas las casas). */
const P_PESADO = 0.27;
/** Margen de carrera bajo el cual el gato ya le gana al ratón la carrera al agujero (DISENO_V9.md, logs de v5+v6). */
const UMBRAL_CARRERA = -4;

/**
 * Margen de carrera de un queso (R-B, DISENO_V9.md): el mejor caso entre
 * todos los agujeros de (distancia del gato a la entrada) menos (distancia
 * del queso a ese agujero, dividida por 1-P_PESADO porque un ratón cargado
 * camina más lento en promedio). Si el gato no llega a una entrada, ese
 * agujero no lo hace perder la carrera (cuenta como distancia infinita).
 */
function margenCarrera(quesoKey, catDistMap, holeEntranceKeys, distDesdeAgujero) {
  let mejor = -Infinity;
  for (let i = 0; i < holeEntranceKeys.length; i++) {
    const dQueso = distDesdeAgujero[i][quesoKey];
    if (dQueso === undefined) continue; // el queso no es alcanzable desde ese agujero
    const dGatoRaw = catDistMap[holeEntranceKeys[i]];
    const dGato = dGatoRaw === undefined ? Infinity : dGatoRaw;
    const margen = dGato - dQueso / (1 - P_PESADO);
    if (margen > mejor) mejor = margen;
  }
  return mejor;
}

/**
 * R-B (DISENO_V9.md): descarta los quesos desde los que el gato ya gana la
 * carrera al agujero (margen < UMBRAL_CARRERA para TODOS los agujeros).
 * Solo tiene sentido llamarla con gato efectivo (sin gato no hay carrera
 * que perder).
 */
function filtrarQuesosPorCarrera(cheeseKeys, catKey, catGraph, holeEntranceKeys, distDesdeAgujero) {
  const catDistMap = bfsMapaDistancias(catGraph, catKey);
  const permitidos = new Set();
  let descartados = 0;
  for (const c of cheeseKeys) {
    if (margenCarrera(c, catDistMap, holeEntranceKeys, distDesdeAgujero) < UMBRAL_CARRERA) descartados++;
    else permitidos.add(c);
  }
  return { permitidos, descartados };
}

/**
 * Fila 3 de DISENO_V2.md §5: ruta segura al queso elegido (DISENO_V5.md #2);
 * si no hay, ruta segura al agujero más cercano (el modo pasa a ser VOLVER,
 * como pide el diseño). Si tampoco hay eso, ALEJARSE.
 */
function decideIrAlQueso(mouseGraph, catGraph, startKey, cheese, holeKeys, holeEntranceKeys, distDesdeAgujero, dangerZone, catKey, memory, turn) {
  const cheeseKeysRaw = cheese.map(([x, y]) => keyOf(x, y));
  // DISENO_V5.md #1b: se suelta para escapar liviano; volver por él con el
  // gato cerca anularía el escape, así que no cuenta como candidato mientras
  // haya un gato efectivo (visto o recordado).
  const ignoraSoltado = Boolean(catKey) && Boolean(memory.quesoSoltado) && cheeseKeysRaw.includes(memory.quesoSoltado);
  let cheeseKeys = ignoraSoltado ? cheeseKeysRaw.filter((k) => k !== memory.quesoSoltado) : cheeseKeysRaw;
  if (ignoraSoltado && memory.objetivoQueso === memory.quesoSoltado) memory.objetivoQueso = null;

  // R-B (DISENO_V9.md): con gato efectivo, descartar los quesos que ya
  // tiene perdidos en la carrera al agujero -- levantarlos es levantar una
  // captura casi segura.
  let rb = 0;
  if (catKey) {
    const { permitidos, descartados } = filtrarQuesosPorCarrera(cheeseKeys, catKey, catGraph, holeEntranceKeys, distDesdeAgujero);
    if (memory.objetivoQueso && !permitidos.has(memory.objetivoQueso)) memory.objetivoQueso = null;
    cheeseKeys = cheeseKeys.filter((k) => permitidos.has(k));
    rb = descartados;
  }

  const cheeseSet = new Set(cheeseKeys);
  const isCheese = (k) => cheeseSet.has(k);
  const safeCheese = elegirQuesoObjetivo(mouseGraph, startKey, cheeseSet, dangerZone, memory);
  // Mismo criterio que en decideVolver: sin gato, label igual al de v1.
  const cheeseLabel = catKey ? 'yendo al queso elegido por ruta segura' : 'yendo al queso elegido';

  let result;
  if (safeCheese) {
    result = moveResultFromBfs('IR_AL_QUESO', safeCheese, cheeseLabel);
    result.deviated = catKey ? deviationBit(mouseGraph, startKey, isCheese, safeCheese) : null;
  } else if (!catKey) {
    // Sin gato visible, v1 no tenía ningún fallback en este modo: se queda
    // en el STAY/"sin camino al objetivo" de siempre, igual que v1
    // (DISENO_V2.md §5: "si el gato no se ve... todo funciona como en v1").
    // El fallback al agujero de abajo es, por construcción, solo para
    // cuando SÍ hay zona de peligro que esquivar.
    result = moveResultFromBfs('IR_AL_QUESO', null, cheeseLabel);
  } else {
    const holeSet = new Set(holeKeys);
    const isHole = (k) => holeSet.has(k);
    const safeHole = bfsFirstStep(mouseGraph, startKey, isHole, dangerZone);
    if (safeHole) {
      // dv = 1 siempre en este tramo (DISENO_V2.md §7): v1 habría ido al
      // queso y aquí el objetivo pasó a ser un agujero, así que la ruta ya
      // es distinta de la directa de v1. Compararla contra "ir al agujero"
      // daría 0 aunque el ratón sí se desvió.
      if (safeHole.dir === 'STAY') {
        // Atrapado en el propio agujero con la entrada en peligro (v7):
        // antes de resignarse a esperar y pagar el impuesto, ver si otro
        // agujero tiene ruta segura al queso -- casi siempre la tiene.
        const actual = holeKeys.indexOf(startKey);
        const alt = agujeroAlternativo(mouseGraph, holeKeys, isCheese, dangerZone, actual, turn, memory);
        if (alt) {
          memory.ultimoTunel = { desde: actual, turno: turn };
          result = {
            mode: 'CAMBIAR_AGUJERO', move: 'STAY', tunnel: alt.hole,
            debug: `agujero ${actual} atrapado: cambio por túnel al ${alt.hole}, con ruta segura al queso`,
            target: holeKeys[alt.hole], dist: alt.bfs.dist, path: null,
          };
        } else {
          // Ya está dentro de un agujero y la entrada está en peligro, y
          // ningún otro agujero tiene ruta segura al queso: se queda. La
          // acción es la misma (STAY); se registra como ESCONDIDO y no
          // como VOLVER, porque no lleva queso y no está "volviendo" a
          // ningún lado (claridad del registro, DISENO_V2.md §5 nota bajo
          // la tabla).
          result = stayResult('ESCONDIDO', 'hay queso, pero la entrada está en peligro: me quedo adentro');
        }
      } else {
        result = moveResultFromBfs('VOLVER', safeHole, 'sin ruta segura al queso: vuelvo al agujero más cercano');
      }
      result.deviated = 1;
    } else {
      result = alejarseResult(mouseGraph, catGraph, startKey, catKey, 'sin ruta segura al queso ni al agujero: me alejo del gato');
    }
  }
  result.qs = toBit(ignoraSoltado);
  result.rb = rb;
  return result;
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

/** DISENO_V5.md #2: cuántos turnos sin ver al gato siguen contando como si lo viera. */
const MEMORIA_GATO = 10;

/** Guarda la última posición vista del gato, para usarla si luego se lo deja de ver. */
function recordarGatoVisto(obs, memory) {
  if (obs.cat) memory.ultimoGato = { key: keyOf(obs.cat.x, obs.cat.y), turn: obs.turn };
}

/**
 * Gato efectivo para decidir (DISENO_V5.md #2): el visto este turno, o el
 * recordado si se lo vio hace MEMORIA_GATO turnos o menos. `gm` queda para
 * el registro: 0 visto, 1 recordado, null si no hay gato de ningún tipo.
 */
function gatoEfectivo(obs, memory) {
  if (obs.cat) return { key: keyOf(obs.cat.x, obs.cat.y), gm: 0 };
  if (memory.ultimoGato && obs.turn - memory.ultimoGato.turn <= MEMORIA_GATO) {
    return { key: memory.ultimoGato.key, gm: 1 };
  }
  return { key: null, gm: null };
}

/**
 * DISENO_V5.md #1b: memory.quesoSoltado deja de aplicar (vuelve a ser un
 * queso normal) en cuanto no hay gato efectivo, o si ese queso ya no está
 * en el piso (lo levantó, de nuevo, o desapareció).
 */
function limpiarQuesoSoltado(obs, catKey, memory) {
  if (!memory.quesoSoltado) return;
  if (!catKey) { memory.quesoSoltado = null; return; }
  const sigueAhi = obs.cheese.some(([x, y]) => keyOf(x, y) === memory.quesoSoltado);
  if (!sigueAhi) memory.quesoSoltado = null;
}

/**
 * CAMBIAR_AGUJERO (v7): agujero j distinto del actual con ruta segura
 * (grafo del ratón, zona de peligro bloqueada) a algún queso candidato.
 * Se salta el agujero de origen del último túnel si pasaron MEMORIA_GATO
 * turnos o menos (sin vaivén: si no, podría rebotar entre dos agujeros).
 * Entre los que califican, el de ruta más corta; empate por el orden de
 * map.holes. Null si ninguno califica.
 */
function agujeroAlternativo(mouseGraph, holeKeys, isCheese, dangerZone, actual, turn, memory) {
  let best = null;
  for (let j = 0; j < holeKeys.length; j++) {
    if (j === actual) continue;
    if (memory.ultimoTunel && memory.ultimoTunel.desde === j && turn - memory.ultimoTunel.turno <= MEMORIA_GATO) continue;
    const bfs = bfsFirstStep(mouseGraph, holeKeys[j], isCheese, dangerZone);
    if (bfs && (!best || bfs.dist < best.bfs.dist)) best = { hole: j, bfs };
  }
  return best;
}

/**
 * Prioridad fija del ratón (DISENO_V1.md §3, con los cambios de
 * DISENO_V2.md §5 en negrita en el propio documento). El gato no cambia
 * (DISENO_V2.md §3): si no hay gato efectivo (ni visto ni recordado),
 * `dangerZone` queda `null`, `bfsFirstStep` no bloquea nada y el ratón
 * decide exactamente igual que en v1 — por eso las filas 1 y 4 (TUNEL y
 * ESCONDIDO ya adentro) ni se tocan, y por eso tampoco se puede llegar a
 * ALEJARSE o SOLTAR sin un gato efectivo.
 */
function decideMouse(obs, mouseGraph, holeKeys, catGraph, holeEntranceKeys, distDesdeAgujero, memory) {
  const startKey = keyOf(obs.you.x, obs.you.y);
  recordarGatoVisto(obs, memory);
  const { key: catKey, gm } = gatoEfectivo(obs, memory);
  limpiarQuesoSoltado(obs, catKey, memory);

  // cd (DISENO_V2.md §7): se calcula siempre que haya gato efectivo (visto
  // o recordado), sin importar en qué modo termine el turno.
  const catDist = catKey ? distanceBetween(catGraph, catKey, startKey) : null;

  // Zona de peligro (DISENO_V2.md §4): solo existe con gato efectivo.
  const dangerZone = catKey ? computeDangerZone(catGraph, catKey) : null;

  let result;
  if (obs.you.tunneling !== null) {
    // 1) TUNEL: sin cambios respecto de v1.
    result = stayResult('TUNEL', 'en túnel: no se puede actuar este turno');
  } else if (obs.you.carrying) {
    // 2) VOLVER. Con el queso en la mano no hay compromiso de queso que
    // mantener (DISENO_V5.md #2): se borra para no arrastrar uno viejo.
    memory.objetivoQueso = null;
    result = decideVolver(mouseGraph, catGraph, startKey, holeKeys, holeEntranceKeys, dangerZone, catKey, catDist, memory);
  } else if (obs.cheese.length > 0) {
    // 3) IR_AL_QUESO.
    result = decideIrAlQueso(mouseGraph, catGraph, startKey, obs.cheese, holeKeys, holeEntranceKeys, distDesdeAgujero, dangerZone, catKey, memory, obs.turn);
  } else if (obs.you.inHole !== null) {
    // 4) ESCONDIDO: sin cambios. "No se activa ALEJARSE estando dentro de
    // un agujero" (DISENO_V2.md §5, nota bajo la tabla).
    result = stayResult('ESCONDIDO', 'escondido, sin queso en el piso');
  } else {
    // 5) ESCONDIDO (caso raro).
    result = decideEscondidoFuera(mouseGraph, catGraph, startKey, holeKeys, dangerZone, catKey);
  }

  result.catDist = catDist;
  result.gm = gm;
  if (result.deviated === undefined) result.deviated = null;
  if (result.margin === undefined) result.margin = null; // mg solo aplica cuando R2 elige agujero
  if (result.qs === undefined) result.qs = 0; // qs solo se calcula en IR_AL_QUESO
  if (result.rb === undefined) result.rb = 0; // rb (v9) solo se calcula en IR_AL_QUESO
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
 *
 * EMBOSCADA A TIEMPO (DISENO_V5.md #3): solo vale la pena ir a esperar si el
 * gato llega a la entrada antes o al mismo tiempo que el ratón al agujero
 * (dGato <= dRaton); si no, se pierden turnos lejos de la acción y es mejor
 * seguir en VIGILAR_QUESO.
 */
function actualizarMemoriaGato(obs, catGraph, catStartKey, mouseGraphForCat, entranceByHole, memory) {
  const holeSet = new Set(Object.keys(entranceByHole));
  for (const ev of obs.events) {
    if (ev.type === 'pickup') {
      const pickupKey = keyOf(ev.x, ev.y);
      const bfsHole = bfsFirstStep(mouseGraphForCat, pickupKey, (k) => holeSet.has(k));
      if (bfsHole) {
        const dRaton = bfsHole.dist;
        const entranceKey = entranceByHole[bfsHole.target];
        const dGatoRaw = distanceBetween(catGraph, catStartKey, entranceKey);
        const dGato = dGatoRaw === null ? Infinity : dGatoRaw;
        const aTiempo = dGato <= dRaton;
        console.log('D|' + JSON.stringify({ t: obs.turn, r: 'c', emb: toBit(aTiempo), dg: dGatoRaw, dr: dRaton }));
        memory.persecucionQueso = aTiempo ? entranceKey : null;
        // v6: pickupKey viaja con persecucionQueso -- EMBOSCADA lo usa para
        // mirar hacia el pasillo por donde vuelve el ratón, no hacia el
        // agujero (ahí ya está parado).
        memory.pickupKey = aTiempo ? pickupKey : null;
      }
    } else if (ev.type === 'delivered' || ev.type === 'caught' || ev.type === 'dropped') {
      memory.persecucionQueso = null;
      memory.pickupKey = null;
    }
  }
}

/** DISENO_V5.md #4: últimas posiciones propias, para no volver sobre ellas siguiendo olor viejo. */
function recordarPosicionPropia(startKey, memory) {
  memory.posiciones.push(startKey);
  if (memory.posiciones.length > 6) memory.posiciones.shift();
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

/**
 * Primer paso BFS hacia targetKey, o null sin objetivo, sin camino o si ya
 * se está ahí (distancia 0: no hay "hacia dónde" que mirar).
 */
function primerPasoHacia(graph, startKey, targetKey) {
  if (!targetKey) return null;
  const bfs = bfsFirstStep(graph, startKey, (k) => k === targetKey);
  if (!bfs || bfs.dir === 'STAY') return null;
  return bfs.dir;
}

/**
 * D3: sin nada que vigilar (o ya parado en la entrada), mirar en rotación
 * fija N,E,S,W -- así el gato eventualmente cubre los cuatro lados en vez
 * de quedarse mirando para uno solo todo el partido.
 */
function giroLook(memory) {
  const dir = ['N', 'E', 'S', 'W'][memory.giro % 4];
  memory.giro++;
  return dir;
}

/**
 * Agujero más cercano al queso por el GRAFO DEL RATÓN (el del gato no tiene
 * los agujeros como nodo). Empate: el primero en el orden de map.holes
 * (sale solo: solo se reemplaza con una distancia estrictamente menor).
 * Devuelve el índice en holeTileKeys, o null si no hay camino a ninguno.
 */
function agujeroMasCercanoAlQueso(mouseGraphForCat, holeTileKeys, quesoKey) {
  let mejor = null;
  for (let i = 0; i < holeTileKeys.length; i++) {
    const d = distanceBetween(mouseGraphForCat, quesoKey, holeTileKeys[i]);
    if (d !== null && (mejor === null || d < mejor.dist)) mejor = { i, dist: d };
  }
  return mejor ? mejor.i : null;
}

/**
 * MIRAR HACIA LA AMENAZA (v6): con STAY en VIGILAR_QUESO o EMBOSCADA, mirar
 * hacia donde puede aparecer el ratón en vez de para cualquier lado -- hoy
 * eso pasa solo 2 de cada 10 turnos. Mientras camina (move != STAY) no hay
 * nada que mirar aparte de adelante, así que no se emite look.
 */
function elegirLook(obs, startKey, result, catGraph, mouseGraphForCat, holeTileKeys, entranceByHole, memory) {
  if (result.move !== 'STAY') return null;

  if (result.mode === 'EMBOSCADA') {
    // Ya está en la entrada (por eso es STAY): mira hacia el pasillo por
    // donde vuelve el ratón, no hacia el agujero que tiene al lado.
    return primerPasoHacia(catGraph, startKey, memory.pickupKey);
  }
  if (result.mode !== 'VIGILAR_QUESO') return null; // nunca en PERSEGUIR/SEGUIR_OLOR.

  if (obs.cheese.length === 0) return giroLook(memory); // D3: sin nada que vigilar.

  const quesoKey = result.target;
  if (!quesoKey) return null; // sin camino al queso: sin objetivo que mirar.
  const i = agujeroMasCercanoAlQueso(mouseGraphForCat, holeTileKeys, quesoKey);
  if (i === null) return null;
  const entranceKey = entranceByHole[holeTileKeys[i]];
  if (startKey === entranceKey) return giroLook(memory); // D2: ya en la entrada.
  return primerPasoHacia(catGraph, startKey, entranceKey);
}

/**
 * SPRINT PARA REMATAR (v7): con el ratón visible en línea recta (misma fila
 * o columna), a 1 o 2 casillas, devuelve { dir, d } si conviene pedir el
 * sprint; si no, null. No mira la estamina: sin la suficiente, el sprint
 * mueve 1 solo (RULES.md), así que pedirlo nunca empeora el turno.
 */
function puedeRematar(obs, graph, startKey) {
  if (!obs.mouse) return null;
  const dx = obs.mouse.x - obs.you.x;
  const dy = obs.mouse.y - obs.you.y;
  if (dx !== 0 && dy !== 0) return null; // no está en línea recta
  const d = Math.abs(dx) + Math.abs(dy);
  if (d !== 1 && d !== 2) return null; // ya está encima, o a 3 o más
  const dir = dirFromDelta(Math.sign(dx), Math.sign(dy));

  if (d === 1) {
    // Las dos casillas en esa dirección (la del ratón y la siguiente)
    // tienen que ser piso: si el ratón huye en línea recta, caminando el
    // gato quedaría otra vez a 1 -- con el sprint, en cambio, lo alcanza.
    const casillaRaton = graph[startKey] && graph[startKey][dir];
    const siguiente = casillaRaton && graph[casillaRaton] && graph[casillaRaton][dir];
    if (!siguiente) return null; // pared, agujero o fuera del mapa
    return { dir, d: 1 };
  }

  // d === 2: solo con queso (suele quedar pesado y el sprint cae justo
  // sobre su casilla) y con la casilla del medio como piso.
  if (!obs.mouse.carrying) return null;
  const medio = graph[startKey] && graph[startKey][dir];
  if (!medio) return null;
  return { dir, d: 2 };
}

/** Prioridad fija del gato: PERSEGUIR, SEGUIR_OLOR, EMBOSCADA. */
function decideCat(obs, graph, mouseGraphForCat, entranceByHole, holeTileKeysForCat, memory) {
  const startKey = keyOf(obs.you.x, obs.you.y);
  actualizarMemoriaGato(obs, graph, startKey, mouseGraphForCat, entranceByHole, memory);
  recordarPosicionPropia(startKey, memory);

  // 1) PERSEGUIR: lo tenemos a la vista, vamos directo. Nunca hay look acá.
  if (obs.mouse !== null) {
    const mouseKey = keyOf(obs.mouse.x, obs.mouse.y);
    const bfs = bfsFirstStep(graph, startKey, (k) => k === mouseKey);
    const result = moveResultFromBfs('PERSEGUIR', bfs, 'persiguiendo al ratón visible');
    result.look = null;
    const remate = puedeRematar(obs, graph, startKey);
    if (remate) {
      result.move = remate.dir;
      result.sprint = true;
      result.sp = remate.d;
      result.debug = `persiguiendo al ratón visible: sprint para rematar (d=${remate.d})`;
    }
    return result;
  }

  // 2) SEGUIR_OLOR: no se ve, pero hay rastro. Sin vaivén (DISENO_V5.md #4):
  // ignora las casillas que ya pisó en sus últimas 6 posiciones. Tampoco
  // hay look acá.
  if (obs.scent.length > 0) {
    const scentSinVaiven = obs.scent.filter(([x, y]) => !memory.posiciones.includes(keyOf(x, y)));
    const targets = strongestScentTargets(scentSinVaiven, startKey);
    if (targets.size > 0) {
      const bfs = bfsFirstStep(graph, startKey, (k) => targets.has(k));
      const result = moveResultFromBfs('SEGUIR_OLOR', bfs, 'siguiendo la casilla con más olor, sin repetir mis últimas 6 posiciones');
      result.look = null;
      return result;
    }
    // Sin casillas de olor válidas: no hago STAY, caigo a la prioridad
    // siguiente en vez de quedarme esperando sobre olor viejo. Esto también
    // cubre el caso de v3 "el olor está solo en mi propia casilla" (mismo
    // STAY sin sentido; se unifica en una sola regla, aprobado).
  }

  // 3) EMBOSCADA / VIGILAR_QUESO: sin rastro útil ni vista, cubrir el queso.
  const result = decideEmboscada(obs, startKey, graph, memory);
  result.look = elegirLook(obs, startKey, result, graph, mouseGraphForCat, holeTileKeysForCat, entranceByHole, memory);
  return result;
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
 *              gm=(v5) 1 si el gato usado es recordado (no visto este
 *                 turno), 0 si es visto, null si no hay gato (DISENO_V5.md §2)
 *              qs=(v5) 1 si este turno se ignoró un queso soltado como
 *                 candidato en IR_AL_QUESO, 0 si no (DISENO_V5.md §1b)
 *   gato     → st=estamina  f=dirección  sc=casillas con olor
 *              sm=olor más fuerte (0..1) o null
 *              mo=ratón visto [x,y,llevaQueso(1/0)] o null
 *              lk=(v6) dirección del look emitido este turno, o null
 *              sp=(v7) distancia a la que se PIDIÓ el sprint (1 o 2); la
 *                 clave no aparece si no se pidió (no es null, falta)
 * `tunneling` no tiene clave propia: su único rastro en el registro es
 * "md":"TUNEL" (ver decideMouse); no hace falta repetirlo acá. `md` también
 * puede valer "ALEJARSE" desde v2 (DISENO_V2.md §5), "EMBOSCADA" desde v3 o
 * "SOLTAR" desde v5 (DISENO_V5.md §1).
 */
function buildLogFields(obs, role, mode, prevMode, bounce, target, dist, catDist, deviated, margin, gatoRecordado, quesoIgnorado, look, sprintPedido, quesosDescartados) {
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
        gm: gatoRecordado === undefined ? null : gatoRecordado,
        qs: quesoIgnorado === undefined ? 0 : quesoIgnorado,
        // rb (v9): solo se agrega la clave cuando se descartó al menos un
        // queso por la carrera -- su ausencia ya dice "0" (LOGS.md).
        ...(quesosDescartados > 0 ? { rb: quesosDescartados } : {}),
      }
    : {
        st: obs.you.stamina,
        f: obs.you.facing,
        sc: obs.scent.length,
        sm: maxScentStrength(obs.scent),
        mo: obs.mouse ? [obs.mouse.x, obs.mouse.y, toBit(obs.mouse.carrying)] : null,
        lk: look === undefined ? null : look,
        // sp (v7): solo se agrega la clave si se pidió el sprint este
        // turno -- su ausencia ya dice "sin sprint" (LOGS.md).
        ...(sprintPedido === undefined ? {} : { sp: sprintPedido }),
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
  // R-B (v9): distancia desde cada agujero a cualquier casilla, una sola
  // vez (los agujeros no se mueven) en vez de un BFS por queso y por turno.
  const distDesdeAgujero = role === 'mouse' ? holeKeys.map((hk) => bfsMapaDistancias(graph, hk)) : null;

  // G2 necesita, desde el gato, el grafo del ratón (para ubicar el agujero
  // más cercano al queso) y la entrada de cada agujero (a dónde ir).
  const mouseGraphForCat = role === 'cat' ? buildMouseGraph(map) : null;
  const entranceByHole = role === 'cat'
    ? Object.fromEntries(map.holes.map((h) => [keyOf(h.x, h.y), keyOf(h.entrance.x, h.entrance.y)]))
    : null;
  // v6 (elegirLook) necesita las claves de los agujeros en el mismo orden
  // de map.holes, para el desempate de agujeroMasCercanoAlQueso.
  const holeTileKeysForCat = role === 'cat' ? map.holes.map((h) => keyOf(h.x, h.y)) : null;
  // Memoria del gato: sobrevive entre turnos para decidir (no solo para
  // loguear), a diferencia de modeHistory de abajo. `posiciones` es
  // DISENO_V5.md #4 (últimas 6, para no volver sobre olor viejo); `pickupKey`
  // y `giro` son de v6 (mirar hacia la amenaza).
  const catMemory = role === 'cat' ? { persecucionQueso: null, posiciones: [], pickupKey: null, giro: 0 } : null;

  // Memoria del ratón (DISENO_V5.md #2 y #1b): última vez que vio al gato,
  // el queso al que se comprometió en IR_AL_QUESO y el que acaba de soltar.
  // ultimoTunel es de v7 (CAMBIAR_AGUJERO): de dónde y cuándo tuneló por
  // última vez, para no rebotar enseguida al mismo agujero de origen.
  const mouseMemory = role === 'mouse'
    ? { ultimoGato: null, objetivoQueso: null, quesoSoltado: null, ultimoTunel: null }
    : null;

  // Historial de modos: SOLO para el registro (prevMode, bounce), nunca
  // para decidir (DISENO_V1.md §2).
  const modeHistory = [];

  return function act(obs) {
    if (obs.turn === 1) logEntrances(map, obs, role);

    const decision = role === 'cat'
      ? decideCat(obs, graph, mouseGraphForCat, entranceByHole, holeTileKeysForCat, catMemory)
      : decideMouse(obs, graph, holeKeys, catGraph, holeEntranceKeys, distDesdeAgujero, mouseMemory);

    const prevMode = modeHistory.length ? modeHistory[modeHistory.length - 1] : null;
    modeHistory.push(decision.mode);
    if (modeHistory.length > 3) modeHistory.shift();
    const bounce = detectBounce(modeHistory);

    const logLine = buildLogFields(
      obs, role, decision.mode, prevMode, bounce, decision.target, decision.dist,
      decision.catDist, decision.deviated, decision.margin, decision.gm, decision.qs, decision.look,
      decision.sp, decision.rb,
    );
    console.log('D|' + JSON.stringify(logLine));

    const action = { move: decision.move, debug: clampText(decision.debug, rules.debugMaxChars) };
    if (decision.drop) action.drop = true;
    if (decision.look) action.look = decision.look;
    if (decision.sprint) action.sprint = true;
    if (decision.tunnel !== undefined) action.tunnel = decision.tunnel;
    if (decision.path) {
      const debugTiles = routeToDebugTiles(decision.path, rules.debugMaxTiles);
      if (debugTiles.length) action.debugTiles = debugTiles;
    }
    return action;
  };
}