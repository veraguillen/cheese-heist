# Especificación v5 — Midnight Kitchen

Estado: **aprobada por Vera el 24 nov (opción A)**. Base: v3.1 (la versión en juego). v4 queda descartada.
Evidencia: 8 piernas contra Lucas-Meowtel, Bruno-Meowtel, Agustin-Meowtel y Timothy (24 nov), analizadas con scripts que miden las piernas del gato y del ratón por separado.
Método: dos ideas por rol, cada una con su propio modo o texto en el registro, para medirlas por separado.

## Evidencia
- Ratón: 23 de 27 capturas en ALEJARSE; 24 de 27 llevando queso. Los ratones fuertes (Lucas, Bruno) sueltan el queso cuando el gato se acerca.
- Ratón: trabado entre dos casillas 273 turnos contra Agustin y 34 contra Lucas. Causa: al dejar de ver al gato lo "olvida" y cambia de queso objetivo.
- Gato: la emboscada después de un pickup llegó a tiempo en 0 de 28 entregas (tu gato a 15–39 casillas de la entrada usada).
- Gato: unos 100 turnos por partida yendo y viniendo entre dos casillas por olor viejo (Lucas, Bruno).
- Partidos perdidos por 3 puntos contra Agustin (6–9) y contra Timothy (28–31).

## Hipótesis
- Ratón: si suelta el queso cuando huye sin ruta segura y recuerda al gato que dejó de ver, bajan las capturas con queso y desaparecen los turnos trabado.
- Gato: si solo embosca cuando llega antes que el ratón y no vuelve a casillas de olor que acaba de pisar, cede menos entregas porque deja de perder turnos lejos de la acción.

## Cambios
### Ratón
1. **SOLTAR**: con queso, sin ruta segura a ningún agujero (iba a ALEJARSE), afuera de un agujero y con el gato a 3 o más casillas → `{ move: 'STAY', drop: true }`. Con el gato a 2 o menos no hay tiempo: ALEJARSE como antes.
2. **Memoria del gato y compromiso**: guardar la última posición vista del gato. Si no lo ve y lo vio hace 10 turnos o menos, usar esa posición como si lo viera (zona de peligro y rutas). Además, seguir con el queso elegido mientras exista y tenga ruta segura.

### Gato
3. **Emboscada a tiempo**: al ver un pickup, emboscar solo si la distancia del gato a la entrada es menor o igual que la del ratón (desde el pickup hasta ese agujero). Si no, sigue vigilando el queso.
4. **Sin vaivén por olor**: en SEGUIR_OLOR, no usar casillas que el gato pisó en los últimos 6 turnos. Si no queda ninguna, pasar a EMBOSCADA o VIGILAR_QUESO.

## Fuera de v5
Túneles (v6 si hay evidencia de que el gato rival espera en la salida), esperar afuera del agujero como Agustin, sprint e intercepción.

## Criterio (primera ronda, regla de CONTEXTO.md)
Revertir a v3.1 si la ronda pierde 25 de Elo o más, o si contra Timothy cede más que v3.1. Medir por pierna: capturas con queso, turnos trabado, entregas rivales, emboscadas a tiempo.
