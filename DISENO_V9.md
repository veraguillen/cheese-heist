# Especificación v9 — Midnight Kitchen

Solo cambia el RATÓN. El gato NO cambia.

**BASE**: v8. (Nota de PASO 0: en git no existe la etiqueta `v8` — v8 nunca
se commiteó, consistente con el "no hagas commit" de esa tarea. `bot.js`
coincide BYTE A BYTE con el snapshot `bot_v8.js` generado en esa misma
tarea, así que se confirmó v8 como base por ese camino en vez de por tag.
`bot_v7.js` sí corresponde a la etiqueta `v7` existente.)

## EVIDENCIA (logs de v5 y v6)
- 24 de 27 capturas del ratón fueron llevando queso en el análisis de
  rivales; en un turno pesado (h=1) el riesgo de captura se multiplica por 13.
- Margen de carrera en el pickup = distancia del gato (visto o recordado) a
  la entrada del mejor agujero − distancia del ratón al agujero / (1 − 0,27).
  Pickups que terminaron en captura: media −8,1 (p90 −1,5). Pickups que
  terminaron en entrega: media +3,4, mediana +5.
- Con el umbral −4 se habrían evitado 207 capturas a costa de 66 entregas
  (cota optimista). La mitad de las capturas ocurre sin gato visto ni
  recordado: ahí la regla no actúa.
- pPesado (turnos con h=1 sobre turnos con queso) va de 0,25 a 0,29 en todas
  las casas: se usa una constante.
- Hoy IR_AL_QUESO solo busca la ruta segura HASTA el queso; el tramo hasta
  el agujero recién se calcula después del pickup.

## HIPÓTESIS
Si el ratón descarta los quesos desde los que el gato le gana la carrera al
agujero, espero que bajen las capturas llevando queso sin perder muchas
entregas, porque hoy levanta quesos que ya tiene perdidos antes de volver.

## CAMBIO (uno solo): CARRERA ANTES DE LEVANTAR (R-B)

1. Precálculo en `createBot` (solo ratón): para cada agujero `i`, un mapa
   de distancias BFS (grafo del ratón, sin zona de peligro) desde el
   agujero a todas las casillas: `distDesdeAgujero[i]`. Función nueva
   `bfsMapaDistancias(graph, startKey)`. Por qué: los agujeros no se
   mueven, y así la distancia queso → agujero sale de una tabla, sin BFS
   por turno.
2. Constantes con comentario del porqué: `P_PESADO = 0,27` y
   `UMBRAL_CARRERA = −4` (de los logs de v5 y v6).
3. Solo si hay gato efectivo (visto o recordado). Sin gato, todo igual que
   en la base.
4. Por turno: un mapa de distancias BFS del gato (grafo del gato) desde
   `catKey`. Para cada queso candidato `c` (después de ignorar el queso
   soltado, como en v5):
   `margen(c) = máximo sobre los agujeros i de`
   `[ distGato(entrada_i) − distDesdeAgujero[i](c) / (1 − P_PESADO) ]`
   (si el gato no llega a la entrada `i`, esa distancia cuenta como
   infinita). Si `margen(c) < UMBRAL_CARRERA`, `c` queda fuera de los
   candidatos.
5. Los quesos descartados quedan fuera en TODOS los lugares que usan los
   candidatos: `elegirQuesoObjetivo` (incluido el compromiso: si el queso
   comprometido queda descartado, se borra el compromiso) y
   `agujeroAlternativo` (el túnel no debe llevar hacia un queso descartado).
6. Si todos los quesos quedan descartados, sigue la cadena que ya existe
   (ruta segura al agujero, ESCONDIDO, ALEJARSE). No se inventa un modo
   nuevo.
7. Registro: clave nueva `"rb"` en el ratón = cantidad de quesos
   descartados este turno. Se incluye SOLO cuando es mayor que 0. Las
   líneas del ratón ya medían unos 220–247 caracteres; se verificó que no
   pasen de 260. Actualiza LOGS.md.

## REGLAS DE CÓDIGO
- Un solo archivo, sin imports. Manejar los null (sin gato, sin camino,
  gato que no llega a una entrada, queso inalcanzable).
- Funciones cortas: `bfsMapaDistancias`, `margenCarrera` y
  `filtrarQuesosPorCarrera`. Comentarios en español, cortos, con el
  porqué. No citar documentos.
- Cabecera de bot.js: v9, 5 líneas como máximo.

## PRUEBAS (scripts/casos-v9.mjs, vm, como pre-ship.mjs; mapas chicos sin
empates de BFS)
a) Dos quesos: desde A el gato gana la carrera (margen < −4); desde B no →
   el ratón va hacia B, `rb = 1`.
b) Un solo queso con margen < −4 → no va hacia él; sigue la cadena (ruta
   segura al agujero o ESCONDIDO).
c) Sin gato visto ni recordado → va al queso más cercano, como en la base,
   y sin `"rb"` en la línea D|.
d) Margen >= −4 → va al queso normal.
e) Compromiso con A; A pasa a tener margen < −4 → cambia de objetivo.
f) Dentro de un agujero, atrapado: el túnel no elige un agujero cuyo único
   queso alcanzable está descartado.
g) El caso a corrido contra la base debe FALLAR.

Correr: node scripts/casos-v9.mjs, todos los casos anteriores y
node scripts/pre-ship.mjs bot.js. Informar el tiempo máximo por act() y el
largo máximo de línea D| por rol.

## Criterios
- Capturas con queso por pickup (con gato efectivo): bajan 30 % o más.
- Entregas por partida: no bajan más de 10 %.
- Impuesto pagado por partida: no sube más de 1.
- Diferencia pareada del ratón: mejora.
