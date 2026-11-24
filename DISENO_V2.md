# Especificación v2 — Midnight Kitchen

Estado: **aprobada por Vera el 23 nov**. Hipótesis, regla de escape y criterios: propuestos por la IA a partir de los datos de v1, aprobados por Vera. La elección de la opción A (esquivar) es de Vera.
Base: v1 (`DISENO_V1.md`). Todo lo que no se menciona aquí queda igual que en v1.

## 1. De dónde sale (datos de v1 contra Timothy, 2 matches)

- El 83 % de los puntos de Timothy (141 de 170) vino de capturas de mi ratón: 47 capturas, 23,5 por partida de ratón.
- 24 capturas con queso y 23 yendo al queso. 0 en la entrada. Impuesto: 2 puntos (despreciable).
- En 44 de las 47 capturas (94 %) mi ratón **vio al gato** en alguno de los 3 turnos anteriores. 0 sorpresas totales.
- Distancia real a la que lo vio por primera vez: entre 2 y 8 casillas (41 de 44 a 3 o más).
- Conclusión: el ratón tenía la información y el espacio para reaccionar, pero v1 lo ignoraba (riesgo aceptado en v1).

## 2. Hipótesis

**Si el ratón evita las casillas a 2 o menos del gato que ve (por camino real), y se aleja cuando no hay ruta segura, espero que las capturas por partida bajen al menos a la mitad, porque en v1 el 94 % de las capturas ocurrieron con el gato visible antes, casi siempre a 3 casillas o más.**

## 3. Cambio conceptual (uno solo)

**El ratón reacciona al gato que ve: esquiva su zona de peligro y, si no hay ruta segura, se aleja.**

El gato no cambia. Sin memoria: si el gato no está en `obs.cat`, el ratón se comporta como en v1.

Aparte, sin efecto en el juego: **registro compacto** según `LOGS.md` (el juego cortaba las líneas de v1 a unos 300 caracteres).

## 4. Zona de peligro

- Solo existe cuando `obs.cat !== null`.
- Se calcula con un BFS desde la casilla del gato **sobre el grafo del gato** (piso `.` y `T`; el gato no entra a `H`).
- Zona de peligro = casillas a distancia **≤ 2** del gato (por el sprint: 2 casillas en un turno), incluida la casilla del gato.
- Los agujeros (`H`) nunca están en peligro: el gato no puede entrar.

## 5. Ratón — prioridad fija (cambios en negrita)

| # | Condición | Modo | Acción |
|---|---|---|---|
| 1 | `tunneling != null` | TUNEL | `STAY` |
| 2 | `carrying` | VOLVER | **ruta segura** al agujero más cercano |
| 3 | `cheese.length > 0` | IR_AL_QUESO | **ruta segura** al queso más cercano; **si no hay, ruta segura al agujero más cercano (modo VOLVER)** |
| 4 | `inHole != null` (sin queso en el piso) | ESCONDIDO | `STAY` |
| 5 | fuera del agujero y sin queso en el piso | ESCONDIDO | **ruta segura** al agujero más cercano |
| — | **ninguna ruta segura en 2, 3 o 5** | **ALEJARSE** | **paso que más aleja del gato** |

**Ruta segura:** el mismo BFS del ratón de v1, pero las casillas de la zona de peligro no se pueden usar ni como paso intermedio ni como objetivo. La casilla de partida siempre se permite.

**Dentro de un agujero:** si la entrada está en la zona de peligro, no hay ruta segura hacia afuera. Con queso en el piso, la ruta segura al agujero más cercano da "ya estoy en el objetivo", así que el ratón se queda adentro (`STAY`). No se activa ALEJARSE estando dentro de un agujero.

**ALEJARSE:** candidatos = quedarse + cada vecino en el grafo del ratón. Se elige el de mayor distancia al gato por el grafo del gato. Un agujero vecino cuenta como distancia infinita (entrar es lo más seguro). Una casilla a la que el gato no llega también cuenta como infinita. Desempate: N, S, E, W, y por último STAY.

Si el gato no se ve, la zona está vacía y todo funciona como en v1.

## 6. Gato

Sin cambios respecto de v1.

## 7. Registro (ver `LOGS.md`)

Formato compacto, menos de 220 caracteres por línea. Campos nuevos del ratón en v2:
- `cd`: distancia por camino real del gato al ratón (grafo del gato), o `null` si no se ve al gato o no hay camino.
- `dv`: `1` si la ruta segura es distinta de la ruta directa de v1 (otro primer paso u otro objetivo), `0` si es igual, `null` si no se ve al gato.
- Modo nuevo posible: `ALEJARSE`.

## 8. Métricas y criterios (10 partidas mínimo, primero contra Timothy)

Base v1 contra Timothy: **23,5 capturas y 2,5 entregas por partida de ratón**.

| Decisión | Criterio |
|---|---|
| **Mantener** | Capturas ≤ 12 por partida **y** neto del ratón (3D − 3C − T) mejor que en v1 |
| **Ajustar** | Bajan las capturas, pero las entregas caen a 0 o el impuesto supera a las entregas |
| **Revertir** | Las capturas no bajan, o hay errores o timeouts |

Métricas extra: capturas VISTO / SOLO_OIDO / SORPRESA (como en v1), turnos en ALEJARSE, desvíos (`dv = 1`).

## 9. Riesgos y señales

| Riesgo | Señal |
|---|---|
| Sin memoria: el gato sale de la vista y el ratón vuelve a acercarse | Capturas con `cat` visible 2–3 turnos antes pero `null` justo antes |
| Ratón demasiado miedoso | Muchos turnos en ALEJARSE o escondido, entregas en 0, `hidingTax` alto |
| Gato acampa en la entrada | Ratón adentro mucho tiempo con queso en el piso; muchos `hidingTax` |
| Radio 2 insuficiente | Capturas VISTO con `cd` ≥ 3 en el turno anterior |
| Oscilación (ir y volver) | Rebotes `b = 1` entre IR_AL_QUESO, VOLVER y ALEJARSE |

## 10. Fuera de v2

Memoria del gato visto, uso del cascabel para decidir, túneles, drop, cambios en el gato.
