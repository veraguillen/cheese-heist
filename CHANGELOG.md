# CHANGELOG — Midnight Kitchen bot

| Versión | Fecha | Hipótesis | Cambio | Posición antes → después | Decisión |
|---|---|---|---|---|---|
| v0 | 23 nov | El bot de ejemplo pasa la verificación y entra a la tabla | Ninguno (starter.js) | — → no subido | No subir; la primera subida será v1 |

---

## Formato de cada entrada

## vX — fecha
- **Hipótesis:** Si cambio X, espero que mejore Y porque Z.
- **Cambio (uno solo):**
- **Por qué (qué vi en las repeticiones):**
- **Decidí yo:**
- **Sugirió la IA:**
- **Modelo / razonamiento:**
- **Texto enviado en "What changed, and why?":**
- **Qué observar en 5–10 repeticiones:**
- **Resultado:**
- **Decisión:** mantener / ajustar / revertir

---

## v0 — 23 nov
- **Hipótesis:** El bot de ejemplo pasa la verificación y entra a la tabla.
- **Cambio:** ninguno (starter.js). Commit "v0: unchanged starter bot (baseline)" en GitHub.
- **Por qué:** tener una línea base para comparar las próximas versiones.
- **Decidí yo:** no subir v0 a meow.tel. El starter se queda quieto, así que se espera 0 entregas y 0 capturas. Es una predicción basada en las reglas, no una medición. Cada subida afecta el Elo y no hay partidas de práctica, así que no gasto partidas midiendo un resultado predecible. La primera subida será v1.
- **Sugirió la IA:** presentó las dos opciones (A: subir v0 para obtener una línea base y un turn log; B: saltarla) con sus trade-offs. El costo de B es diseñar v1 sin ver un turn log. Para compensarlo, v1 debe imprimir líneas "D|" y notas debug, para que la primera subida entregue los datos que faltan.
- **Resultado:** v0 no se subió a meow.tel. Pasó `pre-ship` en local (0 excepciones, 0 acciones inválidas).
- **Decisión:** no subir. Primera subida: v1.
