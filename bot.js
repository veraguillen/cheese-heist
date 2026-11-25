// Midnight Kitchen — bot v11.
// Ambos roles usan rutas compactas, creencias ligeras y parámetros online.

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
const P_PESADO = 0.31;
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
 * Centro (v10): la casilla del grafo del gato que minimiza la distancia
 * MÁXIMA (BFS) a todos los quesos -- así cubre a todos a la vez, en vez de
 * vigilar uno solo y dejar el resto libre (evidencia: el ratón rival casi
 * no levanta el queso vigilado, va a otro). Con 1 solo queso, su propia
 * casilla ya es el centro. Memoriza por firma de quesos: con el mismo
 * conjunto en el piso, no hace falta recalcular cada turno.
 */
function calcularCentro(obs, startKey, catGraph, memory) {
  const cheeseKeys = obs.cheese.map(([x, y]) => keyOf(x, y));
  if (cheeseKeys.length === 0) return null;
  const firma = [...cheeseKeys].sort().join('|');
  if (memory.centro && memory.centro.firma === firma) return memory.centro.key;

  let key;
  if (cheeseKeys.length === 1) {
    key = cheeseKeys[0];
  } else {
    const mapas = cheeseKeys.map((qk) => bfsMapaDistancias(catGraph, qk));
    // Un solo BFS desde el gato (no uno por candidato: con 500+ casillas,
    // pedirle a distanceBetween un BFS nuevo por cada una salía carísimo,
    // O(casillas al cuadrado) -- esto es O(casillas) una sola vez.
    const mapaGato = bfsMapaDistancias(catGraph, startKey);
    let mejor = null;
    for (const c of Object.keys(catGraph)) {
      let maxDist = 0;
      let suma = 0;
      let alcanzable = true;
      for (const mapa of mapas) {
        const d = mapa[c];
        if (d === undefined) { alcanzable = false; break; }
        if (d > maxDist) maxDist = d;
        suma += d;
      }
      if (!alcanzable) continue; // esta casilla no ve a todos los quesos
      const dGatoRaw = mapaGato[c];
      const dGato = dGatoRaw === undefined ? Infinity : dGatoRaw;
      if (
        !mejor || maxDist < mejor.maxDist
        || (maxDist === mejor.maxDist && suma < mejor.suma)
        || (maxDist === mejor.maxDist && suma === mejor.suma && dGato < mejor.dGato)
      ) {
        mejor = { key: c, maxDist, suma, dGato };
      }
    }
    key = mejor ? mejor.key : null; // null: ninguna casilla ve a todos los quesos a la vez
  }
  memory.centro = { firma, key };
  return key;
}

/**
 * CENTINELA (v10): va al centro (calcularCentro) y, al llegar, gira
 * mirando a las cuatro direcciones -- así juegan los gatos que ganan
 * (evidencia), en vez de quedarse mirando para un solo lado. Sin centro
 * posible (ninguna casilla ve a todos los quesos a la vez), cae al
 * VIGILAR_QUESO de siempre.
 */
function decideCentinela(obs, startKey, catGraph, memory) {
  const centro = calcularCentro(obs, startKey, catGraph, memory);
  if (!centro) {
    const cheeseSet = new Set(obs.cheese.map(([x, y]) => keyOf(x, y)));
    const bfs = bfsFirstStep(catGraph, startKey, (k) => cheeseSet.has(k));
    return moveResultFromBfs('VIGILAR_QUESO', bfs, 'sin centro alcanzable: vigilo el queso más cercano');
  }
  const bfs = bfsFirstStep(catGraph, startKey, (k) => k === centro);
  return moveResultFromBfs('CENTINELA', bfs, 'yendo al centro de todos los quesos');
}

/**
 * EMBOSCADA: si el ratón ya levantó un queso (memory.persecucionQueso,
 * actualizada en actualizarMemoriaGato, no acá), el gato va a esperar a la
 * entrada del agujero más cercano a ese pickup.
 *
 * Sin eso, con 1 o más quesos: CENTINELA (v10).
 */
function decideEmboscada(obs, startKey, catGraph, memory) {
  if (memory.persecucionQueso) {
    const bfs = bfsFirstStep(catGraph, startKey, (k) => k === memory.persecucionQueso);
    return moveResultFromBfs('EMBOSCADA', bfs, 'el ratón lleva queso: espero en la entrada más cercana al pickup');
  }

  if (obs.cheese.length > 0) {
    return decideCentinela(obs, startKey, catGraph, memory);
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
  if (result.mode === 'CENTINELA') {
    // v10: en el centro, gira mirando a las cuatro direcciones -- no hay
    // una sola entrada que vigilar, el punto es cubrir todos los quesos.
    return giroLook(memory);
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
 * Esquema compacto documentado en LOGS.md. `v` identifica la versión del
 * bot; el resto de los campos solo facilita analizar la decisión ya tomada.
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
    v: 11,
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
  const width = map.width;
  const height = map.height;
  const cellCount = width * height;
  const idAt = new Int32Array(cellCount);
  idAt.fill(-1);
  const xs = [];
  const ys = [];
  const chars = [];
  const tables = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = map.rows[y][x];
      if (tile !== '.' && tile !== 'T' && tile !== 'H') continue;
      const id = xs.length;
      idAt[y * width + x] = id;
      xs.push(x);
      ys.push(y);
      chars.push(tile);
      tables.push(tile === 'T' ? 1 : 0);
    }
  }

  const V = xs.length;
  const isTable = Uint8Array.from(tables);
  const floorIds = [];
  for (let id = 0; id < V; id++) if (chars[id] !== 'H') floorIds.push(id);

  const makeGraph = (includeHoles) => {
    const graph = new Int32Array(V * 4);
    graph.fill(-1);
    for (let id = 0; id < V; id++) {
      if (chars[id] === 'H') continue;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DELTA[DIRS[d]];
        const nx = xs[id] + dx;
        const ny = ys[id] + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = idAt[ny * width + nx];
        if (next < 0) continue;
        if (chars[next] !== 'H') graph[id * 4 + d] = next;
      }
    }
    if (includeHoles) {
      for (const hole of map.holes) {
        const holeId = idAt[hole.y * width + hole.x];
        const entranceId = idAt[hole.entrance.y * width + hole.entrance.x];
        if (holeId < 0 || entranceId < 0) continue;
        const d = DIRS.findIndex((dir) => {
          const [dx, dy] = DELTA[dir];
          return xs[entranceId] + dx === xs[holeId] && ys[entranceId] + dy === ys[holeId];
        });
        if (d >= 0) {
          graph[entranceId * 4 + d] = holeId;
          graph[holeId * 4 + [1, 0, 3, 2][d]] = entranceId;
        }
      }
    }
    return graph;
  };
  const catGraph = makeGraph(false);
  const mouseGraph = makeGraph(true);
  const holes = map.holes.map((hole) => ({
    id: idAt[hole.y * width + hole.x],
    entrance: idAt[hole.entrance.y * width + hole.entrance.x],
  })).filter((hole) => hole.id >= 0 && hole.entrance >= 0);

  const buildAllPairs = (graph) => {
    const dist = new Int16Array(V * V);
    const firstStep = new Int8Array(V * V);
    dist.fill(-1);
    firstStep.fill(-1);
    const queue = new Int32Array(V);
    for (let start = 0; start < V; start++) {
      const offset = start * V;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      dist[offset + start] = 0;
      firstStep[offset + start] = 4;
      while (head < tail) {
        const at = queue[head++];
        const nextDistance = dist[offset + at] + 1;
        for (let d = 0; d < 4; d++) {
          const next = graph[at * 4 + d];
          if (next < 0 || dist[offset + next] >= 0) continue;
          dist[offset + next] = nextDistance;
          firstStep[offset + next] = at === start ? d : firstStep[offset + at];
          queue[tail++] = next;
        }
      }
    }
    return { dist, firstStep };
  };

  const catPairs = V <= 900 ? buildAllPairs(catGraph) : null;
  const mousePairs = V <= 900 ? buildAllPairs(mouseGraph) : null;
  const bfsCache = new Map();
  const graphFor = (kind) => kind === 'cat' ? catGraph : mouseGraph;
  const pairsFor = (kind) => kind === 'cat' ? catPairs : mousePairs;
  const bfsFrom = (kind, start) => {
    const cacheKey = kind + ':' + start;
    if (bfsCache.has(cacheKey)) return bfsCache.get(cacheKey);
    const graph = graphFor(kind);
    const dist = new Int16Array(V);
    const parent = new Int32Array(V);
    const first = new Int8Array(V);
    const queue = new Int32Array(V);
    dist.fill(-1);
    parent.fill(-1);
    first.fill(-1);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    dist[start] = 0;
    first[start] = 4;
    while (head < tail) {
      const at = queue[head++];
      for (let d = 0; d < 4; d++) {
        const next = graph[at * 4 + d];
        if (next < 0 || dist[next] >= 0) continue;
        dist[next] = dist[at] + 1;
        parent[next] = at;
        first[next] = at === start ? d : first[at];
        queue[tail++] = next;
      }
    }
    const result = { dist, parent, first };
    if (bfsCache.size >= 64) bfsCache.delete(bfsCache.keys().next().value);
    bfsCache.set(cacheKey, result);
    return result;
  };
  const distanceId = (kind, from, to) => {
    if (from < 0 || to < 0) return Infinity;
    const pairs = pairsFor(kind);
    if (pairs) {
      const d = pairs.dist[from * V + to];
      return d < 0 ? Infinity : d;
    }
    const d = bfsFrom(kind, from).dist[to];
    return d < 0 ? Infinity : d;
  };
  const routeFromFirst = (kind, start, target, firstDir) => {
    const graph = graphFor(kind);
    const path = [start];
    let current = start;
    for (let steps = 0; current !== target && steps < V; steps++) {
      const pairs = pairsFor(kind);
      const direction = pairs
        ? pairs.firstStep[current * V + target]
        : bfsFrom(kind, current).first[target];
      if (direction < 0 || direction > 3) return null;
      current = graph[current * 4 + direction];
      if (current < 0) return null;
      path.push(current);
    }
    if (current !== target) return null;
    const d = path.length > 1 ? DIRS[firstDir === undefined ? (
      pairsFor(kind)
        ? pairsFor(kind).firstStep[start * V + target]
        : bfsFrom(kind, start).first[target]
    ) : firstDir] : 'STAY';
    return { target, dist: path.length - 1, move: d || 'STAY', path };
  };
  const routeToTarget = (kind, start, target) => {
    if (start < 0 || target < 0) return null;
    if (start === target) return { target, dist: 0, move: 'STAY', path: [start] };
    const pairs = pairsFor(kind);
    if (pairs) {
      const d = pairs.dist[start * V + target];
      if (d < 0) return null;
      return routeFromFirst(kind, start, target);
    }
    const bfs = bfsFrom(kind, start);
    if (bfs.dist[target] < 0) return null;
    const path = [];
    for (let at = target; at >= 0; at = bfs.parent[at]) {
      path.push(at);
      if (at === start) break;
    }
    path.reverse();
    return { target, dist: bfs.dist[target], move: DIRS[bfs.first[target]], path };
  };

  const weightedRoute = (kind, start, targets, blocked, penalty) => {
    if (start < 0 || !targets.length) return null;
    const goalSet = new Set(targets);
    if (goalSet.has(start)) return { target: start, dist: 0, move: 'STAY', path: [start], cost: 0 };
    const graph = graphFor(kind);
    const costs = new Float64Array(V);
    const parent = new Int32Array(V);
    const first = new Int8Array(V);
    const heap = [];
    costs.fill(Infinity);
    parent.fill(-1);
    first.fill(-1);
    costs[start] = 0;
    first[start] = 4;
    const push = (cost, id) => {
      let i = heap.length;
      heap.push([cost, id]);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= cost) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = [cost, id];
    };
    const pop = () => {
      const root = heap[0];
      const last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (true) {
          const left = i * 2 + 1;
          const right = left + 1;
          if (left >= heap.length) break;
          let child = left;
          if (right < heap.length && heap[right][0] < heap[left][0]) child = right;
          if (heap[child][0] >= last[0]) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return root;
    };
    push(0, start);
    let found = -1;
    while (heap.length) {
      const [cost, at] = pop();
      if (cost !== costs[at]) continue;
      if (goalSet.has(at)) { found = at; break; }
      for (let d = 0; d < 4; d++) {
        const next = graph[at * 4 + d];
        if (next < 0 || (blocked && blocked.has(next))) continue;
        const stepCost = 1 + (penalty ? Math.max(0, penalty(next)) : 0);
        const nextCost = cost + stepCost;
        if (nextCost >= costs[next]) continue;
        costs[next] = nextCost;
        parent[next] = at;
        first[next] = at === start ? d : first[at];
        push(nextCost, next);
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let at = found; at >= 0; at = parent[at]) {
      path.push(at);
      if (at === start) break;
    }
    path.reverse();
    return {
      target: found,
      dist: path.length - 1,
      cost: costs[found],
      move: path.length > 1 ? DIRS[first[found]] : 'STAY',
      path,
    };
  };
  const routeToAny = (kind, start, targets, blocked, penalty) => {
    if (blocked || penalty) return weightedRoute(kind, start, targets, blocked, penalty);
    let best = null;
    for (const target of targets) {
      const route = routeToTarget(kind, start, target);
      if (route && (!best || route.dist < best.dist)) best = route;
    }
    return best;
  };

  const nearestHoleDist = new Int16Array(V);
  const nearestHoleId = new Int32Array(V);
  nearestHoleDist.fill(-1);
  nearestHoleId.fill(-1);
  {
    const queue = new Int32Array(V);
    let head = 0;
    let tail = 0;
    for (const hole of holes) {
      if (nearestHoleDist[hole.id] >= 0) continue;
      nearestHoleDist[hole.id] = 0;
      nearestHoleId[hole.id] = hole.id;
      queue[tail++] = hole.id;
    }
    while (head < tail) {
      const at = queue[head++];
      for (let d = 0; d < 4; d++) {
        const next = mouseGraph[at * 4 + d];
        if (next < 0 || nearestHoleDist[next] >= 0) continue;
        nearestHoleDist[next] = nearestHoleDist[at] + 1;
        nearestHoleId[next] = nearestHoleId[at];
        queue[tail++] = next;
      }
    }
  }

  const deadEndDepth = new Uint16Array(V);
  for (const start of floorIds) {
    let degree = 0;
    for (let d = 0; d < 4; d++) if (mouseGraph[start * 4 + d] >= 0) degree++;
    if (degree !== 1) continue;
    let previous = -1;
    let current = start;
    for (let depth = 1; depth <= V; depth++) {
      if (depth > deadEndDepth[current]) deadEndDepth[current] = depth;
      if (nearestHoleDist[current] === 0) break;
      let next = -1;
      let exits = 0;
      for (let d = 0; d < 4; d++) {
        const n = mouseGraph[current * 4 + d];
        if (n >= 0 && n !== previous) { next = n; exits++; }
      }
      if (exits !== 1 || chars[next] === 'H') break;
      previous = current;
      current = next;
    }
  }

  const sprintLines = new Int32Array(V * 4);
  sprintLines.fill(-1);
  for (let id = 0; id < V; id++) {
    for (let d = 0; d < 4; d++) {
      const first = catGraph[id * 4 + d];
      if (first < 0) continue;
      sprintLines[id * 4 + d] = catGraph[first * 4 + d];
    }
  }

  const mouseBelief = new Float32Array(V);
  const catBelief = new Float32Array(V);
  const seenCount = new Uint8Array(V);
  const memory = {
    houseParams: {
      maxStamina: Number.isFinite(rules.catStaminaMax) ? rules.catStaminaMax : 0,
      sprintCost: Number.isFinite(rules.catSprintCost) ? rules.catSprintCost : 2,
      staminaRegen: 0.25,
      heavyRate: 0.31,
      tunnelTurnsPerTile: 1.5,
    },
    lastStamina: null,
    lastStaminaTurn: null,
    lastSprint: false,
    lastCatTurn: -100,
    lastMouseEvent: null,
    lastPickup: null,
    returnHole: null,
    returnHoleTurn: -1,
    tunnelStart: null,
    hiddenTurns: 0,
    lastMode: null,
    modeHistory: [],
    patrolTarget: -1,
    patrolUntil: -1,
  };

  const idOf = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return -1;
    return idAt[y * width + x];
  };
  const coords = (id) => [xs[id], ys[id]];
  const toKey = (id) => id < 0 ? null : keyOf(xs[id], ys[id]);
  const euclidean = (a, b) => a < 0 || b < 0 ? Infinity : Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
  const normalize = (belief) => {
    let sum = 0;
    for (let i = 0; i < V; i++) sum += belief[i];
    if (sum > 0) for (let i = 0; i < V; i++) belief[i] /= sum;
    return sum;
  };
  const seedUnseen = (belief, visible) => {
    belief.fill(0);
    for (const id of floorIds) {
      if (!visible[id]) belief[id] = 1;
      else if (isTable[id]) belief[id] = 0.35;
    }
    return normalize(belief);
  };
  const diffuse = (belief, graph, allowSprint) => {
    const nextBelief = new Float32Array(V);
    for (let id = 0; id < V; id++) {
      const p = belief[id];
      if (p <= 0) continue;
      let degree = 1;
      for (let d = 0; d < 4; d++) if (graph[id * 4 + d] >= 0) degree++;
      nextBelief[id] += p / degree;
      for (let d = 0; d < 4; d++) {
        const next = graph[id * 4 + d];
        if (next >= 0) nextBelief[next] += p / degree;
      }
      if (allowSprint) {
        let sprintCount = 0;
        for (let d = 0; d < 4; d++) if (sprintLines[id * 4 + d] >= 0) sprintCount++;
        if (sprintCount) {
          const sprintMass = p * 0.2 / sprintCount;
          for (let d = 0; d < 4; d++) {
            const end = sprintLines[id * 4 + d];
            if (end >= 0) nextBelief[end] += sprintMass;
          }
          nextBelief[id] -= p * 0.2;
        }
      }
    }
    return nextBelief;
  };
  const visibleMask = (obs) => {
    const mask = new Uint8Array(V);
    for (const tile of obs.visible || []) {
      if (!Array.isArray(tile)) continue;
      const id = idOf(tile[0], tile[1]);
      if (id >= 0) {
        mask[id] = 1;
        if (seenCount[id] < 255) seenCount[id]++;
      }
    }
    return mask;
  };
  const beliefTiles = (belief, limit, visible) => {
    const candidates = [];
    for (let id of floorIds) if (belief[id] > 0.005) candidates.push(id);
    candidates.sort((a, b) => belief[b] - belief[a]);
    const result = [];
    for (const id of candidates) {
      if (result.length >= limit) break;
      result.push([xs[id], ys[id], Math.min(1, belief[id] * 4)]);
    }
    if (visible && result.length < limit) {
      for (let id = 0; id < V && result.length < limit; id++) {
        if (visible[id] && isTable[id]) result.push([xs[id], ys[id], 0.25]);
      }
    }
    return result;
  };
  const updateHouseParams = (obs) => {
    const params = memory.houseParams;
    const currentStamina = role === 'cat'
      ? obs.you.stamina
      : (obs.cat ? obs.cat.stamina : null);
    if (Number.isFinite(currentStamina)) {
      params.maxStamina = Math.max(params.maxStamina, currentStamina);
      if (memory.lastStamina !== null && obs.turn === memory.lastStaminaTurn + 1) {
        const delta = currentStamina - memory.lastStamina;
        const sprintObserved = role === 'cat' ? memory.lastSprint : obs.bellLoud === true;
        if (sprintObserved && delta < 0) {
          params.sprintCost = Math.max(0.5, Math.max(params.sprintCost * 0.7, -delta));
        } else if (delta > 0 && delta < 4) {
          params.staminaRegen = params.staminaRegen * 0.7 + delta * 0.3;
        }
      }
      memory.lastStamina = currentStamina;
      memory.lastStaminaTurn = obs.turn;
    }
    if (role === 'mouse' && obs.you.carrying) {
      const wasHeavy = memory.lastHeavy === true;
      const nowHeavy = obs.you.heavy === true;
      if (memory.lastHeavy !== undefined) {
        params.heavyRate = Math.max(0.28, Math.min(0.8, params.heavyRate * 0.9 + (nowHeavy ? 0.1 : 0)));
      }
      memory.lastHeavy = nowHeavy;
    } else {
      memory.lastHeavy = undefined;
    }
  };
  const updateMouseBelief = (obs, visible) => {
    let next = diffuse(mouseBelief, mouseGraph, false);
    const events = obs.events || [];
    for (const event of events) {
      if (event.type === 'pickup' || event.type === 'dropped') {
        const anchor = idOf(event.x, event.y);
        if (anchor >= 0) {
          next.fill(0);
          next[anchor] = 1;
          memory.lastMouseEvent = { id: anchor, type: event.type, turn: obs.turn };
          memory.lastPickup = event.type === 'pickup' ? { id: anchor, turn: obs.turn } : memory.lastPickup;
        }
      } else if (event.type === 'caught') {
        const hole = holes[event.respawnHole];
        if (hole) {
          next.fill(0);
          next[hole.id] = 1;
          memory.lastMouseEvent = { id: hole.id, type: event.type, turn: obs.turn };
          memory.lastPickup = null;
        }
      } else if (event.type === 'delivered') {
        const hole = holes[event.hole];
        if (hole) {
          next.fill(0);
          next[hole.id] = 1;
          memory.lastMouseEvent = { id: hole.id, type: event.type, turn: obs.turn };
          memory.lastPickup = null;
        }
      }
      if (event.type === 'dropped') memory.lastPickup = null;
    }
    if (memory.lastMouseEvent && memory.lastMouseEvent.turn === obs.turn) {
      next = diffuse(next, mouseGraph, false);
    }
    for (let id = 0; id < V; id++) {
      if (visible[id]) {
        if (isTable[id]) next[id] *= 0.35;
        else next[id] = 0;
      }
    }
    for (const [x, y, strength] of obs.scent || []) {
      const id = idOf(x, y);
      if (id >= 0 && Number.isFinite(strength) && (!visible[id] || isTable[id])) {
        next[id] += Math.max(0, strength) * 0.08;
      }
    }
    if (obs.mouse) {
      const id = idOf(obs.mouse.x, obs.mouse.y);
      next.fill(0);
      if (id >= 0) next[id] = 1;
    }
    if (normalize(next) === 0) {
      seedUnseen(next, visible);
    }
    mouseBelief.set(next);
  };
  const updateCatBelief = (obs, visible) => {
    const hadBelief = normalize(catBelief) > 0;
    let next = hadBelief ? diffuse(catBelief, catGraph, obs.bellLoud === true) : new Float32Array(V);
    if (!hadBelief) for (const id of floorIds) next[id] = 1 / Math.max(1, floorIds.length);
    for (const id of floorIds) if (visible[id]) next[id] = 0;
    if (obs.bell !== null && Number.isFinite(obs.bell)) {
      const beforeRing = next.slice();
      const tolerance = Math.max(1.15, obs.bell * 0.12);
      let ringMass = 0;
      for (const id of floorIds) {
        if (Math.abs(euclidean(id, idOf(obs.you.x, obs.you.y)) - obs.bell) > tolerance) next[id] = 0;
        ringMass += next[id];
      }
      if (ringMass === 0) next.set(beforeRing);
    }
    if (obs.cat) {
      const catId = idOf(obs.cat.x, obs.cat.y);
      next.fill(0);
      if (catId >= 0) {
        next[catId] = 1;
        memory.lastCatTurn = obs.turn;
      }
    }
    if (normalize(next) === 0) {
      seedUnseen(next, visible);
    }
    catBelief.set(next);
  };
  const riskMapFromCatBelief = () => {
    const risk = new Float32Array(V);
    for (const catId of floorIds) {
      const p = catBelief[catId];
      if (p < 0.0001) continue;
      risk[catId] += p;
      for (let d = 0; d < 4; d++) {
        const next = catGraph[catId * 4 + d];
        if (next < 0) continue;
        risk[next] += p * 0.55;
        const sprintEnd = sprintLines[catId * 4 + d];
        if (sprintEnd >= 0) {
          risk[next] += p * 0.25;
          risk[sprintEnd] += p * 0.75;
        }
      }
    }
    return risk;
  };
  const chooseLook = (start, move, visible) => {
    let bestDir = null;
    let bestScore = 0;
    for (let d = 0; d < 4; d++) {
      const dir = DIRS[d];
      if (dir === move) continue;
      let score = 0;
      let at = start;
      for (let depth = 1; depth <= 3; depth++) {
        at = catGraph[at * 4 + d];
        if (at < 0 || visible[at]) break;
        score += (seenCount[at] === 0 ? 1 : 0.25) + (isTable[at] ? 0.5 : 0);
      }
      if (score > bestScore) { bestScore = score; bestDir = dir; }
    }
    return bestScore >= 1.5 ? bestDir : null;
  };
  const makeDecision = (obs, visible) => {
    const start = idOf(obs.you.x, obs.you.y);
    const riskMap = role === 'mouse' ? riskMapFromCatBelief() : null;
    const catSeen = role === 'mouse' && obs.cat ? idOf(obs.cat.x, obs.cat.y) : -1;
    const catId = catSeen;
    const cheeseIds = (obs.cheese || []).map(([x, y]) => idOf(x, y)).filter((id) => id >= 0);
    const remaining = Math.max(0, (Number.isFinite(obs.maxTurns) ? obs.maxTurns : rules.maxTurns) - obs.turn - 1);
    const dbgLimit = Math.min(100, Number.isFinite(rules.debugMaxTiles) ? rules.debugMaxTiles : 100);
    let decision = { move: 'STAY', mode: 'ESPERA', debug: '', path: [] };

    if (role === 'cat') {
      const mouseId = obs.mouse ? idOf(obs.mouse.x, obs.mouse.y) : -1;
      let target = -1;
      let mode = 'PATRULLA';
      if (mouseId >= 0) {
        target = mouseId;
        mode = 'PERSEGUIR';
      } else if (memory.lastPickup && obs.turn - memory.lastPickup.turn <= 18) {
        const pickup = memory.lastPickup.id;
        let bestHole = null;
        for (const hole of holes) {
          const mouseDist = distanceId('mouse', pickup, hole.entrance);
          const catDist = distanceId('cat', start, hole.entrance);
          const race = catDist - Math.ceil(mouseDist * (1 + memory.houseParams.heavyRate));
          const score = catDist + Math.max(0, -race) * 3;
          if (Number.isFinite(catDist) && (!bestHole || score < bestHole.score)) bestHole = { hole, score, catDist };
        }
        if (bestHole) {
          target = bestHole.hole.entrance;
          mode = 'INTERCEPTAR';
        }
      }
      if (target < 0) {
        let maxBelief = -1;
        for (const id of floorIds) {
          if (mouseBelief[id] > maxBelief) { maxBelief = mouseBelief[id]; target = id; }
        }
        if (maxBelief > 0.08) mode = 'OLOR';
      }
      if (target < 0 || target === start && mode === 'PATRULLA') {
        const candidateTargets = [];
        for (const hole of holes) candidateTargets.push(hole.entrance);
        for (const id of cheeseIds) candidateTargets.push(id);
        let patrol = memory.patrolTarget;
        if (patrol < 0 || obs.turn >= memory.patrolUntil || patrol === start) {
          let bestScore = Infinity;
          patrol = -1;
          for (const candidate of candidateTargets) {
            const d = distanceId('cat', start, candidate);
            const seenPenalty = seenCount[candidate] > 0 ? 2 : 0;
            const score = d + seenPenalty + (candidate === memory.patrolTarget ? 3 : 0);
            if (Number.isFinite(d) && score < bestScore) { bestScore = score; patrol = candidate; }
          }
          memory.patrolTarget = patrol;
          memory.patrolUntil = obs.turn + 8;
        }
        target = patrol;
      }
      let route = target >= 0 ? routeToTarget('cat', start, target) : null;
      if (!route && cheeseIds.length) {
        route = routeToAny('cat', start, cheeseIds);
        if (route) { target = route.target; mode = 'PATRULLA'; }
      }
      if (route) {
        decision = {
          move: route.move,
          mode,
          target: toKey(target),
          dist: route.dist,
          path: route.path.map(toKey),
          debug: mode + ' hacia ' + toKey(target),
        };
        const directMouseDist = mouseId >= 0 ? distanceId('cat', start, mouseId) : Infinity;
        let sprint = false;
        let sprintDir = -1;
        if (mouseId >= 0) {
          for (let d = 0; d < 4; d++) {
            if (sprintLines[start * 4 + d] === mouseId && obs.you.stamina >= memory.houseParams.sprintCost) {
              sprint = true;
              sprintDir = d;
              break;
            }
          }
        }
        if (!sprint && mode === 'INTERCEPTAR' && route.dist >= 2 && obs.you.stamina >= memory.houseParams.sprintCost) {
          const firstDir = DIRS.indexOf(route.move);
          const sprintEnd = sprintLines[start * 4 + firstDir];
          if (sprintEnd >= 0 && distanceId('cat', sprintEnd, target) < route.dist) sprint = true;
        }
        if (sprint) {
          decision.move = DIRS[sprintDir >= 0 ? sprintDir : DIRS.indexOf(route.move)];
          decision.sprint = true;
          decision.sp = 2;
        } else if (directMouseDist === 2 && obs.mouse && obs.you.stamina >= memory.houseParams.sprintCost) {
          const mx = xs[mouseId] - xs[start];
          const my = ys[mouseId] - ys[start];
          const d = DIRS.findIndex((dir) => DELTA[dir][0] * 2 === mx && DELTA[dir][1] * 2 === my);
          if (d >= 0 && sprintLines[start * 4 + d] === mouseId) {
            decision.move = DIRS[d];
            decision.sprint = true;
            decision.sp = 2;
          }
        }
        decision.look = chooseLook(start, decision.move, visible);
      } else {
        const fallback = DIRS.map((dir, d) => ({ dir, id: catGraph[start * 4 + d] }))
          .filter((entry) => entry.id >= 0)
          .sort((a, b) => seenCount[a.id] - seenCount[b.id])[0];
        if (fallback) {
          decision.move = fallback.dir;
          decision.mode = 'PATRULLA';
          decision.path = [toKey(start), toKey(fallback.id)];
          decision.debug = 'Patrulla activa sin objetivo visible';
        }
      }
      const eventPickup = (obs.events || []).some((event) => event.type === 'pickup');
      if (eventPickup) {
        const event = (obs.events || []).filter((item) => item.type === 'pickup').slice(-1)[0];
        const pickupId = idOf(event.x, event.y);
        if (pickupId >= 0) memory.lastPickup = { id: pickupId, turn: obs.turn };
      }
      if (mouseId >= 0) {
        mouseBelief.fill(0);
        mouseBelief[mouseId] = 1;
      }
    } else {
      if (memory.tunnelStart && !obs.you.tunneling && obs.you.inHole === memory.tunnelStart.to) {
        const fromHole = holes[memory.tunnelStart.from];
        const toHole = holes[memory.tunnelStart.to];
        const duration = obs.turn - memory.tunnelStart.turn;
        const tunnelDistance = fromHole && toHole ? distanceId('mouse', fromHole.id, toHole.id) : Infinity;
        if (duration > 0 && Number.isFinite(tunnelDistance) && tunnelDistance > 0) {
          const observedRate = duration / tunnelDistance;
          memory.houseParams.tunnelTurnsPerTile =
            memory.houseParams.tunnelTurnsPerTile * 0.7 + observedRate * 0.3;
        }
        memory.tunnelStart = null;
      }
      if (obs.you.tunneling) {
        decision = { move: 'STAY', mode: 'TUNEL', debug: 'Esperando dentro del túnel' };
        memory.hiddenTurns++;
      } else if (obs.you.inHole !== null) {
        memory.hiddenTurns++;
        const currentHole = obs.you.inHole;
        const current = holes[currentHole];
        let tunnelTarget = -1;
        let bestValue = -Infinity;
        const hidingTaxEvery = Math.max(1, rules.hidingTaxEvery || 15);
        const cheeseTargets = cheeseIds.filter((id) => {
          const toHole = nearestHoleDist[id] < 0 ? Infinity : nearestHoleDist[id];
          return toHole <= remaining * (1 - memory.houseParams.heavyRate);
        });
        for (let i = 0; i < holes.length; i++) {
          if (i === currentHole) continue;
          const hole = holes[i];
          const tunnelDistance = Math.max(1, distanceId('mouse', current ? current.id : start, hole.id));
          const tunnelTurns = Math.ceil(tunnelDistance * memory.houseParams.tunnelTurnsPerTile);
          const routeToCheese = cheeseTargets.length
            ? Math.min(...cheeseTargets.map((id) => distanceId('mouse', hole.id, id)))
            : Infinity;
          const exposedThreat = obs.bellLoud
            ? 4
            : (obs.bell !== null && obs.bell <= 5 ? (6 - obs.bell) : 0);
          const hidingTaxCost = Math.floor((memory.hiddenTurns + tunnelTurns) / hidingTaxEvery);
          const value = exposedThreat * 2 + (Number.isFinite(routeToCheese) ? 5 - routeToCheese : -10) - tunnelTurns * 0.7 - hidingTaxCost * 4;
          if (value > bestValue && tunnelTurns < remaining && (exposedThreat > 0 || routeToCheese <= 5)) {
            bestValue = value;
            tunnelTarget = i;
          }
        }
        if (tunnelTarget >= 0 && bestValue > 0) {
          decision = { move: 'STAY', tunnel: tunnelTarget, mode: 'TUNEL', debug: 'Túnel elegido por amenaza o acceso a queso' };
          memory.tunnelStart = { from: currentHole, to: tunnelTarget, turn: obs.turn };
        } else {
          decision = { move: 'STAY', mode: 'AGUJERO', debug: 'Permanezco a salvo; evito hidingTax innecesario' };
        }
      } else if (obs.you.carrying) {
        const params = memory.houseParams;
        const knownCatDistance = catId >= 0 ? distanceId('cat', start, catId) : Infinity;
        const bellDistance = Number.isFinite(obs.bell) ? obs.bell : Infinity;
        const dangerDistance = Math.min(knownCatDistance, bellDistance, obs.bellLoud ? 3 : Infinity);
        let bestHole = null;
        for (let i = 0; i < holes.length; i++) {
          const hole = holes[i];
          const dist = distanceId('mouse', start, hole.entrance);
          const margin = catId >= 0
            ? distanceId('cat', catId, hole.entrance) - Math.ceil(dist * (1 + params.heavyRate))
            : (Number.isFinite(bellDistance) ? bellDistance - dist * (1 + params.heavyRate) : 0);
          const score = dist + (catId >= 0 ? Math.max(0, 2 - margin) * 2 : (riskMap[hole.entrance] || 0) * 5);
          if (Number.isFinite(dist) && (!bestHole || score < bestHole.score)) bestHole = { i, hole, score, margin };
        }
        let selected = bestHole;
        const committed = holes[memory.returnHole];
        if (committed && selected && memory.returnHole !== selected.i) {
          const committedRoute = routeToTarget('mouse', start, committed.entrance);
          const physicallyBlocked = committedRoute && catId >= 0
            && committedRoute.path.slice(1).some((id) => id === catId);
          const alternativeClearlyBetter = bestHole.score + 3 < (
            committedRoute ? committedRoute.dist + (catId >= 0 && bestHole.margin > 2 ? 0 : 2) : Infinity
          );
          if (!physicallyBlocked || !alternativeClearlyBetter) {
            selected = {
              i: memory.returnHole,
              hole: committed,
              score: committedRoute ? committedRoute.dist : Infinity,
              margin: bestHole.margin,
            };
          }
        }
        if (selected) {
          memory.returnHole = selected.i;
          memory.returnHoleTurn = obs.turn;
        }
        const goal = selected ? selected.hole.entrance : (nearestHoleId[start] >= 0 ? holes.find((h) => h.id === nearestHoleId[start])?.entrance : -1);
        const blocked = catId >= 0 ? new Set([catId]) : null;
        const routePenalty = (id) => {
          let penalty = (riskMap[id] || 0) * 18 + deadEndDepth[id] * 0.8;
          if (isTable[id]) penalty *= 0.35;
          return penalty;
        };
        let route = goal >= 0 ? weightedRoute('mouse', start, [goal], blocked, routePenalty) : null;
        if (!route && goal >= 0 && catId >= 0) {
          const staging = [];
          for (let d = 0; d < 4; d++) {
            const neighbor = mouseGraph[goal * 4 + d];
            if (neighbor >= 0 && neighbor !== catId && chars[neighbor] !== 'H') staging.push(neighbor);
          }
          route = weightedRoute('mouse', start, staging, blocked, routePenalty);
        }
        const toHole = goal >= 0 ? distanceId('mouse', start, goal) : Infinity;
        const catCanCatchSoon = Number.isFinite(dangerDistance) && dangerDistance <= 2;
        const cannotEscape = !Number.isFinite(toHole) || toHole * (1 + params.heavyRate) > dangerDistance + 1;
        if (obs.you.heavy && catCanCatchSoon && cannotEscape) {
          decision = { move: 'STAY', drop: true, mode: 'SOLTAR', target: toKey(goal), dist: toHole, debug: 'Suelto el queso: no alcanzo el agujero antes de la captura' };
          memory.returnHole = null;
        } else if (obs.you.heavy) {
          decision = { move: 'STAY', mode: 'PESADO', target: toKey(goal), dist: toHole, debug: 'Turno pesado: conservo la ruta sin asumir movimiento' };
        } else if (route) {
          decision = {
            move: route.move,
            mode: 'VOLVER',
            target: toKey(goal),
            dist: toHole,
            path: route.path.map(toKey),
            catDist: Number.isFinite(knownCatDistance) ? knownCatDistance : null,
            debug: 'Volviendo al agujero ' + (selected ? selected.i : '?'),
          };
        }
      } else {
        const riskyCheeses = new Set();
        let eligibleCheeses = [];
        const catBeliefCandidates = [];
        let maxCatBelief = 0;
        for (const id of floorIds) maxCatBelief = Math.max(maxCatBelief, catBelief[id]);
        if (catId >= 0) catBeliefCandidates.push(catId);
        else if (Number.isFinite(obs.bell)) {
          const ownId = idOf(obs.you.x, obs.you.y);
          const tolerance = Math.max(1.15, obs.bell * 0.12);
          for (const id of floorIds) {
            if (catBelief[id] > 0 && Math.abs(euclidean(id, ownId) - obs.bell) <= tolerance) {
              catBeliefCandidates.push(id);
            }
          }
        } else if (obs.bellLoud || obs.turn - memory.lastCatTurn <= 4) {
          for (const id of floorIds) {
            if (catBelief[id] >= Math.max(0.005, maxCatBelief * 0.15)) catBeliefCandidates.push(id);
          }
        }
        const cheeseAssessment = new Map();
        for (const cheese of cheeseIds) {
          const routeDist = distanceId('mouse', start, cheese);
          const holeDist = nearestHoleDist[cheese] < 0 ? Infinity : nearestHoleDist[cheese];
          const horizonOK = routeDist + Math.ceil(holeDist * (1 + memory.houseParams.heavyRate)) <= remaining;
          let worstMargin = Infinity;
          if (catBeliefCandidates.length) {
            for (const possibleCat of catBeliefCandidates) {
              const nearestHole = holes.find((hole) => hole.id === nearestHoleId[cheese]);
              const catToHole = nearestHole
                ? distanceId('cat', possibleCat, nearestHole.entrance)
                : Infinity;
              const mouseToHole = holeDist;
              const margin = catToHole - Math.ceil(mouseToHole * (1 + memory.houseParams.heavyRate));
              worstMargin = Math.min(worstMargin, margin);
            }
          } else if (Number.isFinite(obs.bell)) {
            worstMargin = obs.bell <= 4 ? -1 : 2;
          }
          const raceOK = !Number.isFinite(worstMargin) || worstMargin >= 1;
          const ok = horizonOK && raceOK;
          cheeseAssessment.set(cheese, { ok, routeDist, holeDist, margin: worstMargin });
          if (ok) eligibleCheeses.push(cheese);
          else riskyCheeses.add(cheese);
        }
        const closeThreat = catId >= 0
          ? distanceId('cat', start, catId) <= 4
          : (Number.isFinite(obs.bell) && obs.bell <= 4) || obs.bellLoud === true;
        const escapeMode = closeThreat || eligibleCheeses.length === 0;
        if (!escapeMode && eligibleCheeses.length) {
          const blockedCheeses = new Set(riskyCheeses);
          const route = weightedRoute('mouse', start, eligibleCheeses, blockedCheeses, (id) => {
            let penalty = (riskMap[id] || 0) * 16 + deadEndDepth[id] * 0.7;
            if (isTable[id]) penalty *= 0.35;
            return penalty;
          });
          if (route) {
            const assessment = cheeseAssessment.get(route.target);
            decision = {
              move: route.move,
              mode: 'QUESO',
              target: toKey(route.target),
              dist: assessment.routeDist,
              margin: Number.isFinite(assessment.margin) ? assessment.margin : null,
              rb: riskyCheeses.size,
              path: route.path.map(toKey),
              debug: 'Queso seguro ' + toKey(route.target) + ', horizonte y carrera válidos',
            };
          }
        }
        if (decision.mode === 'ESPERA') {
          const choices = [];
          for (let d = 0; d < 4; d++) {
            const next = mouseGraph[start * 4 + d];
            if (next < 0) continue;
            const forbiddenCheese = riskyCheeses.has(next);
            const catDistance = catId >= 0 ? distanceId('cat', next, catId) : Infinity;
            const danger = catId >= 0
              ? (catDistance <= 1 ? 100 : catDistance <= 2 ? 25 : catDistance <= 4 ? 8 : 0)
              : (riskMap[next] || 0) * 50;
            const score = danger + deadEndDepth[next] * 0.4 - (isTable[next] ? 2 : 0);
            choices.push({ id: next, dir: DIRS[d], score, danger, forbiddenCheese });
          }
          const safeChoices = choices.filter((choice) => !choice.forbiddenCheese);
          const mayTakeLosingCheese = safeChoices.length === 0 || safeChoices.every((choice) => choice.danger >= 100);
          const candidates = mayTakeLosingCheese ? choices : safeChoices;
          const best = candidates.sort((a, b) => a.score - b.score)[0];
          if (best) {
            decision = {
              move: best.dir,
              mode: 'ALEJARSE',
              target: toKey(best.id),
              catDist: catId >= 0 ? distanceId('cat', start, catId) : null,
              rb: riskyCheeses.size,
              path: [toKey(start), toKey(best.id)],
              debug: best.forbiddenCheese
                ? 'Todas las salidas seguras son letales: acepto el queso perdedor para evitar captura inmediata'
                : 'Evasión: evito el gato y los quesos con carrera perdida',
            };
          } else {
            decision = { move: 'STAY', mode: 'ALEJARSE', debug: 'Sin movimiento legal' };
          }
        }
      }
      if (obs.events) {
        for (const event of obs.events) {
          if (event.type === 'hidingTax') memory.hiddenTurns = 0;
          if (event.type === 'pickup' || event.type === 'dropped' || event.type === 'caught' || event.type === 'delivered') {
            if (event.type === 'caught' || event.type === 'delivered') memory.returnHole = null;
          }
        }
      }
    }

    const debugTiles = [];
    if (decision.path) {
      for (const key of decision.path) {
        if (debugTiles.length >= dbgLimit) break;
        const [x, y] = parseKey(key);
        debugTiles.push([x, y, 1]);
      }
    }
    if (role === 'cat' && debugTiles.length < dbgLimit) {
      debugTiles.push(...beliefTiles(mouseBelief, dbgLimit - debugTiles.length, visible));
    } else if (role === 'mouse' && debugTiles.length < dbgLimit) {
      debugTiles.push(...beliefTiles(catBelief, dbgLimit - debugTiles.length, visible));
    }
    decision.debugTiles = debugTiles.slice(0, dbgLimit);
    if (typeof decision.debug !== 'string') decision.debug = '';
    return decision;
  };

  return function act(obs) {
    if (obs.turn === 1) logEntrances(map, obs, role);
    updateHouseParams(obs);
    const visible = visibleMask(obs);
    if (role === 'cat') updateMouseBelief(obs, visible);
    else updateCatBelief(obs, visible);
    const decision = makeDecision(obs, visible);
    const previousMode = memory.lastMode;
    memory.modeHistory.push(decision.mode);
    if (memory.modeHistory.length > 3) memory.modeHistory.shift();
    const bounce = detectBounce(memory.modeHistory);
    const logLine = buildLogFields(
      obs, role, decision.mode, previousMode, bounce, decision.target, decision.dist,
      decision.catDist, decision.deviated, decision.margin, undefined, decision.qs,
      decision.look, decision.sp, decision.rb,
    );
    console.log('D|' + JSON.stringify(logLine));
    const action = {
      move: decision.move,
      debug: clampText(decision.debug, rules.debugMaxChars),
    };
    if (decision.drop) action.drop = true;
    if (decision.look) action.look = decision.look;
    if (decision.sprint) action.sprint = true;
    if (decision.tunnel !== undefined) action.tunnel = decision.tunnel;
    if (decision.debugTiles && decision.debugTiles.length) action.debugTiles = decision.debugTiles;
    memory.lastMode = decision.mode;
    memory.lastSprint = role === 'cat' && decision.sprint === true;
    return action;
  };
}