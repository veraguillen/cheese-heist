# LOGS — formato del registro del bot

El bot imprime con `console.log` una línea por turno que empieza con `D|` seguida de JSON.
El juego corta cada `console.log` a unos 300 caracteres, así que las claves son cortas.
Objetivo: cada línea mide menos de 220 caracteres, para dejar margen.

Estos datos se registran **solo para análisis**. Los campos de observación nunca se usan para decidir, salvo que una versión lo diga explícitamente en el CHANGELOG.

## Convenciones

- Booleanos: `1` = verdadero, `0` = falso.
- `null` = no aplica o no se vio.
- Casillas como texto `"x,y"` (por ejemplo `"16,12"`).
- Cada rol imprime solo sus propios campos (el gato no imprime `bl`, el ratón no imprime `sc`).

## Línea de encabezado (solo turno 1)

Ejemplo: `D|{"hdr":1,"r":"m","w":21,"hg":15,"hc":3,"ch":2,"en":[[3,1],[10,13],[19,7]]}`

| Clave | Significado | Ejemplo |
|---|---|---|
| `hdr` | Marca de encabezado (siempre 1) | `1` |
| `r` | Rol: `m` = ratón, `c` = gato | `"m"` |
| `w` | Ancho del mapa (`map.width`) | `21` |
| `hg` | Alto del mapa (`map.height`) | `15` |
| `hc` | Cantidad de agujeros | `3` |
| `ch` | Quesos en el piso en el turno 1 | `2` |
| `en` | Entradas de los agujeros, en orden de número de agujero: `[x, y]` | `[[3,1],[10,13]]` |

## Campos comunes (ratón y gato, todos los turnos)

| Clave | Significado | Ejemplo |
|---|---|---|
| `v` | Versión del bot que escribió la línea | `11` |
| `t` | Turno | `57` |
| `r` | Rol: `m` = ratón, `c` = gato | `"c"` |
| `md` | Modo elegido este turno (v2 suma `ALEJARSE`; v3 suma `EMBOSCADA`, gato; v5 suma `SOLTAR`, ratón; v7 suma `CAMBIAR_AGUJERO`, ratón; v8 suma `RONDA`, gato, descartado; v10 suma `CENTINELA`, gato; v11 suma `INTERCEPTAR`, `PATRULLA`, `QUESO`, `VOLVER` y otros modos nuevos) | `"QUESO"` |
| `pm` | Modo del turno anterior (`null` en el turno 1) | `"VOLVER"` |
| `b` | Rebote: patrón A, B, A en los últimos 3 turnos (`1`/`0`) | `0` |
| `x`, `y` | Posición propia al decidir (antes de moverse) | `13`, `11` |
| `tg` | Casilla objetivo `"x,y"`, o `null` | `"16,12"` |
| `d` | Distancia BFS al objetivo, o `null` | `15` |
| `ch` | Quesos en el piso | `3` |
| `vc` | Casillas visibles este turno | `31` |
| `ev` | Tipos de evento del turno anterior | `["pickup"]` |

## Campos solo del ratón

| Clave | Significado | Ejemplo |
|---|---|---|
| `c` | Lleva queso (`1`/`0`) | `1` |
| `h` | Pesado este turno: moverse no hace nada (`1`/`0`) | `0` |
| `ih` | Número de agujero en el que está, o `null` | `2` |
| `bl` | Cascabel: distancia aproximada al gato, o `null` si no se oye | `13.2` |
| `bL` | Cascabel fuerte: el gato hizo sprint (`1`/`0`) | `1` |
| `cat` | Gato visto: `[x, y, dirección, estamina]`, o `null` | `[16,10,"W",28]` |
| `cd` | (v2) Distancia por camino real del gato al ratón, o `null` | `4` |
| `dv` | (v2) Ruta segura distinta de la directa (`1`/`0`), o `null` si no se ve al gato | `1` |
| `mg` | (v3) Margen del agujero elegido en VOLVER, o `null` si no aplica | `3` |
| `gm` | (v5) Gato recordado y no visto este turno (`1`), visto (`0`), o `null` si no hay gato (visto ni recordado) | `1` |
| `qs` | (v5) Se ignoró un queso soltado como candidato en IR_AL_QUESO (`1`/`0`) | `1` |
| `rb` | (v9) Cantidad de quesos descartados este turno por la carrera (R-B); la clave no aparece si es `0` | `2` |

## Campos solo del gato

| Clave | Significado | Ejemplo |
|---|---|---|
| `st` | Estamina propia | `28.5` |
| `f` | Dirección a la que mira | `"W"` |
| `sc` | Casillas con olor | `12` |
| `sm` | Olor más fuerte (0 a 1), o `null` | `0.93` |
| `mo` | Ratón visto: `[x, y, lleva queso 1/0]`, o `null` | `[16,12,1]` |
| `lk` | (v6) Dirección del `look` emitido este turno, o `null` si no se emitió | `"W"` |
| `sp` | (v7) Distancia a la que se PIDIÓ el sprint (`1` o `2`); la clave no aparece si no se pidió (no es `null`, falta) | `1` |

## Línea de emboscada a tiempo (gato, solo en el turno de un evento `pickup`)

(v5) No es la línea de cada turno: se imprime además, una vez por cada `pickup`, para explicar la decisión de `actualizarMemoriaGato` (DISENO_V5.md §3).

Ejemplo: `D|{"t":57,"r":"c","emb":1,"dg":6,"dr":9}`

| Clave | Significado | Ejemplo |
|---|---|---|
| `t` | Turno | `57` |
| `r` | Rol (siempre `"c"`, esta línea es solo del gato) | `"c"` |
| `emb` | Si el gato llega a tiempo y arma la emboscada (`1`) o sigue vigilando (`0`) | `1` |
| `dg` | dGato: distancia del gato a la entrada del agujero, o `null` si no hay camino | `6` |
| `dr` | dRatón: distancia del pickup a ese agujero por el grafo del ratón | `9` |

## Historial

- v1: claves largas (unos 390 caracteres por línea); el juego cortaba los últimos campos.
- v2: claves cortas de este documento.
- v5: ratón suma el modo `SOLTAR` (con `drop:true` en la acción) y los campos `gm` (gato recordado o visto) y `qs` (queso soltado ignorado en IR_AL_QUESO). Gato suma la línea de emboscada a tiempo (`emb`/`dg`/`dr`).
- v6: gato suma el campo `lk` (dirección del `look` emitido, o `null`).
- v7: gato suma el campo `sp` (solo en los turnos con sprint). Ratón suma
  el modo `CAMBIAR_AGUJERO` (con `tunnel: n` en la acción); reusa las
  claves `tg` y `d` que ya tenía, sin campos nuevos.
- v8: gato suma el modo `RONDA` (con 2 o más quesos en el piso, en vez de
  vigilar uno quieto); reusa `tg` (queso objetivo) y `d`, sin campos nuevos.
  (v8 perdió Elo y quedó descartado como base; v9 y v10 siguen desde v7.)
- v9: ratón suma el campo `rb` (cantidad de quesos descartados por la
  carrera al agujero; solo aparece cuando es mayor que 0).
- v10: gato suma el modo `CENTINELA` (con 1 o más quesos en el piso, en vez
  de vigilar/rondar: se ubica en la casilla más cercana a todos a la vez);
  reusa `tg` (casilla del centro) y `d`, sin campos nuevos.
- v11: todas las líneas D| incluyen `v:11` para identificar inequívocamente
  la versión; las decisiones usan los modos registrados en `md`.
