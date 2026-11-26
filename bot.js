// Midnight Kitchen — bot.
// Gato: motor de v11 (grafos tipados, creencia difundida, patrulla/intercepción).
// Ratón: restaurado a v7 (R2 + SOLTAR + memoria de gato + compromiso de
// queso + CAMBIAR_AGUJERO), sobre el mismo motor de grafos tipados del gato
// -- sin R-B (v9) ni creencia/riesgo (v11): es la última versión del ratón
// con comparación pareada completa contra la anterior (analysis/salida/v7_vs_v6.txt).
// A partir de acá, el trabajo nuevo se enfoca solo en el gato.

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

/** Dirección de (0,0) a (dx,dy) cuando son adyacentes; null si no lo son. */
function dirFromDelta(dx, dy) {
  for (const dir of DIRS) {
    const [ddx, ddy] = DELTA[dir];
    if (ddx === dx && ddy === dy) return dir;
  }
  return null;
}

/**
 * Dirección dominante de un desplazamiento (dx, dy), sin importar su
 * magnitud: el eje de mayor |delta|. Null si hay empate -- incluye tanto
 * dx=dy=0 (no se movió) como una diagonal exacta (|dx|=|dy|, ambos no
 * nulos): en los dos casos no hay un eje claramente dominante, así que el
 * llamador decide qué hacer con ese null (mirada v11: conservar el rumbo
 * anterior o caer a un segundo criterio).
 */
function axisDirection(dx, dy) {
  if (Math.abs(dx) === Math.abs(dy)) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
}

/** Giro de 90° desde una dirección: antihorario (izquierda) y horario (derecha). */
const LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };
const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };

function clampText(text, maxChars) {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
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
function buildLogFields(obs, role, mode, prevMode, bounce, target, dist, catDist, deviated, margin, gatoRecordado, quesoIgnorado, look, sprintPedido, quesosDescartados, lookMemoria, leashed) {
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
        // lm (v11): 1 si el look de este turno vino de la memoria dirigida
        // (directedLook), 0 si vino de chooseLook o no hubo look.
        lm: lookMemoria === undefined ? 0 : lookMemoria,
        // lj (correa de PERSEGUIR): 1 si había ratón visible a más de
        // PERSEGUIR_MAX_DIST (o inalcanzable) y no se lo persiguió.
        lj: leashed === undefined ? 0 : leashed,
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

  const sprintLines = new Int32Array(V * 4);
  sprintLines.fill(-1);
  for (let id = 0; id < V; id++) {
    for (let d = 0; d < 4; d++) {
      const first = catGraph[id * 4 + d];
      if (first < 0) continue;
      sprintLines[id * 4 + d] = catGraph[first * 4 + d];
    }
  }

  // ------------------------------------------------- parámetros heurísticos
  // GATO (v11): sin calibrar contra logs todavía. Quedan nombrados y juntos
  // acá para poder explicarlos y ajustarlos de una.
  const TABLE_CONCEALMENT = 0.35; // bajo una mesa cuesta más vernos/olernos
  const SPRINT_DIFFUSION_SHARE = 0.2; // fracción de la creencia del gato que salta 2 casillas en vez de 1, por si sprinteó
  const PICKUP_MEMORY_TURNS = 18; // turnos que vale la pena cortar camino a un agujero tras un pickup, antes de volver a PATRULLA
  const PATROL_HOLD_TURNS = 8; // turnos que el gato se compromete con el mismo objetivo de patrulla
  const LOOK_MEMORY_TURNS = 8; // turnos sin ver al ratón en los que vale la pena barrer hacia donde se fue, antes de volver al look genérico (valor inicial, provisional)
  const PERSEGUIR_MAX_DIST = 4; // correa de PERSEGUIR: más lejos que esto (o sin camino), perseguir a un ratón visible pero inalcanzable deja la zona de los quesos sin cubrir por nada (valor inicial, provisional)

  // RATÓN (v7, restaurado -- ver analysis/salida/v7_vs_v6.txt y DISENO_V5.md).
  const MEMORIA_GATO = 10; // turnos sin ver al gato que siguen contando como si lo viera (DISENO_V5.md §2)

  /**
   * Sprint para rematar (recupera la lógica de v7, `puedeRematar`, sobre el
   * motor de grafos tipados): con el ratón visible en línea recta, a 1 o 2
   * casillas, conviene pedir sprint en vez de caminar.
   * - A 1 casilla: caminando, el gato solo lo alcanza si el ratón se queda
   *   quieto; si huye en línea recta queda otra vez a 1 para siempre. El
   *   sprint sí lo alcanza. Exige que la casilla del ratón Y la siguiente
   *   sean piso (si no, no hay "para dónde" seguir huyendo en línea recta).
   * - A 2 casillas: el sprint cae justo sobre el ratón. Como v7, solo se
   *   pide si lleva queso (más lento, más probable que no esquive a tiempo).
   * No mira la estamina (la filtra el llamador): RULES.md dice que sin
   * estamina el sprint mueve 1 solo, así que pedirlo nunca empeora el turno.
   */
  const sprintRemate = (startId, mouseId, mouseCarrying) => {
    const dx = xs[mouseId] - xs[startId];
    const dy = ys[mouseId] - ys[startId];
    if (dx !== 0 && dy !== 0) return null; // no está en línea recta
    const d = Math.abs(dx) + Math.abs(dy);
    if (d !== 1 && d !== 2) return null;
    const dir = dirFromDelta(Math.sign(dx), Math.sign(dy));
    const dirIndex = DIRS.indexOf(dir);
    if (d === 1) {
      if (sprintLines[startId * 4 + dirIndex] < 0) return null; // pared o agujero detrás del ratón
      return { dir, d: 1 };
    }
    if (!mouseCarrying) return null;
    if (sprintLines[startId * 4 + dirIndex] !== mouseId) return null;
    return { dir, d: 2 };
  };

  const mouseBelief = new Float32Array(V);
  const seenCount = new Uint8Array(V);
  const memory = {
    houseParams: {
      maxStamina: Number.isFinite(rules.catStaminaMax) ? rules.catStaminaMax : 0,
      sprintCost: Number.isFinite(rules.catSprintCost) ? rules.catSprintCost : 2,
      staminaRegen: 0.25,
      heavyRate: 0.31,
    },
    lastStamina: null,
    lastStaminaTurn: null,
    lastSprint: false,
    lastMouseEvent: null,
    lastPickup: null,
    lastMouseSeen: null, // { x, y, turn, heading } -- última vista del ratón, para la mirada dirigida al perderlo
    lookCycle: 0, // turnos consecutivos sin ver al ratón (se resetea al volver a verlo)
    lastMode: null,
    modeHistory: [],
    patrolTarget: -1,
    patrolUntil: -1,
    // Ratón (v7): compromiso de queso, queso soltado a ignorar, última
    // posición vista del gato y origen del último túnel (anti-vaivén).
    objetivoQueso: null,
    quesoSoltado: null,
    ultimoGato: null,
    ultimoTunel: null,
  };

  const idOf = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return -1;
    return idAt[y * width + x];
  };
  const toKey = (id) => id < 0 ? null : keyOf(xs[id], ys[id]);
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
      else if (isTable[id]) belief[id] = TABLE_CONCEALMENT;
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
          const sprintMass = p * SPRINT_DIFFUSION_SHARE / sprintCount;
          for (let d = 0; d < 4; d++) {
            const end = sprintLines[id * 4 + d];
            if (end >= 0) nextBelief[end] += sprintMass;
          }
          nextBelief[id] -= p * SPRINT_DIFFUSION_SHARE;
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
  /** Estamina/costo de sprint del gato, estimados de sus propias observaciones (solo gato: el ratón restaurado de v7 no los usa). */
  const updateHouseParams = (obs) => {
    const params = memory.houseParams;
    const currentStamina = obs.you.stamina;
    if (Number.isFinite(currentStamina)) {
      params.maxStamina = Math.max(params.maxStamina, currentStamina);
      if (memory.lastStamina !== null && obs.turn === memory.lastStaminaTurn + 1) {
        const delta = currentStamina - memory.lastStamina;
        if (memory.lastSprint && delta < 0) {
          params.sprintCost = Math.max(0.5, Math.max(params.sprintCost * 0.7, -delta));
        } else if (delta > 0 && delta < 4) {
          params.staminaRegen = params.staminaRegen * 0.7 + delta * 0.3;
        }
      }
      memory.lastStamina = currentStamina;
      memory.lastStaminaTurn = obs.turn;
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
        if (isTable[id]) next[id] *= TABLE_CONCEALMENT;
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

  /**
   * Mirada dirigida al perder al ratón: en vez del look genérico de
   * `chooseLook` ("lo que no vi en 3 pasos"), barre hacia donde se fue --
   * heading -> izquierda -> heading -> derecha, un paso por turno. Null
   * (y entonces decide `chooseLook`, sin cambios) si el ratón está visible,
   * no hay memoria, o pasó más de LOOK_MEMORY_TURNS desde la última vista.
   * No toca `move` ni `sprint`, solo calcula qué devolver para `look`.
   */
  const directedLook = (obs, start) => {
    if (obs.mouse) return null; // visible: como siempre, decide chooseLook
    const seen = memory.lastMouseSeen;
    if (!seen || obs.turn - seen.turn > LOOK_MEMORY_TURNS) return null;
    // Rumbo: el guardado (puede venir de un desplazamiento neto o, si no se
    // movió o empató en diagonal, conservado de antes); si no hay ninguno,
    // la dirección hacia donde se lo vio por última vez desde acá.
    const primary = seen.heading || axisDirection(seen.x - xs[start], seen.y - ys[start]);
    if (!primary) return null; // mismo lugar o empate diagonal sin rumbo previo: sin nada claro que barrer
    const phase = memory.lookCycle % 4;
    memory.lookCycle++;
    if (phase === 0 || phase === 2) return primary;
    return phase === 1 ? LEFT_OF[primary] : RIGHT_OF[primary];
  };

  // --------------------------------------------- ratón (v7, restaurado)
  //
  // Mismas reglas que el v7 real (bot_v7.js), portadas al motor de grafos
  // tipados del gato en vez del grafo por objetos/Map de entonces: sin R-B
  // (v9) ni creencia/riesgo (v11). "Ruta segura" = BFS que no pisa la zona
  // de peligro (radio 2 del gato); "directa" = la misma búsqueda sin esa
  // restricción, para medir cuánto se desvía (dv).

  /** Zona de peligro (DISENO_V2.md §4): casillas a <=2 pasos del gato por su propio grafo, el gato incluido. */
  const dangerZoneFrom = (catId) => {
    const zone = new Set([catId]);
    let frontier = [catId];
    for (let depth = 0; depth < 2; depth++) {
      const next = [];
      for (const id of frontier) {
        for (let d = 0; d < 4; d++) {
          const n = catGraph[id * 4 + d];
          if (n >= 0 && !zone.has(n)) { zone.add(n); next.push(n); }
        }
      }
      frontier = next;
    }
    return zone;
  };

  /**
   * BFS de un paso (ratón) evitando `blocked`, hasta el primero de `targets`
   * que encuentra. Sin heap ni costos (todo paso vale 1): separado de
   * `weightedRoute` para no pagar su asignación de arrays de costo en el
   * camino caliente del ratón, que acá no hace falta.
   */
  const routeAvoiding = (start, targets, blocked) => {
    if (start < 0) return null;
    const goalSet = targets instanceof Set ? targets : new Set(targets);
    if (!goalSet.size) return null;
    if (goalSet.has(start)) return { target: start, dist: 0, move: 'STAY', path: [start] };
    const dist = new Int16Array(V).fill(-1);
    const parent = new Int32Array(V).fill(-1);
    const first = new Int8Array(V).fill(-1);
    const queue = new Int32Array(V);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    dist[start] = 0;
    let found = -1;
    while (head < tail) {
      const at = queue[head++];
      if (goalSet.has(at) && at !== start) { found = at; break; }
      for (let d = 0; d < 4; d++) {
        const next = mouseGraph[at * 4 + d];
        if (next < 0 || dist[next] >= 0 || (blocked && blocked.has(next))) continue;
        dist[next] = dist[at] + 1;
        parent[next] = at;
        first[next] = at === start ? d : first[at];
        queue[tail++] = next;
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let at = found; at >= 0; at = parent[at]) { path.push(at); if (at === start) break; }
    path.reverse();
    return { target: found, dist: dist[found], move: DIRS[first[found]], path };
  };

  /** Empaqueta un `route` de `routeAvoiding`/`routeToAny` en un resultado de modo; STAY y explica en debug si no hay camino. */
  const moveResultFromRoute = (mode, route, label) => {
    if (!route) return { mode, move: 'STAY', debug: `${label}: sin camino al objetivo`, target: null, dist: null, path: null };
    if (route.move === 'STAY') {
      return { mode, move: 'STAY', debug: `${label}: ya estoy en el objetivo`, target: toKey(route.target), dist: 0, path: route.path.map(toKey) };
    }
    return {
      mode, move: route.move,
      debug: `${label}: paso ${route.move} hacia ${toKey(route.target)} (dist ${route.dist})`,
      target: toKey(route.target), dist: route.dist, path: route.path.map(toKey),
    };
  };

  const stayResult = (mode, debug) => ({ mode, move: 'STAY', debug, target: null, dist: null, path: null });

  /** dv (DISENO_V2.md §7): compara la ruta segura contra la que habría tomado sin zona de peligro. */
  const deviationBit = (start, targets, safeRoute) => {
    const direct = routeAvoiding(start, targets, null);
    return toBit(direct.move !== safeRoute.move || direct.target !== safeRoute.target);
  };

  /** ALEJARSE (DISENO_V2.md §5): el vecino (o STAY) que más aleja del gato por el grafo DEL GATO. Desempate fijo N,S,E,W,STAY. */
  const alejarseResult = (start, catId, debug) => {
    const candidates = [];
    for (let d = 0; d < 4; d++) {
      const next = mouseGraph[start * 4 + d];
      if (next >= 0) candidates.push({ dir: DIRS[d], id: next });
    }
    candidates.push({ dir: 'STAY', id: start });
    let bestDir = 'STAY';
    let bestSafety = -1;
    for (const c of candidates) {
      const safety = distanceId('cat', catId, c.id);
      if (safety > bestSafety) { bestSafety = safety; bestDir = c.dir; }
    }
    return {
      mode: 'ALEJARSE', move: bestDir,
      debug: `${debug}: paso ${bestDir} (seguridad ${bestSafety === Infinity ? 'infinita' : bestSafety})`,
      target: null, dist: null, path: null, deviated: 1,
    };
  };

  /** R2: entre los agujeros con ruta segura, el que da más ventaja de tiempo frente al gato (no necesariamente el más cercano). */
  const bestMarginHole = (start, catId, dangerZone) => {
    let best = null;
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i];
      const route = routeAvoiding(start, [hole.id], dangerZone);
      if (!route) continue;
      // La distancia que importa es a la ENTRADA, no al agujero: un paso
      // antes de estar a salvo (dist 0 ya cuenta como "en la entrada").
      const miDist = route.dist === 0 ? 0 : route.dist - 1;
      const distGato = distanceId('cat', catId, hole.entrance);
      const margin = distGato - miDist;
      if (!best || margin > best.margin || (margin === best.margin && miDist < best.miDist)) {
        best = { i, route, margin, miDist };
      }
    }
    return best;
  };

  /** SOLTAR (DISENO_V5.md #1): sin ruta segura a ningún agujero y el gato lejos, soltar en vez de arriesgar la vuelta. */
  const soltarResult = (debug) => ({
    mode: 'SOLTAR', move: 'STAY', drop: true, debug,
    target: null, dist: null, path: null, deviated: 1, margin: null,
  });

  /** Con queso: sin gato efectivo, al agujero más cercano; con gato efectivo, al de más margen (R2). */
  const decideVolver = (start, catId, dangerZone, catDist) => {
    const holeIds = holes.map((h) => h.id);
    if (catId < 0) return moveResultFromRoute('VOLVER', routeAvoiding(start, holeIds, null), 'volviendo con el queso');

    const elegido = bestMarginHole(start, catId, dangerZone);
    if (!elegido) {
      if (catDist === null || catDist >= 3) {
        memory.quesoSoltado = start; // DISENO_V5.md #1b: para que IR_AL_QUESO lo ignore mientras el gato siga efectivo
        return soltarResult('sin ruta segura a ningún agujero y el gato a 3 o más (cd): suelto el queso');
      }
      return alejarseResult(start, catId, 'sin ruta segura a ningún agujero y el gato a 2 o menos (cd): me alejo');
    }
    const result = moveResultFromRoute('VOLVER', elegido.route, 'volviendo al agujero con más margen frente al gato');
    result.deviated = deviationBit(start, holeIds, elegido.route);
    result.margin = elegido.margin;
    return result;
  };

  /** Compromiso (DISENO_V5.md #2): seguir yendo al mismo queso mientras siga en el piso y haya ruta, en vez de recalcular cada turno. */
  const elegirQuesoObjetivo = (start, cheeseSet, dangerZone) => {
    if (memory.objetivoQueso !== null && cheeseSet.has(memory.objetivoQueso)) {
      const route = routeAvoiding(start, [memory.objetivoQueso], dangerZone);
      if (route) return route;
      memory.objetivoQueso = null; // sin ruta: se suelta el compromiso
    }
    const route = routeAvoiding(start, cheeseSet, dangerZone);
    if (route) memory.objetivoQueso = route.target;
    return route;
  };

  /**
   * CAMBIAR_AGUJERO (v7): agujero distinto del actual con ruta segura a
   * algún queso candidato. Salta el origen del último túnel si pasaron
   * MEMORIA_GATO turnos o menos (sin vaivén entre dos agujeros).
   */
  const agujeroAlternativo = (cheeseSet, dangerZone, actualIndex, turn) => {
    let best = null;
    for (let j = 0; j < holes.length; j++) {
      if (j === actualIndex) continue;
      if (memory.ultimoTunel && memory.ultimoTunel.desde === j && turn - memory.ultimoTunel.turno <= MEMORIA_GATO) continue;
      const route = routeAvoiding(holes[j].id, cheeseSet, dangerZone);
      if (route && (!best || route.dist < best.route.dist)) best = { hole: j, route };
    }
    return best;
  };

  /** Ruta segura al queso elegido; si no hay, al agujero más cercano (pasa a VOLVER o CAMBIAR_AGUJERO si está atrapado); si tampoco, ALEJARSE. */
  const decideIrAlQueso = (start, cheeseIdsRaw, catId, dangerZone, turn) => {
    const ignoraSoltado = catId >= 0 && memory.quesoSoltado !== null && cheeseIdsRaw.includes(memory.quesoSoltado);
    const cheeseIds = ignoraSoltado ? cheeseIdsRaw.filter((id) => id !== memory.quesoSoltado) : cheeseIdsRaw;
    if (ignoraSoltado && memory.objetivoQueso === memory.quesoSoltado) memory.objetivoQueso = null;

    const cheeseSet = new Set(cheeseIds);
    const cheeseLabel = catId >= 0 ? 'yendo al queso elegido por ruta segura' : 'yendo al queso elegido';
    const safeCheese = elegirQuesoObjetivo(start, cheeseSet, dangerZone);

    let result;
    if (safeCheese) {
      result = moveResultFromRoute('IR_AL_QUESO', safeCheese, cheeseLabel);
      result.deviated = catId >= 0 ? deviationBit(start, cheeseSet, safeCheese) : null;
    } else if (catId < 0) {
      result = moveResultFromRoute('IR_AL_QUESO', null, cheeseLabel);
    } else {
      const holeIds = holes.map((h) => h.id);
      const safeHole = routeAvoiding(start, holeIds, dangerZone);
      if (safeHole) {
        if (safeHole.move === 'STAY') {
          // Atrapado en el propio agujero con la entrada en peligro: antes
          // de resignarse a esperar, ver si otro agujero tiene ruta segura.
          const actual = holes.findIndex((h) => h.id === start);
          const alt = agujeroAlternativo(cheeseSet, dangerZone, actual, turn);
          if (alt) {
            memory.ultimoTunel = { desde: actual, turno: turn };
            result = {
              mode: 'CAMBIAR_AGUJERO', move: 'STAY', tunnel: alt.hole,
              debug: `agujero ${actual} atrapado: cambio por túnel al ${alt.hole}, con ruta segura al queso`,
              target: toKey(holes[alt.hole].id), dist: alt.route.dist, path: null,
            };
          } else {
            result = stayResult('ESCONDIDO', 'hay queso, pero la entrada está en peligro: me quedo adentro');
          }
        } else {
          result = moveResultFromRoute('VOLVER', safeHole, 'sin ruta segura al queso: vuelvo al agujero más cercano');
        }
        result.deviated = 1;
      } else {
        result = alejarseResult(start, catId, 'sin ruta segura al queso ni al agujero: me alejo del gato');
      }
    }
    result.qs = toBit(ignoraSoltado);
    return result;
  };

  /** Caso raro: fuera del agujero y sin queso en el piso, ruta segura al agujero más cercano; sin ruta, ALEJARSE. */
  const decideEscondidoFuera = (start, catId, dangerZone) => {
    const holeIds = holes.map((h) => h.id);
    const safe = routeAvoiding(start, holeIds, dangerZone);
    const label = catId >= 0
      ? 'sin queso y fuera del agujero: vuelvo a esconderme por ruta segura'
      : 'sin queso y fuera del agujero: vuelvo a esconderme';
    if (safe) {
      const result = moveResultFromRoute('ESCONDIDO', safe, label);
      result.deviated = catId >= 0 ? deviationBit(start, holeIds, safe) : null;
      return result;
    }
    if (catId < 0) return moveResultFromRoute('ESCONDIDO', null, label);
    return alejarseResult(start, catId, 'sin ruta segura al agujero: me alejo del gato');
  };

  /** Guarda la última posición vista del gato, para usarla si luego se lo deja de ver. */
  const recordarGatoVisto = (obs) => {
    if (obs.cat) memory.ultimoGato = { id: idOf(obs.cat.x, obs.cat.y), turn: obs.turn };
  };

  /** Gato efectivo para decidir: el visto este turno, o el recordado si fue hace MEMORIA_GATO turnos o menos. */
  const gatoEfectivo = (obs) => {
    if (obs.cat) return { id: idOf(obs.cat.x, obs.cat.y), gm: 0 };
    if (memory.ultimoGato && obs.turn - memory.ultimoGato.turn <= MEMORIA_GATO) return { id: memory.ultimoGato.id, gm: 1 };
    return { id: -1, gm: null };
  };

  /** DISENO_V5.md #1b: el queso soltado deja de ignorarse en cuanto no hay gato efectivo o ya no está en el piso. */
  const limpiarQuesoSoltado = (catId, cheeseIds) => {
    if (memory.quesoSoltado === null) return;
    if (catId < 0) { memory.quesoSoltado = null; return; }
    if (!cheeseIds.includes(memory.quesoSoltado)) memory.quesoSoltado = null;
  };

  const makeDecision = (obs, visible) => {
    const start = idOf(obs.you.x, obs.you.y);
    const cheeseIds = (obs.cheese || []).map(([x, y]) => idOf(x, y)).filter((id) => id >= 0);
    const dbgLimit = Math.min(100, Number.isFinite(rules.debugMaxTiles) ? rules.debugMaxTiles : 100);
    let decision = { move: 'STAY', mode: 'ESPERA', debug: '', path: [] };

    if (role === 'cat') {
      const mouseId = obs.mouse ? idOf(obs.mouse.x, obs.mouse.y) : -1;
      // Memoria para la mirada dirigida (directedLook): heading = eje
      // dominante del desplazamiento desde la vista anterior; si no se
      // movió (delta 0,0), se conserva el heading anterior en vez de
      // perderlo. Se resetea el ciclo de barrido cada vez que se lo ve.
      if (obs.mouse) {
        const prev = memory.lastMouseSeen;
        const heading = !prev
          ? null
          : (prev.x === obs.mouse.x && prev.y === obs.mouse.y)
            ? prev.heading
            : axisDirection(obs.mouse.x - prev.x, obs.mouse.y - prev.y);
        memory.lastMouseSeen = { x: obs.mouse.x, y: obs.mouse.y, turn: obs.turn, heading };
        memory.lookCycle = 0;
      }
      // Correa de PERSEGUIR: un ratón visible pero inalcanzable (sin camino,
      // Infinity) o demasiado lejos deja la zona de los quesos sin cubrir
      // sin ninguna chance real de alcanzarlo -- ver DISENO (correa).
      const catToMouseDist = mouseId >= 0 ? distanceId('cat', start, mouseId) : Infinity;
      const lj = toBit(mouseId >= 0 && catToMouseDist > PERSEGUIR_MAX_DIST);
      let target = -1;
      let mode = 'PATRULLA';
      if (mouseId >= 0 && catToMouseDist <= PERSEGUIR_MAX_DIST) {
        target = mouseId;
        mode = 'PERSEGUIR';
      } else if (memory.lastPickup && obs.turn - memory.lastPickup.turn <= PICKUP_MEMORY_TURNS) {
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
      // mouseId < 0 (no solo target < 0): con el ratón visible pero fuera de
      // la correa, mouseBelief ya está colapsada a su casilla exacta (la
      // colapsa updateMouseBelief todos los turnos que se lo ve, sin mirar
      // distancia) -- sin este gate, OLOR reapuntaría ahí mismo y se
      // reproduciría la persecución con otro nombre.
      if (target < 0 && mouseId < 0) {
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
          memory.patrolUntil = obs.turn + PATROL_HOLD_TURNS;
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
        const hasSprintStamina = obs.you.stamina >= memory.houseParams.sprintCost;
        let sprint = false;
        let sprintDir = -1;
        if (mouseId >= 0 && hasSprintStamina) {
          const remate = sprintRemate(start, mouseId, obs.mouse.carrying);
          if (remate) {
            sprint = true;
            sprintDir = DIRS.indexOf(remate.dir);
            decision.sp = remate.d;
          }
        }
        if (!sprint && mode === 'INTERCEPTAR' && route.dist >= 2 && hasSprintStamina) {
          const firstDir = DIRS.indexOf(route.move);
          const sprintEnd = sprintLines[start * 4 + firstDir];
          if (sprintEnd >= 0 && distanceId('cat', sprintEnd, target) < route.dist) {
            sprint = true;
            sprintDir = firstDir;
            decision.sp = 2;
          }
        }
        if (sprint) {
          decision.move = DIRS[sprintDir];
          decision.sprint = true;
        }
        const directed = directedLook(obs, start);
        decision.look = directed || chooseLook(start, decision.move, visible);
        decision.lm = toBit(Boolean(directed));
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
      decision.lj = lj;
    } else {
      recordarGatoVisto(obs);
      const { id: catId, gm } = gatoEfectivo(obs);
      limpiarQuesoSoltado(catId, cheeseIds);

      // cd (DISENO_V2.md §7): distancia real al gato efectivo (visto o
      // recordado); null si no hay gato efectivo o no le llega ningún camino.
      const catDistRaw = catId >= 0 ? distanceId('cat', catId, start) : null;
      const catDist = Number.isFinite(catDistRaw) ? catDistRaw : null;
      // Zona de peligro (DISENO_V2.md §4): solo existe con gato efectivo.
      const dangerZone = catId >= 0 ? dangerZoneFrom(catId) : null;

      if (obs.you.tunneling !== null) {
        decision = stayResult('TUNEL', 'en túnel: no se puede actuar este turno');
      } else if (obs.you.carrying) {
        memory.objetivoQueso = null; // DISENO_V5.md #2: con el queso en la mano no hay compromiso que mantener
        decision = decideVolver(start, catId, dangerZone, catDist);
      } else if (cheeseIds.length > 0) {
        decision = decideIrAlQueso(start, cheeseIds, catId, dangerZone, obs.turn);
      } else if (obs.you.inHole !== null) {
        decision = stayResult('ESCONDIDO', 'escondido, sin queso en el piso');
      } else {
        decision = decideEscondidoFuera(start, catId, dangerZone);
      }

      decision.catDist = catDist;
      decision.gm = gm;
      if (decision.deviated === undefined) decision.deviated = null;
      if (decision.margin === undefined) decision.margin = null;
      if (decision.qs === undefined) decision.qs = 0;
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
    }
    decision.debugTiles = debugTiles.slice(0, dbgLimit);
    if (typeof decision.debug !== 'string') decision.debug = '';
    return decision;
  };

  return function act(obs) {
    if (obs.turn === 1) logEntrances(map, obs, role);
    // El ratón (v7) no usa estamina del gato ni creencia difundida: solo el
    // gato paga el costo de `visibleMask`/`updateMouseBelief` cada turno.
    let visible = null;
    if (role === 'cat') {
      updateHouseParams(obs);
      visible = visibleMask(obs);
      updateMouseBelief(obs, visible);
    }
    const decision = makeDecision(obs, visible);
    const previousMode = memory.lastMode;
    memory.modeHistory.push(decision.mode);
    if (memory.modeHistory.length > 3) memory.modeHistory.shift();
    const bounce = detectBounce(memory.modeHistory);
    const logLine = buildLogFields(
      obs, role, decision.mode, previousMode, bounce, decision.target, decision.dist,
      decision.catDist, decision.deviated, decision.margin, decision.gm, decision.qs,
      decision.look, decision.sp, decision.rb, decision.lm, decision.lj,
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
