Formato de cada entrada
vX — fecha
Hipótesis: Si cambio X, espero que mejore Y porque Z.
Cambio (uno solo):
Por qué (qué vi en las repeticiones):
Decidí yo:
Sugirió la IA:
Modelo / razonamiento:
Texto enviado en "What changed, and why?":
Qué observar en 5–10 repeticiones:
Resultado:
Decisión: mantener / ajustar / revertir
v0 — 23 nov
Hipótesis: El bot de ejemplo pasa la verificación y entra a la tabla.
Cambio: ninguno (starter.js). Commit "v0: unchanged starter bot (baseline)" en GitHub.
Por qué: tener una línea base para comparar las próximas versiones.
Decidí yo: no subir v0 a meow.tel. El starter se queda quieto, así que se espera 0 entregas y 0 capturas. Es una predicción basada en las reglas, no una medición. Cada subida afecta el Elo y no hay partidas de práctica, así que no gasto partidas midiendo un resultado predecible. La primera subida será v1.
Sugirió la IA: presentó las dos opciones (A: subir v0 para obtener una línea base y un turn log; B: saltarla) con sus trade-offs. El costo de B es diseñar v1 sin ver un turn log. Para compensarlo, v1 debe imprimir líneas "D|" y notas debug, para que la primera subida entregue los datos que faltan.
Resultado: v0 no se subió a meow.tel. Pasó pre-ship en local (0 excepciones, 0 acciones inválidas).
Decisión: no subir. Primera subida: v1.
v1 — 23 nov
Hipótesis: Si ambos roles se mueven con BFS hacia un objetivo con prioridad fija, el bot pasa de no jugar a sumar entregas y capturas, y obtengo una línea base medida.
Cambio (uno solo): Movimiento BFS por caminos reales con máquina de estados de prioridad fija, en gato y ratón; registro D| con variables de observación.
Por qué (qué vi en las repeticiones): El starter se quedaba quieto. Sin turn logs, el registro extra sirve para estimar los números ocultos.
Decidí yo: Un solo concepto; quitar la regla de seguridad de la entrada; sin límite de espera; umbral T <= D; observar rebotes y casos límite; aceptar desempates; registro extra (opción B).
Sugirió la IA: Opciones y trade-offs; los dos desempates; la fila 5 del ratón; los campos de observación; corrección de dos comentarios.
Modelo / razonamiento: Claude Sonnet 5.5 (bot base) + Claude Opus 5.5 (registro extra)
Texto enviado en "What changed, and why?": Both roles now move along real map paths (BFS) toward a goal chosen by a fixed mode priority, because the starter stood still and scored nothing. Each turn also logs its decision and observations, so I can measure the game's hidden numbers.
Qué observar en 5–10 repeticiones: Entregas, capturas, impuesto, capturas en la entrada y con queso, rebotes y casos límite; primero contra Timothy.
Resultado:
Decisión: pendiente (10 partidas)