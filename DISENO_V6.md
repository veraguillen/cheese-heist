# Especificación v6 — Midnight Kitchen

Base: v5 (en juego, campeón). El ratón NO cambia.

## EVIDENCIA (analysis/salida/episodios.txt, 53 partidas pareadas)
- Mi gato pierde 16,1 puntos por partida frente al gato rival en la misma
  casa (IC 95 % [−19,7; −12,5]); el ratón está a la par (+0,6).
- En VIGILAR_QUESO y EMBOSCADA, mi gato mira hacia la entrada solo el 20 %
  del tiempo (de costado 38 %, de espaldas 24 %, mirando pared 17 %).
- Vio al ratón rival antes del pickup en el 8 % de los casos.
- RULES.md: el gato ve hacia adelante (la dirección de su último movimiento)
  y alrededor; con STAY la dirección no cambia; look la gira sin gastar el
  turno ("works with any move").

## HIPÓTESIS
Si el gato, cuando está quieto vigilando o emboscando, mira hacia el camino
por donde llegaría el ratón, espero que vea al ratón rival antes del pickup
más seguido y que bajen las entregas rivales, porque hoy pasa el 80 % de esos
turnos sin mirar hacia la entrada.

## CAMBIO (uno solo): MIRAR HACIA LA AMENAZA

Reglas de memoria nuevas o modificadas (memoria del gato):
- memory.pickupKey: clave "x,y" de (ev.x, ev.y) del evento pickup. Se guarda
  en el mismo momento en que se activa memory.persecucionQueso (es decir,
  solo cuando la emboscada es a tiempo, como en v5). Se borra exactamente en
  los mismos eventos que ya borran persecucionQueso (delivered, caught,
  dropped) y también cuando la emboscada no es a tiempo.
- memory.giro: contador entero, inicializado en 0. Solo se usa en el caso D3.

1. Cuándo [D1]: solo si el modo es VIGILAR_QUESO o EMBOSCADA y el movimiento
   del turno es STAY. Mientras camina, no se emite look.
2. Hacia dónde:
   - VIGILAR_QUESO [D2]: elegir el agujero más cercano al queso vigilado:
     distancia por el GRAFO DEL RATÓN desde la casilla del queso hasta la
     casilla del agujero (map.holes[i].x, map.holes[i].y). Desempate: el
     primero en el orden de map.holes. La entrada objetivo es
     map.holes[i].entrance (NO la casilla del agujero: el gato no puede
     pisarla y su grafo no la tiene).
     look = primer paso del BFS (GRAFO DEL GATO) desde la posición del gato
     hasta esa entrada.
     Si el gato ya está en esa entrada (distancia 0): usar la regla D3 (el
     ratón que sale del agujero aparece a su lado, y eso siempre lo ve).
   - EMBOSCADA: look = primer paso del BFS (GRAFO DEL GATO) desde la posición
     actual del gato hasta memory.pickupKey (el pasillo de vuelta del ratón).
   - Si no existe camino o el objetivo es null → look = null.
3. Sin queso y sin persecución (STAY "espero") [D3]:
   look = ['N','E','S','W'][memory.giro % 4]; luego memory.giro++.
4. La acción final en act() incluye look solo cuando la decisión lo trae
   (no null). Nunca en PERSEGUIR ni en SEGUIR_OLOR.
5. Registro: campo nuevo "lk" en el gato (dirección o null). Las líneas D|
   deben seguir por debajo de 220 caracteres. Actualiza LOGS.md.

## REGLAS DE CÓDIGO
- Un solo archivo, sin imports. Manejar los null (mouse, cheese vacío, sin
  camino, pickupKey null).
- Funciones cortas con un propósito: por ejemplo elegirLook(...),
  agujeroMasCercanoAlQueso(...), primerPasoHacia(...).
- Comentarios en español, cortos, con el porqué. No cites documentos de
  diseño.
- Cabecera de bot.js: v6, en 5 líneas como máximo.

## PRUEBAS (scripts/casos-v6.mjs, vm, como pre-ship.mjs; mapas chicos sin empates de BFS)
a) Gato sobre el queso, la entrada del agujero más cercano al queso queda al
   W → move STAY, look 'W', lk = 'W'.
b) EMBOSCADA: el gato está quieto en la entrada y el pickup quedó hacia el E
   por el pasillo → look 'E'.
c) PERSEGUIR (ratón visible) → sin look.
d) VIGILAR_QUESO caminando hacia el queso (no STAY) → sin look.
e) Sin queso ni persecución, 4 turnos seguidos → look N, E, S, W en ese
   orden; el quinto turno vuelve a N.
f) Después de un delivered o caught, pickupKey queda en null y EMBOSCADA no
   vuelve a usarlo.
g) VIGILAR_QUESO con el gato quieto justo en la entrada (distancia 0) → usa
   el giro de D3 (look N en el primer turno).
h) Corre el caso a contra la v5 y confirma que ahí FALLA (sin look).

Correr: node scripts/casos-v6.mjs, node scripts/casos-v5.mjs,
node scripts/casos-v3.mjs (deben pasar sin cambios) y
node scripts/pre-ship.mjs bot.js. Informar el tiempo máximo por act().
