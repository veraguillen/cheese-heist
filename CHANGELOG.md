CHANGELOG — Midnight Kitchen bot

> Desde v3: un cambio conceptual por rol. Los roles nunca comparten partida, así que cada cambio se mide en su propia pierna; el Elo no se usa para atribuir.

| Versión | Fecha | Hipótesis | Cambio | Posición antes → después | Decisión |
|---|---|---|---|---|---|
| v0 | 23 nov | El bot de ejemplo pasa la verificación y entra a la tabla | Ninguno (starter.js) | — → no subido | No subir; la primera subida será v1 |
| v1 | 23 nov | Si ambos roles se mueven con BFS hacia un objetivo con prioridad fija, el bot pasa de no jugar a sumar entregas y capturas, y obtengo una línea base medida. | Movimiento BFS por caminos reales con máquina de estados de prioridad fija, en gato y ratón; registro D\| con variables de observación. | — → | Reemplazada por v2 (n = 2 contra Timothy; excepción a la regla de 10 partidas por el tamaño del efecto) |
| v2 | 23 nov | Si el ratón evita las casillas a 2 o menos del gato que ve (por camino real), y se aleja cuando no hay ruta segura, espero que las capturas por partida bajen al menos a la mitad, porque en v1 el 94 % de las capturas ocurrieron con el gato visible antes, casi siempre a 3 casillas o más. | El ratón reacciona al gato que ve: esquiva su zona de peligro (radio 2) y, sin ruta segura, va al agujero o se aleja. Aparte, sin efecto en el juego: registro compacto (LOGS.md). | — → | Mantener (provisional, n = 3) |
| v3 | 24 nov. | Ratón: si el ratón con queso vuelve al agujero con más margen sobre el gato visible, en vez de al más cercano, espero que bajen las capturas con queso, porque en v2 el 90 % fueron volviendo, a 1 casilla del agujero. Gato: si el gato espera en la entrada del agujero más cercano al queso, en vez de sobre el queso, espero al menos 1 captura por partida y menos entregas de Timothy, porque en v2 pasó el 98 % del tiempo sobre el queso y vio al ratón en 5 de 1200 turnos. | Un cambio por rol. Ratón (R2): con queso y gato visible, elige el agujero con ruta segura de mayor margen. Gato (G2): EMBOSCADA reemplaza a VIGILAR_QUESO; espera en la entrada del agujero más cercano al queso y, tras un pickup, mantiene la entrada más cercana a ese lugar hasta un delivered, caught o dropped. Registro: campo mg y modo EMBOSCADA. | → | |
| v5 | 24 nov. | Raton: si suelta el queso al huir sin ruta segura y recuerda al gato 10 turnos, bajan las capturas con queso y los turnos trabado. Gato: si solo embosca cuando llega antes y no repite olor de sus ultimas 6 casillas, cede menos entregas. | Raton: SOLTAR (1), ignorar el queso soltado con gato visto o recordado (1b), memoria del gato y compromiso con un queso (2). Gato: emboscada a tiempo (3), sin vaiven por olor (4). | → | |
| v6 | 24 nov. | Si el gato, quieto vigilando o emboscando, mira hacia el camino por donde llega el raton, lo ve antes del pickup mas seguido y bajan las entregas rivales, porque hoy mira hacia la entrada solo el 20 % de esos turnos. | Gato: look hacia la entrada del agujero mas cercano al queso (VIGILAR_QUESO) o hacia el pickup (EMBOSCADA) cuando hace STAY; giro N, E, S, W sin queso o ya en la entrada. Campo lk. El raton no cambia. | → | |
| v14 | 26 nov. | Si el gato solo persigue al ratón visible a 4 casillas o menos y, más lejos, intercepta o patrulla, bajan las entregas rivales, porque deja de abandonar la zona de los quesos por un ratón que no alcanza. | Correa en PERSEGUIR (PERSEGUIR_MAX_DIST = 4, por camino) y gate mouseId < 0 en OLOR; el resto de los modos no cambia. | → | |
| v15 | 26 nov. | Si el gato va a un punto que cubre a todos los quesos a la vez en vez de recorrerlos uno por uno, vuelve a ver antes al rival y bajan sus entregas, porque PATRULLA oscila entre candidatos cercanos sin asentarse. | CENTINELA (v10, restaurado): reemplaza a PATRULLA cuando hay queso en el piso -- va al punto que minimiza la distancia máxima a todos los quesos, cacheado por conjunto; al llegar, gira 360 (N,E,S,W) si no tiene señales del ratón. PATRULLA queda solo para cuando no hay ningún queso. | → | |
| v16 | 26 nov. | Si el precálculo todos-contra-todos del gato solo corre en mapas chicos, se evitan timeouts de init completos en casas grandes, porque hoy ese precálculo se hace dos veces (gato y ratón) y en mapas de ~800 casillas tarda 35-47ms local -- cerca del límite de 500ms si el servidor es más lento. | Bajar el umbral de buildAllPairs (ALL_PAIRS_MAX_V) de 900 a 250 casillas; arriba de eso, el BFS cacheado por turno (ya en uso, medido en 2-6ms) reemplaza al precálculo. | → | |
| v17 | 26 nov. | Si el gato sprinta con el ratón visible cargando queso, dentro de 4 casillas por camino y con los dos primeros pasos en línea recta, suben las capturas con queso, porque hoy el sprint solo se usa a 1-2 casillas alineado y la correa ya limita la persecución a 4. | SPRINT_RADIO_MAX_DIST = 4 (<= PERSEGUIR_MAX_DIST): sprint con ratón visible cargando queso, dentro del radio, primeros 2 pasos rectos y estamina >= 2*sprintCost. Gateado por decision.mode==='PERSEGUIR'; sprintRemate, INTERCEPTAR, OLOR, CENTINELA y el ratón no cambian. | → | |
| v18 | 26 nov. | Si el gato, al perseguir por un pasillo sin bifurcaciones con rumbo conocido, corta unas casillas adelante en vez de perseguir la casilla actual del ratón, lo caza más seguido, porque perseguir la casilla actual nunca lo alcanza sin sprint si el ratón huye derecho. | predictInterceptTarget(mouseId, heading): en PERSEGUIR, si el pasillo es grado-2 estricto (revisado ANTES de cada paso, hasta el ratón mismo) hasta PREDICT_STEPS=3 casillas, corta ahí; si termina en un agujero, corta la entrada. Sin heading, en cuarto abierto, o sin camino alcanzable por el gato, cae a mouseId sin cambios. Campo pi en el log. | → | |
| v19 | 26 nov. | Si sprintCost se corrige con un promedio móvil de verdad (como ya hace staminaRegen) en vez de un máximo que solo puede subir, el gato vuelve a sprintar seguido tras una lectura ruidosa, porque hoy una sola lectura alta puede dejarlo sin sprintar por el resto de la partida. | params.sprintCost = Math.max(0.5, sprintCost*0.7 + (-delta)*0.3) en vez de Math.max(0.5, Math.max(sprintCost*0.7, -delta)) -- misma fórmula que ya usa staminaRegen. Nada más se toca. | → | |
| v20 | 27 nov. | Si el gato abandona el centro de CENTINELA tras 8 turnos seguidos sin ninguna señal real del ratón y va a patrullar entradas/quesos en vez de quedarse, bajan las entregas rivales en casas donde el centro geométrico cae en un rincón o pasillo ciego, porque hoy no hay ningún límite y puede quedarse ahí indefinidamente. | CENTINELA_MAX_TURNOS = 8: cuenta turnos consecutivos en CENTINELA sin que PERSEGUIR/INTERCEPTAR/OLOR disparen; al superarlo, fuerza PATROL_HOLD_TURNS=8 turnos de patrulla normal (entradas de agujero o quesos) antes de volver a permitir CENTINELA. Nada más cambia. | → | |
| v21 | 27 nov. | Si en una bifurcacion (grado>2 en mouseGraph) el gato sigue la rama cuya direccion coincide con el heading y esa rama sigue angosta (grado<=2), en vez de rendirse como hoy, deberia predecir mejor la posicion del raton en pasillos con bifurcaciones y acercarse mas en los turnos siguientes, porque hoy predictInterceptTarget se rinde en cualquier casilla de grado distinto de 2, incluidas bifurcaciones reales con una rama clara. | predictInterceptTarget: en grado==2 sigue igual que antes (pasillo recto intacto); en grado>2, solo continua si la casilla en la direccion del heading es una rama legal (next>=0) Y esa rama sigue angosta (degreeOf(next)<=2, para no confundir una bifurcacion real con un cuarto abierto donde cualquier direccion esta libre). Sin esa coincidencia clara, se rinde igual que antes (conservador). Criterio: heading, no mouseBelief -- mouseBelief esta colapsada 1.0 en la casilla exacta del raton mientras lo vemos (requisito para llamar a esta funcion), asi que leerla en los vecinos de la bifurcacion siempre da 0 contra 0; eso solo cambiaria tocando diffuse/updateMouseBelief, prohibido en esta etapa. | → | |
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
Resultado: 7 derrotas en 7 partidas. Contra Timothy (2 partidas): marcador 3–91 y 13–79. Mi ratón: 23,5 capturas, 2,5 entregas y 1 de impuesto por partida. Mi gato: 0 capturas (799 de 800 turnos en VIGILAR_QUESO). El 83 % de los puntos de Timothy (141 de 170) vino de capturas de mi ratón; en 44 de 47 el ratón había visto al gato en los 3 turnos anteriores. Las líneas D| (unos 390 caracteres) se cortaban en 300.
Decisión: reemplazada por v2. Se decidió con 2 partidas contra Timothy, por debajo de la regla de 10, porque el efecto era muy grande (47 capturas) y el patrón muy claro (94 %). Queda registrado como excepción consciente.
v2 — 23 nov
Hipótesis: Si el ratón evita las casillas a 2 o menos del gato que ve (por camino real), y se aleja cuando no hay ruta segura, espero que las capturas por partida bajen al menos a la mitad, porque en v1 el 94 % de las capturas ocurrieron con el gato visible antes, casi siempre a 3 casillas o más.
Cambio (uno solo): El ratón reacciona al gato que ve: esquiva su zona de peligro (radio 2) y, sin ruta segura, va al agujero o se aleja. Aparte, sin efecto en el juego: registro compacto (LOGS.md).
Por qué (qué vi en las repeticiones): v1 contra Timothy: 83 % de sus puntos vinieron de capturas de mi ratón (47, 23,5 por partida); en 44 de 47 el ratón vio al gato antes. Las líneas D| de v1 (unos 390 caracteres) se cortaban en 300.
Decidí yo: Atacar las capturas del ratón; opción A (esquivar) frente a retirarse o usar el cascabel; radio 2 por el sprint; sin ruta segura, volver al agujero; registro compacto con leyenda clara (opción A); arreglar dv y el modo ESCONDIDO en el registro.
Sugirió la IA: Medir VISTO/SOLO_OIDO/SORPRESA antes de programar; la redacción de la hipótesis; alejarse cuando tampoco hay ruta al agujero; criterios (capturas <= 12 por partida y neto mejor que v1); campos cd y dv; los dos arreglos del registro.
Modelo / razonamiento: Claude Opus 5.5 (Claude Code)
Texto enviado en "What changed, and why?": The mouse now avoids tiles within 2 steps of a visible cat and backs off when no safe path exists, because in v1 most of its captures (44 of 47) happened after it had already seen the cat. Logs were also shortened so the 300-char limit no longer cuts them.
Qué observar en 5–10 repeticiones: Capturas por partida de ratón (meta <= 12, base 23,5), entregas, impuesto, turnos en ALEJARSE, desvíos (dv=1), capturas VISTO/SOLO_OIDO; primero contra Timothy.
Resultado (contra Timothy, 3 partidas: 2 ranch de 8 agujeros y 1 cottage de 4):
Marcador: 21–39, 21–40, 45–46.
Mi ratón: 9,67 capturas por partida (6, 9, 14), −59 % frente a v1; 7 entregas por partida (antes 2,5); impuesto 0,67. Neto del ratón: −8,7 (v1: −64).
Efecto no previsto: las entregas casi se triplicaron (el ratón sobrevive más y hace más viajes).
Mi gato: 0 capturas. En m3 sumó 24 puntos solo por el impuesto que pagó el ratón de Timothy.
Esquive: ALEJARSE en el 4–11 % de los turnos del ratón; la ruta segura difirió de la directa en el 62 % de los turnos con gato visible (174 de 279). 0 líneas D| ilegibles en 1203.
Capturas: 28 de 29 VISTO, 1 SOLO_OIDO, 0 SORPRESA. 22 de 28 con el gato a 1–2 casillas el turno anterior; 2 con cd null (gato visto 2–3 turnos antes). 26 de 29 con queso (v1: 51 %); tasa aproximada por turno: ~6 % en VOLVER frente a ~0,4 % en IR_AL_QUESO (por confirmar con c=1).
Advertencias: n = 3 (menos que la regla de 10); las casas de v1 y v2 pueden ser de otro tipo (posible mezcla de causas); m3 (cottage) superó la meta con 14 capturas.
Patrones de fallo por puntos cedidos: (1) capturas volviendo con queso, 78 pts; (2) mi gato no atrapa y Timothy entrega, 36 pts; (3) capturas sin queso o sin memoria, 11 pts.
Decisión: mantener (provisional, n = 3). Cumple el criterio de §8 en promedio (9,67 ≤ 12 y neto mejor que v1). Se revisa si al juntar más partidas el promedio supera 12.

## v3 — 24 nov.
- **Hipótesis:** Ratón: si el ratón con queso vuelve al agujero con más margen sobre el gato visible, en vez de al más cercano, espero que bajen las capturas con queso, porque en v2 el 90 % fueron volviendo, a 1 casilla del agujero. Gato: si el gato espera en la entrada del agujero más cercano al queso, en vez de sobre el queso, espero al menos 1 captura por partida y menos entregas de Timothy, porque en v2 pasó el 98 % del tiempo sobre el queso y vio al ratón en 5 de 1200 turnos.
- **Cambio (uno solo):** Un cambio por rol. Ratón (R2): con queso y gato visible, elige el agujero con ruta segura de mayor margen. Gato (G2): EMBOSCADA reemplaza a VIGILAR_QUESO; espera en la entrada del agujero más cercano al queso y, tras un pickup, mantiene la entrada más cercana a ese lugar hasta un delivered, caught o dropped. Registro: campo mg y modo EMBOSCADA.
- **Por qué (qué vi en los datos):** Diagnóstico de v2 contra Timothy (3 partidas): 26 de 29 capturas con queso, mediana de 1 casilla al agujero; el peso se descartó (5 de 26 con h=1, por debajo del ~60 % esperado por azar). Gato: 788 de 800 turnos sobre el queso; las entregas rivales ocurrieron a unas 15 casillas.
- **Decidí yo:** Pasar a un cambio conceptual por rol. Elegir R2 frente a R5 y G2 frente a G4. Aprobar el criterio de margen, el gato sobre la entrada y los umbrales. Aplicar la corrección del pickup antes de subir. Subir de noche sin arnés de repetición.
- **Sugirió la IA:** Las opciones R2, R5, G2 y G4; descartar G1 y R1 con los datos; el criterio de margen; detectar el hueco del pickup y el bug de eventos leídos solo en EMBOSCADA; los 7 casos de prueba.
- **Modelo / razonamiento:** Claude Opus 5.5 (Claude Code) / razonamiento: <COMPLETA>
- **Texto enviado en "What changed, and why?":** Mouse returns to the safest hole, not the nearest, because most v2 captures happened on the way back. Cat waits at the hole entrance near the cheese and keeps guarding it after a pickup, because it almost never saw the mouse in v2.
- **Qué observar en 10 partidas:** Contra Timothy, por pierna y por tipo de casa. Ratón: capturas con queso (base 26 en 3 partidas), entregas (base 7, mínimo 5), mg. Gato: capturas (base 0), entregas de Timothy (base 4), turnos en EMBOSCADA, cambios de tg, impuesto cobrado.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** pendiente

## v5 — 24 nov.
- **Hipótesis:** Raton: si suelta el queso al huir sin ruta segura y recuerda al gato 10 turnos, bajan las capturas con queso y los turnos trabado. Gato: si solo embosca cuando llega antes y no repite olor de sus ultimas 6 casillas, cede menos entregas.
- **Cambio (uno solo):** Raton: SOLTAR (1), ignorar el queso soltado con gato visto o recordado (1b), memoria del gato y compromiso con un queso (2). Gato: emboscada a tiempo (3), sin vaiven por olor (4).
- **Por qué (qué vi en los datos):** 
- **Decidí yo:** Elegi las 4 ideas desde el analisis de rivales (opcion A); la opcion B para despues de soltar; acepte que el olor solo en mi casilla pase a la prioridad siguiente.
- **Sugirió la IA:** Propuso las opciones con trade-offs, detecto el riesgo de quedarse quieto sobre el queso soltado y el ciclo de soltar y recoger, pidio validar los casos c y g contra el codigo viejo y separar la linea emb en leer_logs.py; Claude Code generalizo la regla del olor (supuesto 4).
- **Modelo / razonamiento:** Claude Opus 5.5 (Claude Code) / <nivel>
- **Texto enviado en "What changed, and why?":** <pega el texto del punto d>
- **Qué observar en 10 partidas:** 
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v6 — 24 nov.
- **Hipótesis:** Si el gato, quieto vigilando o emboscando, mira hacia el camino por donde llega el raton, lo ve antes del pickup mas seguido y bajan las entregas rivales, porque hoy mira hacia la entrada solo el 20 % de esos turnos.
- **Cambio (uno solo):** Gato: look hacia la entrada del agujero mas cercano al queso (VIGILAR_QUESO) o hacia el pickup (EMBOSCADA) cuando hace STAY; giro N, E, S, W sin queso o ya en la entrada. Campo lk. El raton no cambia.
- **Por qué (qué vi en los datos):** 
- **Decidí yo:** Elegi la opcion A (solo el gato) por la comparacion pareada: gato -16,1 por partida, raton +0,6. Precise memory.pickupKey y memory.giro en la especificacion.
- **Sugirió la IA:** Propuso usar look desde la validacion de vision (20 % de frente, 8 % visto antes del pickup); detecto que la entrada no es la casilla de map.holes y que en la entrada sin pickup look quedaba null; Claude Code encontro un empate de BFS en las pruebas y que v5 no tenia commit.
- **Modelo / razonamiento:** <modelo real> / <nivel>
- **Texto enviado en "What changed, and why?":** <texto del punto d>
- **Qué observar en 10 partidas:** 
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v14 — 26 nov.
- **Hipótesis:** Si el gato solo persigue al ratón visible a 4 casillas o menos y, más lejos, intercepta o patrulla, bajan las entregas rivales, porque deja de abandonar la zona de los quesos por un ratón que no alcanza.
- **Cambio (uno solo):** Correa en PERSEGUIR (PERSEGUIR_MAX_DIST = 4, por camino) y gate mouseId < 0 en OLOR; el resto de los modos no cambia.
- **Por qué (qué vi en los datos):** En v7 el gato duplicó las capturas pero dejó el queso y el rival entregó +0,94 veces más; PERSEGUIR no tenía umbral de distancia. Los gatos ganadores no persiguen de lejos.
- **Decidí yo:** Probar la correa antes que el sprint con reserva; N = 4 provisional; el gate en OLOR en vez de excluir solo la casilla.
- **Sugirió la IA:** El gate en OLOR para evitar que la creencia reabra la persecución, los tests a-e y el campo lj.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Cat now chases a visible mouse only within 4 tiles; farther away it intercepts or patrols, because chasing from afar pulled it off the cheese and let rivals deliver. Mouse unchanged.
- **Qué observar en 10 partidas:** Elo en 3 rondas; turnos con lj=1 y qué hace el gato después; entregas rivales y capturas por partida; rebotes (b) en PATRULLA.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v15 — 26 nov.
- **Hipótesis:** Si el gato va a un punto que cubre a todos los quesos a la vez en vez de recorrerlos uno por uno, vuelve a ver antes al rival y bajan sus entregas, porque PATRULLA oscila entre candidatos cercanos sin asentarse.
- **Cambio (uno solo):** CENTINELA (v10, restaurado): reemplaza a PATRULLA cuando hay queso en el piso -- va al punto que minimiza la distancia máxima a todos los quesos, cacheado por conjunto; al llegar, gira 360 (N,E,S,W) si no tiene señales del ratón. PATRULLA queda solo para cuando no hay ningún queso.
- **Por qué (qué vi en los datos):** PATRULLA, probado en sesiones anteriores, puede quedar oscilando entre dos candidatos cercanos sin cubrir el resto del mapa.
- **Decidí yo:** Que convivan en vez de que CENTINELA reemplace a PATRULLA del todo; el gate con mode==='PATRULLA' en vez de target<0, porque OLOR siempre deja target en algo aunque no cruce su umbral.
- **Sugirió la IA:** Detectó que target<0 casi nunca se cumple por el side-effect del scan de OLOR, y propuso el gate por mode.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Cat restores CENTINELA from v10: holds the tile that minimizes max distance to all cheese (one stable point), with a 360 look sweep when idle and signal-less, instead of patrolling cheese one by one. PATRULLA now only runs with no cheese at all.
- **Qué observar en 10 partidas:** Entregas rivales y capturas por partida; turnos con md=CENTINELA y si el giro realmente ayuda a reencontrar al ratón; costo por turno cuando cambia el conjunto de quesos.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v16 — 26 nov.
- **Hipótesis:** Si el precálculo todos-contra-todos del gato solo corre en mapas chicos, se evitan timeouts de init completos en casas grandes, porque hoy ese precálculo se hace dos veces (gato y ratón) y en mapas de ~800 casillas tarda 35-47ms local -- cerca del límite de 500ms si el servidor es más lento.
- **Cambio (uno solo):** Bajar el umbral de buildAllPairs (ALL_PAIRS_MAX_V) de 900 a 250 casillas; arriba de eso, el BFS cacheado por turno (ya en uso, medido en 2-6ms) reemplaza al precálculo.
- **Por qué (qué vi en los datos):** Timeout real reportado contra Imanol en las dos piernas (init failed: timeout, ni el gato ni el ratón llegaban a jugar); medido localmente: mapas de ~800 casillas tardaban 35-47ms de init, bajó a 3-7ms con el nuevo umbral.
- **Decidí yo:** Bajar el umbral en vez de optimizar buildAllPairs; elegí 250 con margen (a esa V el precálculo ya es barato) en vez de un número más ajustado.
- **Sugirió la IA:** Midió el costo real por tamaño de mapa y confirmó que el camino de respaldo (BFS cacheado) es seguro por turno antes de bajar el umbral.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Lowered the all-pairs precompute threshold from 900 to 250 tiles: on houses around 800 tiles it was taking 35-47ms locally (x2, both roles build both graphs), likely timing out init on a slower server. The per-turn cached-BFS fallback is already fast enough (2-6ms) above that size.
- **Qué observar en 10 partidas:** Si vuelven a aparecer timeouts de init contra cualquier rival; tiempo de init real reportado por el sitio en casas grandes.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v17 — 26 nov.
- **Hipótesis:** Si el gato sprinta con el ratón visible cargando queso, dentro de 4 casillas por camino y con los dos primeros pasos en línea recta, suben las capturas con queso, porque hoy el sprint solo se usa a 1-2 casillas alineado y la correa ya limita la persecución a 4.
- **Cambio (uno solo):** SPRINT_RADIO_MAX_DIST = 4 (<= PERSEGUIR_MAX_DIST): sprint con ratón visible cargando queso, dentro del radio, primeros 2 pasos rectos y estamina >= 2*sprintCost. Gateado por decision.mode==='PERSEGUIR'; sprintRemate, INTERCEPTAR, OLOR, CENTINELA y el ratón no cambian.
- **Por qué (qué vi en los datos):** El sprint solo se usaba en la ventana angosta de sprintRemate (1-2 casillas); la correa (v14) ya garantiza que PERSEGUIR nunca persigue de más lejos de lo razonable, así que ampliar el sprint hasta ese mismo radio no agrega riesgo nuevo.
- **Decidí yo:** Reserva A (2*sprintCost) sin bandera de "aprendido" -- si el juego no deja sprintar de verdad, RULES.md hace que el sprint mueva 1 sola casilla, inofensivo.
- **Sugirió la IA:** Detectó que, sin la condición explícita de modo, el chequeo podía solaparse con el atajo de INTERCEPTAR; y el reuso de sprintLines para el chequeo de línea recta, sin estructuras nuevas.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Cat now also sprints at a visible, cheese-carrying mouse within 4 tiles when the first two path steps are straight and stamina covers 2x the learned sprint cost, because the leash already limits chasing to 4 tiles and sprint was only used at 1-2 tiles aligned. PERSEGUIR-gated only; mouse, OLOR, INTERCEPTAR, and PATRULLA unchanged.
- **Qué observar en 10 partidas:** Capturas con queso por partida; turnos con sr=1 y si terminan en captura o entrega; si sprintCost sigue aprendiéndose razonable con este sprint nuevo de por medio.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v18 — 26 nov.
- **Hipótesis:** Si el gato, al perseguir por un pasillo sin bifurcaciones con rumbo conocido, corta unas casillas adelante en vez de perseguir la casilla actual del ratón, lo caza más seguido, porque perseguir la casilla actual nunca lo alcanza sin sprint si el ratón huye derecho.
- **Cambio (uno solo):** predictInterceptTarget(mouseId, heading): en PERSEGUIR, si el pasillo es grado-2 estricto (revisado ANTES de cada paso, hasta el ratón mismo) hasta PREDICT_STEPS=3 casillas, corta ahí; si termina en un agujero, corta la entrada. Sin heading, en cuarto abierto, o sin camino alcanzable por el gato, cae a mouseId sin cambios. Campo pi en el log.
- **Por qué (qué vi en los datos):** El heading que usa esto ya se calculaba para directedLook (mirada al perder contacto); reutilizarlo mientras el ratón sigue visible, en vez de solo después de perderlo, no agrega estructuras nuevas.
- **Decidí yo:** Alcance 3, chequeo de grado estricto ANTES de cada paso (no después), y cortar la entrada si el pasillo termina en agujero -- elegí la opción que más aprovecha la predicción en vez de descartarla.
- **Sugirió la IA:** Encontró que revisar el grado DESPUÉS de dar el paso dejaba pasar 1 casilla de predicción incluso en cuartos abiertos; corrigió a revisarlo antes de cada paso, incluida la casilla donde está el ratón.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Cat now predicts a few tiles ahead when chasing through a strict dead-end corridor with a known heading, instead of always targeting the mouse's current tile, because targeting the current tile alone can never catch a mouse running straight away without a sprint. Falls back to the mouse's tile with no heading, in an open room, or if the predicted tile isn't reachable; cuts to the hole's entrance if the corridor ends there. sprintRemate, INTERCEPTAR, OLOR, CENTINELA and the mouse unchanged.
- **Qué observar en 10 partidas:** Capturas por partida en casas con pasillos largos; turnos con pi=1 y si terminan en captura; que sprintRemate siga disparando igual con la posición real del ratón, sin importar hacia dónde apunte la ruta.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v19 — 26 nov.
- **Hipótesis:** Si sprintCost se corrige con un promedio móvil de verdad (como ya hace staminaRegen) en vez de un máximo que solo puede subir, el gato vuelve a sprintar seguido tras una lectura ruidosa, porque hoy una sola lectura alta puede dejarlo sin sprintar por el resto de la partida.
- **Cambio (uno solo):** params.sprintCost = Math.max(0.5, sprintCost*0.7 + (-delta)*0.3) en vez de Math.max(0.5, Math.max(sprintCost*0.7, -delta)) -- misma fórmula que ya usa staminaRegen. Nada más se toca.
- **Por qué (qué vi en los datos):** Reporte real: el gato dejaba de sprintar en el momento clave, con el ratón en frente, en repeticiones. Leyendo el código, el Math.max de antes ignoraba por completo cualquier lectura nueva menor a la decadencia del 70% del valor viejo -- no podía bajar, solo decaer a ritmo fijo.
- **Decidí yo:** Reusar la fórmula exacta de staminaRegen en vez de inventar una nueva; no agregar un tope ni una bandera de "confiable", para mantener un solo cambio conceptual.
- **Sugirió la IA:** Señaló la comparación directa con staminaRegen (misma función, dos líneas más abajo) como la prueba más clara de que el Math.max era la anomalía, no la regla.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** sprintCost now uses a real moving average (same formula as staminaRegen) instead of a max-only ratchet that could only increase, because a single noisy reading could silence sprinting for the rest of the match with real stamina to spare.
- **Qué observar en 10 partidas:** Si el gato vuelve a sprintar después de turnos sin estamina aparente; valores de sprintCost en el log a lo largo de la partida (no expuestos hoy, a ojo por la frecuencia de sp/sr).
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v20 — 27 nov.
- **Hipótesis:** Si el gato abandona el centro de CENTINELA tras 8 turnos seguidos sin ninguna señal real del ratón y va a patrullar entradas/quesos en vez de quedarse, bajan las entregas rivales en casas donde el centro geométrico cae en un rincón o pasillo ciego, porque hoy no hay ningún límite y puede quedarse ahí indefinidamente.
- **Cambio (uno solo):** CENTINELA_MAX_TURNOS = 8: cuenta turnos consecutivos en CENTINELA sin que PERSEGUIR/INTERCEPTAR/OLOR disparen; al superarlo, fuerza PATROL_HOLD_TURNS=8 turnos de patrulla normal (entradas de agujero o quesos) antes de volver a permitir CENTINELA. Nada más cambia.
- **Por qué (qué vi en los datos):** Reporte del usuario viendo repeticiones: el gato se queda mucho tiempo vigilando el centro y, en algunas casas, queda efectivamente atrapado por la geometría de paredes cerca de ese punto.
- **Decidí yo:** Elegí 8 turnos (igual a PATROL_HOLD_TURNS, ya usado en el proyecto) en vez de un valor nuevo, y reusar el bloque de patrulla existente (entradas + quesos) en vez de calcular esquinas geométricas nuevas.
- **Sugirió la IA:** Identificó que calcularCentro no tenía ningún límite de turnos y que el bloque de PATRULLA ya elegía puntos lejos del centro (entradas de agujero), así que forzar una patrulla temporal no necesitaba lógica nueva de 'esquinas'.
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** Cat now abandons the CENTINELA center point after 8 consecutive turns with no real signal of the mouse (no sighting, no INTERCEPTAR, no OLOR), and patrols hole entrances/cheese for 8 turns before CENTINELA is allowed again, because some houses' geometric center sits in a corner or dead-end corridor where the cat could otherwise stay stuck indefinitely.
- **Qué observar en 10 partidas:** Turnos con md=CENTINELA por partida (debería bajar su máximo corrido); entregas rivales y capturas por partida en casas con centro en rincones; si la patrulla forzada interfiere con quesos recién detectados.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir

## v21 — 27 nov.
- **Hipótesis:** Si en una bifurcacion (grado>2 en mouseGraph) el gato sigue la rama cuya direccion coincide con el heading y esa rama sigue angosta (grado<=2), en vez de rendirse como hoy, deberia predecir mejor la posicion del raton en pasillos con bifurcaciones y acercarse mas en los turnos siguientes, porque hoy predictInterceptTarget se rinde en cualquier casilla de grado distinto de 2, incluidas bifurcaciones reales con una rama clara.
- **Cambio (uno solo):** predictInterceptTarget: en grado==2 sigue igual que antes (pasillo recto intacto); en grado>2, solo continua si la casilla en la direccion del heading es una rama legal (next>=0) Y esa rama sigue angosta (degreeOf(next)<=2, para no confundir una bifurcacion real con un cuarto abierto donde cualquier direccion esta libre). Sin esa coincidencia clara, se rinde igual que antes (conservador). Criterio: heading, no mouseBelief -- mouseBelief esta colapsada 1.0 en la casilla exacta del raton mientras lo vemos (requisito para llamar a esta funcion), asi que leerla en los vecinos de la bifurcacion siempre da 0 contra 0; eso solo cambiaria tocando diffuse/updateMouseBelief, prohibido en esta etapa.
- **Por qué (qué vi en los datos):** Analisis de viabilidad (FASE 1) de 4 mejoras de prediccion pedidas por el usuario, Etapa 1 del plan por etapas aprobado. predictInterceptTarget hoy se rinde en cualquier bifurcacion real, que es exactamente donde mas falta hace predecir bien; mouseBelief resulto no servir para esto sin tocar diffuse/updateMouseBelief (verificado leyendo el orden de llamadas en act()).
- **Decidí yo:** Elegi la opcion 1 de las 3 propuestas: usar heading como sustituto de mouseBelief, manteniendo diffuse(), updateMouseBelief(), el raton v7 y CENTINELA intactos, sin adelantar la Etapa 2 (difusion direccional) ni la Etapa 3/4 (multiples trayectorias, puntuacion de captura).
- **Sugirió la IA:** Encontro que mouseBelief esta siempre colapsada a la casilla exacta del raton en el instante en que predictInterceptTarget se llama (requisito mouseId>=0), haciendo que el criterio de 'mayor creencia' pedido originalmente fuera inviable sin tocar diffuse/updateMouseBelief; propuso heading-alignment mas un chequeo de grado en la rama siguiente para no confundir una bifurcacion real con un cuarto abierto (ya que ambos pueden tener grado>2 en la propia casilla).
- **Modelo / razonamiento:** Claude Sonnet 5 (Claude Code)
- **Texto enviado en "What changed, and why?":** In PERSEGUIR, the cat now also predicts ahead at real branches (degree>2), not just straight corridors: it follows the branch matching the last known heading only if that branch also stays narrow (not an open room), otherwise it stays conservative like before. Cuts to a hole's entrance if the branch ends there. Nothing else changes.
- **Qué observar en 10 partidas:** Capturas y oportunidades de interceptacion por partida, separando turnos en pasillo recto (pi=1 sin bifurcacion) de turnos con bifurcacion resuelta; que porcentaje de las predicciones en bifurcacion coinciden con el camino real del raton 1-3 turnos despues; distancia gato-raton tras una prediccion en bifurcacion vs. sin ella; persecuciones desviadas por una rama mal elegida.
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir
