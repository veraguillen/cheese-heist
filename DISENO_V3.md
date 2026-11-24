# Especificación v3 — Midnight Kitchen

Un cambio conceptual por rol.

## RATÓN — R2: volver al agujero con más margen

- Solo en VOLVER (lleva queso) y solo si `obs.cat !== null`. Sin gato visible, el comportamiento es idéntico a v2.
- Para cada agujero con ruta segura (mismo BFS seguro de v2, con la zona de peligro bloqueada):
  - `miDist` = distancia segura del ratón a la entrada (distancia al agujero menos 1; 0 si ya está en la entrada).
  - `distGato` = distancia del gato a la entrada por el grafo del gato (`null` → Infinity).
  - `margen` = `distGato - miDist`.
- Elegir el agujero de mayor margen. Desempate: menor `miDist` y después menor número de agujero. El paso es el primer paso de la ruta segura a ese agujero.
- Si ningún agujero tiene ruta segura: ALEJARSE, igual que en v2.
- Registro: campo nuevo `"mg"` (margen del agujero elegido; `null` si no aplica). `"dv"` mantiene su definición de v2 (comparación contra la ruta directa de v1 al agujero más cercano).
- No cambian: el radio de peligro 2, ALEJARSE, IR_AL_QUESO, ESCONDIDO, TUNEL.

## GATO — G2: emboscada en la entrada

- Prioridad: PERSEGUIR → SEGUIR_OLOR → EMBOSCADA (reemplaza a VIGILAR_QUESO).
- EMBOSCADA:
  1. Queso objetivo = el queso más cercano al gato por el grafo del gato. Si ninguno es alcanzable, no hay queso objetivo.
  2. Agujero objetivo = el agujero más cercano a ese queso por el grafo del ratón (BFS desde la casilla del queso). En `createBot`, el gato tiene que construir también el grafo del ratón (`buildMouseGraph`) para esto.
  3. Ir con BFS (grafo del gato) a la casilla de entrada de ese agujero y hacer STAY al llegar.
- Sin queso en el piso o sin queso alcanzable: ir a la última entrada elegida y esperar ahí; si nunca hubo una, STAY.
- Memoria nueva en el closure: `ultimaEmboscada` (clave de la última entrada elegida). Es la primera memoria que el gato usa para decidir.
- Sprint y look siguen sin usarse.
- Registro: `md = "EMBOSCADA"` y `tg` = la entrada elegida. Mantener cada línea D| por debajo de 220 caracteres.

## Reglas de código

- JavaScript, un solo archivo, sin imports. Manejar los null de `mouse`, `cat`, `bell`, `inHole` y `tunneling`, y el caso `cheese` vacío.
- Reutiliza las funciones que ya existen (`bfsFirstStep`, `distanceBetween`, `computeDangerZone`, `moveResultFromBfs`). Funciones nuevas cortas y con un solo propósito.
- No refactorizar el código de v2 que no toca esta versión.
