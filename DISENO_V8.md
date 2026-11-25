# Especificación v8 — Midnight Kitchen

Solo cambia el GATO. El ratón NO cambia. El sprint de v7 NO cambia.

## EVIDENCIA (analysis/salida/v7_vs_v6.txt, partes N y O)
- Mi gato está quieto (STAY) el 69–75 % de los turnos; los gatos rivales,
  el 13–18 %.
- En los turnos sin información, el ratón rival está afuera del agujero el
  88–93 % del tiempo, a unas 14 casillas de mi gato (el gato ve 6–9).
- Las entregas rivales por partida suben con la cantidad de quesos: con mi
  gato, de 2,7–3,5 (1 queso) a 5,8–7,1 (4 o más).
- El ratón rival levanta el queso que vigila mi gato solo el 4–6 % de las
  veces: lo rodea y va a otro.
- En la pierna del gato, las entregas rivales valen unos 18 puntos por
  partida y mis capturas unos 2.

## HIPÓTESIS
Si, con 2 o más quesos y sin información, el gato recorre los quesos en vez
de quedarse quieto sobre uno, espero que vea más seguido al ratón rival y
que bajen las entregas rivales, porque hoy el ratón rodea al gato quieto y
levanta otro queso que nadie vigila.

## CAMBIO (uno solo): RONDA ENTRE QUESOS

1. Dónde: en `decideEmboscada`, en la rama que hoy es VIGILAR_QUESO (sin
   `persecucionQueso`). La prioridad del gato no cambia: PERSEGUIR (con el
   sprint de v7), SEGUIR_OLOR, EMBOSCADA y recién después esta rama.
2. Con 1 solo queso en el piso: VIGILAR_QUESO exactamente como en v7.
3. Con 2 o más quesos: modo nuevo "RONDA".
   - Memoria del gato: `memory.visitas` (Map de clave de queso → último
     turno en que el gato estuvo parado sobre ese queso) y
     `memory.rondaObjetivo` (clave del queso al que va ahora, o null).
   - Elegir objetivo cuando `rondaObjetivo` es null o ese queso ya no está
     en `obs.cheese`: entre los quesos alcanzables (BFS en el grafo del
     gato), el de visita MÁS ANTIGUA (sin visita = más antigua de todas).
     Desempate: el más cercano por BFS; si sigue el empate, el primero en
     el orden de `obs.cheese`.
   - Compromiso: mientras `rondaObjetivo` siga en `obs.cheese`, seguir
     yendo a ese queso, aunque otro quede más cerca.
   - Al llegar (distancia 0): STAY ese turno, registrar
     `memory.visitas[queso] = obs.turn` y poner `rondaObjetivo = null`. En
     el turno siguiente se elige el próximo queso.
   - Si ningún queso es alcanzable: STAY, como en v7.
4. look: en RONDA con STAY, aplicar la misma regla que en VIGILAR_QUESO
   (elegirLook de v6: mirar hacia la entrada del agujero más cercano a ese
   queso). Caminando, sin look, como en v6.
5. Registro: `md = "RONDA"` y `tg` = queso objetivo. No agregar claves
   nuevas. Actualiza LOGS.md con el modo nuevo.

## REGLAS DE CÓDIGO
- Un solo archivo, sin imports. Manejar los null (cheese vacío, sin camino,
  queso que desaparece).
- Funciones cortas: por ejemplo `elegirQuesoRonda(...)` y `decideRonda(...)`.
  Comentarios en español, cortos, con el porqué. No citar documentos.
- Cabecera de bot.js: v8, 5 líneas como máximo.

## PRUEBAS (scripts/casos-v8.mjs, vm, como pre-ship.mjs; mapas chicos sin
empates de BFS)
a) 2 quesos sin visitar, A más cerca del gato → va hacia A, md RONDA.
b) El gato llega a A → STAY, md RONDA, con look; el turno siguiente se
   mueve hacia B.
c) Yendo hacia B, B sigue en el piso y A queda más cerca → sigue hacia B.
d) B desaparece mientras va hacia él → elige otro queso.
e) 1 solo queso → VIGILAR_QUESO y STAY sobre él, igual que v7.
f) EMBOSCADA activa (pickup a tiempo) → igual que v7.
g) Ratón visible a 1 en línea recta → PERSEGUIR con sprint, igual que v7.
h) El caso b (segundo turno, moverse hacia B) corrido contra v7
   (`git show v7:bot.js`) debe FALLAR.

Correr: node scripts/casos-v8.mjs y todos los casos anteriores (v7, v6, v5,
v3) y node scripts/pre-ship.mjs bot.js. Si algún caso viejo cambia por
diseño (por ejemplo, uno que esperaba STAY con 2 quesos), explicar cuál y
por qué, y ajustarlo solo si es por diseño. Informar el tiempo máximo por
act() y el largo máximo de línea D| por rol.

## Criterios
- Turnos quieto (STAY) del gato: 75 % → <= 35 %.
- Ratón rival visto en los 10 turnos antes del pickup: sube frente a v7.
- Entregas rivales por partida en casas de 2 o más quesos: bajan 1 o más.
- Casas de 1 queso: sin cambios (control dentro de la misma versión).
- Capturas de mi gato por partida: no bajan de 0,6.
