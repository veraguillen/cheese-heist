# Especificación v1 — Midnight Kitchen

Estado: **aprobada por Vera el 23 nov** (incluye el registro extra de variables de observación). Todas las decisiones de diseño las tomó Vera; la IA presentó opciones y trade-offs.
Fecha: 23 nov.

## 1. Hipótesis y objetivo

**Objetivo (hito):** pasar de "no juega" a "juega" y obtener una línea base medida. La primera subida es v1 (v0 no se sube; ver CHANGELOG).

**Concepto único:** moverse con BFS por caminos reales hacia el objetivo de cada modo, en los dos roles (el match suma gato + ratón).

**Lo que se pone a prueba (puede fallar):**
1. La prioridad fija entre modos evita rebotes → se registran los cambios de modo A→B→A en 3 turnos o menos (solo observación, sin umbral).
2. Esperar adentro cuando no hay queso cuesta poco → `hidingTax` ≤ entregas por partida del ratón.
3. Pregunta abierta, sin predicción: ¿cómo le va contra Timothy?

**Riesgo aceptado:** el ratón no reacciona al gato mientras va o vuelve (no hay HUIR) ni al salir del agujero (se quitó la regla de seguridad de la entrada, para no mezclar efectos).

## 2. Arquitectura en capas

1. **Precálculo en `createBot`:** casillas pisables, vecinas, BFS.
2. **Decisión por modos** con prioridad fija (máquina de estados).
3. **Movimiento:** un paso BFS hacia el objetivo del modo. Desempate fijo: N, S, E, W.
4. **Registro:** `console.log('D|' + JSON)` por turno + `debug` + `debugTiles` (la ruta).

Sin memoria entre turnos en v1 (empieza en v2).

## 3. Ratón — prioridad fija (gana el primero que se cumple)

| # | Condición | Modo | Acción |
|---|---|---|---|
| 1 | `tunneling != null` | TUNEL | `STAY` |
| 2 | `carrying` | VOLVER | paso BFS al agujero más cercano (no tiene que ser el de salida) |
| 3 | `cheese.length > 0` | IR_AL_QUESO | paso BFS al queso más cercano (si está dentro de un agujero, el primer paso es la `entrance`) |
| 4 | `inHole != null` (sin queso en el piso) | ESCONDIDO | `STAY` |
| 5 | fuera del agujero y sin queso en el piso (caso raro; **confirmado por Vera**, se vigila en los datos) | ESCONDIDO | paso BFS al agujero más cercano |

Ya no hay regla de seguridad: el ratón sale en cuanto hay queso, sin mirar al gato.
Si está `heavy`, se envía el movimiento igual (no hace nada ese turno).

## 4. Gato — prioridad fija

| # | Condición | Modo | Acción |
|---|---|---|---|
| 1 | `mouse != null` | PERSEGUIR | paso BFS hacia el ratón |
| 2 | `scent` no vacío | SEGUIR_OLOR | paso BFS hacia la casilla con más olor (se ignora la casilla propia) |
| 3 | `cheese.length > 0` | VIGILAR_QUESO | paso BFS al queso más cercano |
| 4 | si no | VIGILAR_QUESO | `STAY` |

Si no hay camino al objetivo → `STAY` y se anota en `debug`.

## 5. Reglas técnicas

- JavaScript, un solo archivo, sin imports, modular, comentarios en español que expliquen el porqué.
- El BFS del ratón usa `H` solo como destino o como casilla de partida, nunca como camino intermedio. El gato nunca pisa `H`.
- Manejar `null` en `mouse`, `cat`, `bell`, `inHole`, `tunneling` y `cheese` vacío.
- Leer `debugMaxChars` y `debugMaxTiles` desde `setup.rules`.
- Cada `act` debe tardar pocos ms (presupuesto medio de unos 12,5 ms por turno): el BFS completo se precalcula en `createBot` o se corta al llegar al objetivo.
- Correr `node scripts/pre-ship.mjs bot.js` antes de subir.
- **Desempates (supuestos propuestos por la IA, aceptados por Vera):** si varios quesos u objetivos empatan en distancia, gana el primero que el BFS encuentra explorando N, S, E, W. Si varias casillas de olor empatan en fuerza, compiten en el mismo BFS y gana la más cercana.

## 6. Registro `D|` (una línea por turno)

Campos mínimos: `turn`, `role`, `mode`, `prevMode`, `bounce` (A→B→A en ≤3 turnos), `x`, `y`, `target`, `dist`, `carrying`, `heavy`, `inHole`, `cheeseCount`, `visibleCount`, `eventTypes`.
En el turno 1 se imprime una vez la lista de `entrance` de los agujeros, para que Python pueda ubicar las capturas en la entrada.
`visibleCount` cuando `inHole != null` sirve para comprobar el supuesto "el ratón ve desde adentro del agujero".

**Variables solo de observación (se registran, NUNCA se usan para decidir; no cambian el comportamiento):**
- Ratón: `bell`, `bellLoud`, `cat` (x, y, facing, stamina cuando se ve; si no, `null`).
- Gato: `stamina`, `facing`, `scentCount`, `scentMax` (fuerza máxima, o `null`), `mouse` (x, y, carrying cuando se ve; si no, `null`).
- Turno 1 (línea de entrances): además `width`, `height`, `holeCount` y `cheeseCount`.
Sirven para estimar los números ocultos (alcance de visión, de olor y de cascabel, estamina) y diseñar v2 con datos reales.

## 7. Métricas y criterios (10 partidas mínimo, primero contra Timothy)

Métricas por partida: entregas (D), capturas (C), impuesto (T = eventos `hidingTax`), capturas en la entrada, capturas con `carrying: true`, cambios de modo y rebotes.
Neto del ratón = 3D − 3C − T.

| Decisión | Criterio |
|---|---|
| **Mantener** | Sin errores ni timeouts, y neto del ratón > 0. Pasa a ser la línea base. |
| **Revertir** | Errores o timeouts, o neto negativo en casi todas las partidas. |
| **Ajustar (v1.1)** | Todo lo demás: se ataca un solo patrón claro. |
| **Umbral de impuesto** | T ≤ D por partida del ratón. |
| **Rebotes** | Solo observación en v1; sin umbral. |

Con menos de 10 partidas no se sacan conclusiones.

## 8. Riesgos y señales

| Riesgo | Señal en los datos |
|---|---|
| El ratón muere yendo o volviendo (sin HUIR) | Capturas con `carrying: true` |
| El ratón muere al salir (sin regla de entrada) | Capturas en la casilla `entrance` |
| El gato pierde al ratón (sin memoria) | Mucho tiempo en VIGILAR_QUESO y pocas capturas |
| Rebotes entre casillas de olor | Muchos cambios de posición sin avance |
| Espera larga por queso lento | Muchos `hidingTax` y pocas entregas |
| Ratón parado sobre un queso sin llevarlo (se queda en `STAY`) | Muchos turnos seguidos en `IR_AL_QUESO` con `dist: 0` |
| Olor más fuerte en una casilla `H` (el gato no tiene camino y se queda quieto) | Gato en `SEGUIR_OLOR` con `debug` "sin camino al objetivo" y sin moverse |
| Campo `tunneling` ausente (ratón trabado en `TUNEL`) | Ratón siempre en `TUNEL` (no debería pasar según las reglas) |

## 9. Hechos vs. supuestos

| Afirmación | Estado |
|---|---|
| El starter solo devuelve `STAY` | Verificado |
| Puntos, entrada única, captura por misma casilla o intercambio, `cheese` completo, el gato no entra a `H` | Regla |
| Los dos bots reciben los mismos eventos y `pickup` trae x, y | Regla (falta verlo en el log). v1 no lo usa |
| El ratón ve desde adentro del agujero | Supuesto |
| El queso nuevo aparece en pocos turnos | Supuesto (número oculto) |
| Moverse contra una pared = quedarse quieto | Supuesto |
| Dónde empiezan los animales | A verificar en el primer turn log |
| El gato parado sobre un queso no lo recoge | Supuesto |

**Decisión (Vera):** los tres casos límite de la tabla anterior se dejan para observar en los logs; si aparecen, se corrigen en v1.1.

## 10. Fuera de v1

Cascabel, HUIR, túneles, sprint, look, drop, intercepción, memoria, regla de seguridad en la entrada.

## 11. Ideas para versiones siguientes

- v2: regla de seguridad en la entrada (solo salir si no se ve al gato); HUIR con `cat`, `bell`, `bellLoud` y memoria de la última posición.
- Esperar en la entrada solo si `bell` es `null`.
- El gato vigila entradas de agujeros.
- `heavy: true` avisa antes de moverse que el turno está perdido.
- El gato usa `pickup` para ubicar al ratón con queso.

## 12. Texto borrador para "What changed, and why?"

Both roles now move along real map paths (BFS) toward clear goals with a fixed mode priority, because the starter stood still and scored nothing.
