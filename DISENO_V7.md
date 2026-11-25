# Especificación v7 — Midnight Kitchen

Base: v6 (en juego).

## Gato

### CAMBIO (uno solo): SPRINT PARA REMATAR EN LÍNEA RECTA

Solo afecta la rama PERSEGUIR de `decideCat` (ratón visible). En
SEGUIR_OLOR y EMBOSCADA/VIGILAR_QUESO no cambia nada.

Con el ratón visible y en línea recta (misma fila o misma columna) a
distancia 1 o 2, el gato pide `sprint` en vez de caminar normal:

1. Distancia 1: además de estar en línea recta, la casilla del ratón y la
   siguiente en esa misma dirección tienen que ser piso. Razón: si el ratón
   huye en línea recta, el gato termina en su misma casilla; caminando
   quedaría otra vez a 1. En los demás casos el sprint atrapa igual que
   caminar.
2. Distancia 2: solo si el ratón lleva queso (`obs.mouse.carrying`) y la
   casilla del medio en esa dirección es piso. Razón: un ratón con queso
   queda pesado (no se mueve) en el 27 % de los turnos según los logs, y el
   sprint cae sobre su casilla; si se mueve, queda a 1 y en el turno
   siguiente aplica el caso distancia 1.
3. No se chequea estamina: según RULES.md, pedir `sprint` sin estamina
   suficiente simplemente mueve 1 sola casilla (igual que un move normal),
   así que pedirlo nunca empeora el turno respecto de no pedirlo.
4. Si no se cumple ninguna de las dos condiciones anteriores (no está en
   línea recta, está a 0 o a 3+, o las casillas de piso no están libres):
   sigue el comportamiento normal de PERSEGUIR (BFS hacia el ratón, sin
   sprint, sin look).
5. Acción final: `{ move: dir, sprint: true }` en vez de `{ move: dir }`.
6. Registro: campo nuevo `sp` en el gato, con la distancia a la que se pidió
   el sprint (`1` o `2`). La clave NO aparece en los turnos sin sprint (no
   es `null`, falta directamente). Actualiza LOGS.md.

### Piso

`Piso` = `'.'` o `'T'` del grafo del gato.

## Evidencia

- 0 de 117 oportunidades a distancia 2 terminaron en captura.
- Capturas: 0,37 por partida en v6.
- RULES.md: captura en la misma casilla o cruzándose, y el sprint revisa las
  dos casillas.
- `pPesado = 0,27`.

## Hipótesis

Si el gato sprinta con el ratón en línea recta a 1, o a 2 con queso, suben
las capturas, porque caminando nunca descuenta distancia.

## Criterios

- Capturas: 0,37 → >= 0,8 por partida.
- Conversión de `sp=1` (mismo turno): >= 30 %.
- Conversión de `sp=2` (ese turno o el siguiente): >= 20 %.
- Diferencia pareada del gato mejora en 2 o más.

## Ratón

### Evidencia

- 39 turnos por partida atrapado en un agujero con queso en el piso y la
  entrada en peligro.
- Impuesto pagado: 308 puntos en total.
- En el 100 % de esos turnos había otro agujero con ruta segura al queso.
- Los ratones rivales usan 4,5 túneles por partida; en el 39 % de esos casos
  mi gato estaba cerca de su entrada.

### Hipótesis

Si el ratón atrapado viaja por túnel a otro agujero con ruta segura al queso,
bajan los turnos atrapado y el impuesto y suben las entregas, porque hoy
espera adentro aunque siempre hay otra salida.

### Cambio: CAMBIAR DE AGUJERO POR TÚNEL

Solo afecta el caso de `IR_AL_QUESO` que termina en `ESCONDIDO` porque no hay
ruta segura al queso y el ratón ya está en un agujero. El resto del ratón no
cambia.

1. **Cuándo:** no hay túnel en curso ni queso encima; hay queso candidato en
   el piso, tras ignorar el queso soltado cuando corresponde; hay un gato
   efectivo (visto o recordado); no hay ruta segura al queso desde la
   posición actual y la ruta segura al agujero devuelve `STAY` porque el
   ratón ya está dentro. En el caso previsto, su entrada está en peligro.
2. **Candidatos:** cada agujero `j` distinto del actual desde el que existe
   ruta segura a algún queso candidato. El BFS parte del agujero `j` en el
   grafo del ratón y bloquea la zona de peligro; así se descartan las rutas
   que pasan por una entrada en peligro.
3. **Elección:** el agujero candidato con la ruta segura más corta al queso.
   En empate, se conserva el primero según el orden de `map.holes`.
4. **Sin vaivén:** se excluye el agujero de origen del último túnel durante
   los 10 turnos siguientes. Se guarda
   `memory.ultimoTunel = { desde, turno }` y se reutiliza `MEMORIA_GATO`.
5. **Acción y modo:** al encontrar candidato `j`, la acción es
   `{ move: 'STAY', tunnel: j }` y el modo es `CAMBIAR_AGUJERO`. Se registran
   el agujero destino en `tg` y la distancia de la ruta segura en `d`, sin
   agregar claves al registro del ratón. Si no hay candidato, se queda en
   `ESCONDIDO` con `STAY`, igual que en v6.

### Criterios

- Turnos atrapado: 39 → <= 15 por partida.
- Las entregas por partida suben.
- El impuesto pagado baja.

## REGLAS DE CÓDIGO

- Un solo archivo, sin imports. Manejar los null (`obs.mouse` null, sin
  camino, fuera del mapa, sin agujero alternativo).
- Función corta y propia para cada decisión: `puedeRematar(...)` (gato),
  `agujeroAlternativo(...)` (ratón).
- Comentarios en español, cortos, con el porqué. No citar documentos de
  diseño.
- Cabecera de bot.js: v7, en 5 líneas como máximo (una línea de ratón, una
  de gato).

## PRUEBAS (scripts/casos-v7.mjs, vm, como pre-ship.mjs; mapas chicos sin empates de BFS)

a) Ratón visible, línea recta a distancia 1, camino libre en esa dirección
   → sprint, `sp=1`, move hacia el ratón.
b) Ratón visible, línea recta a distancia 1, pero la casilla siguiente a la
   del ratón es pared/borde → sin sprint, PERSEGUIR normal (BFS).
c) Ratón visible, línea recta a distancia 2, con queso (`carrying=true`) y
   casilla del medio libre → sprint, `sp=2`.
d) Igual que (c) pero sin queso (`carrying=false`) → sin sprint.
e) Ratón visible pero fuera de línea recta (diagonal) → sin sprint.
f) Ratón visible, línea recta, a distancia 3 o más → sin sprint.
g) El campo `sp` no aparece en la línea D| cuando no hubo sprint (se chequea
   con `in`, no con `=== null`).
h) SEGUIR_OLOR y EMBOSCADA no se tocan: mismo resultado que en v6 para un
   caso de cada uno.
i) Corre el caso (a) contra la v6 (`bot_v6.js`) y confirma que ahí FALLA
   (sin sprint, mueve 1 sola casilla por BFS).
j) Ratón en el agujero 0, gato visto en la entrada 0, queso con ruta segura
   desde el agujero 1 → `tunnel: 1`, `md CAMBIAR_AGUJERO`.
k) Igual, pero las dos entradas están en peligro → ESCONDIDO, sin tunnel.
l) Sin gato efectivo → sale normal por su entrada (IR_AL_QUESO), sin
   tunnel.
m) Recién llegó por túnel desde el agujero 0 al 1; ahora la entrada 1 está
   en peligro y la 0 libre → NO vuelve al 0 dentro de los 10 turnos.
n) El caso (j) corrido contra v6 (`bot_v6.js`) debe FALLAR.

Correr: node scripts/casos-v7.mjs, node scripts/casos-v6.mjs,
node scripts/casos-v5.mjs, node scripts/casos-v3.mjs (deben pasar sin
cambios) y node scripts/pre-ship.mjs bot.js tres veces. Informar mediana y
p99 del tiempo por act() del gato (sin turno 1) y el largo máximo de línea D|
por rol (ratón y gato).
