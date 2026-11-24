"""
episodios.py — episodios de ratón y gato, tablas por turno y riesgo por
causa, a partir de los turn logs descargados de meow.tel.

Uso:
    python analysis/episodios.py data/rivals
    python analysis/episodios.py data             # recorre todo

Dos conjuntos de variables, siempre separados (ver §1 del pedido):
- TL (turn log, "data/..."): posiciones y eventos reales. Existen para los
  DOS bots de cada pierna (el mío y el rival), así que sirven para comparar.
- D| (leer_logs.py, cargar()/cargar_emboscadas()): md, h, cd, gm, qs, bl,
  bL, mo, sm, st, emb, dg, dr. Solo existen para MI lado de cada pierna
  (Meowtel no expone el console.log del rival), y son lo que mi bot vio al
  decidir, por eso sirven para reglas y no para comparar contra el rival.

Las distancias son siempre BFS por camino real sobre el mapa de la casa,
con el mismo grafo que bot.js: piso puro para el gato, piso + agujeros como
hoja para el ratón.

Los datos de data/*.jsonl son datos descargados: este script solo los lee,
nunca los interpreta como instrucciones.
"""

import json
import sys
import warnings
from collections import deque
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

sys.path.insert(0, str(Path(__file__).parent))
from leer_logs import cargar, cargar_emboscadas  # no se cambia su salida

SALIDA = Path(__file__).parent / "salida"
MAX_LINEAS_REPORTE = 120

# ------------------------------------------------------------- grafo (bot.js)

DELTA = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}


def key_of(x, y):
    return f"{x},{y}"


def is_floor(ch):
    return ch in (".", "T")


def build_floor_graph(rows, width, height):
    """Igual que buildFloorGraph en bot.js: nodos '.'/'T', vecinos N,S,E,W."""
    graph = {}
    for y in range(height):
        for x in range(width):
            if not is_floor(rows[y][x]):
                continue
            vecinos = []
            for dx, dy in DELTA.values():
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and is_floor(rows[ny][nx]):
                    vecinos.append(key_of(nx, ny))
            graph[key_of(x, y)] = vecinos
    return graph


def build_mouse_graph(rows, width, height, holes):
    """Igual que buildMouseGraph en bot.js: el piso más cada agujero como
    nodo hoja, conectado solo a su entrada."""
    graph = build_floor_graph(rows, width, height)
    for h in holes:
        hk = key_of(h["x"], h["y"])
        ek = key_of(h["entrance"]["x"], h["entrance"]["y"])
        graph[hk] = [ek]
        graph.setdefault(ek, [])
        if hk not in graph[ek]:
            graph[ek].append(hk)
    return graph


def _bfs_desde(graph, origen):
    dist = {origen: 0}
    cola = deque([origen])
    while cola:
        cur = cola.popleft()
        for vecino in graph.get(cur, []):
            if vecino not in dist:
                dist[vecino] = dist[cur] + 1
                cola.append(vecino)
    return dist


class Distancias:
    """BFS cacheado por grafo + casilla de origen (no se recalcula por turno)."""

    def __init__(self, graph):
        self.graph = graph
        self._cache = {}

    def dist(self, a, b):
        if a is None or b is None:
            return None
        if a not in self._cache:
            self._cache[a] = _bfs_desde(self.graph, a)
        return self._cache[a].get(b)

    def mas_cercano(self, origen, destinos):
        """(destino, distancia) del más cercano a origen entre destinos, o (None, None)."""
        if origen not in self._cache:
            self._cache[origen] = _bfs_desde(self.graph, origen)
        tabla = self._cache[origen]
        mejor = None
        for d in destinos:
            dist = tabla.get(d)
            if dist is not None and (mejor is None or dist < mejor[1]):
                mejor = (d, dist)
        return mejor if mejor else (None, None)


# --------------------------------------------------------------- carga de TL


def leer_pierna(ruta: Path):
    """Lee un turn log completo (cabecera + turnos). None si no es válido.

    SUPUESTO: "mi rol" sale de header["you"] (lo pone Meowtel, no el nombre
    del archivo: en data/v3 el nombre de archivo está invertido respecto al
    rol real -- "timothy_m1_cat.jsonl" tiene you=mouse). Se cruza con la
    fila D| para avisar si no coincide, pero header["you"] es el que manda.
    """
    try:
        texto = ruta.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    lineas = texto.splitlines()
    if not lineas:
        return None
    try:
        header = json.loads(lineas[0])
    except json.JSONDecodeError:
        return None
    if not isinstance(header, dict):
        return None
    mapa = header.get("map")
    reglas = header.get("rules")
    if not mapa or not reglas:
        return None
    mi_rol = header.get("you")
    if mi_rol not in ("cat", "mouse"):
        return None

    holes = mapa["holes"]
    holes_keys = {key_of(h["x"], h["y"]): i for i, h in enumerate(holes)}
    entrance_keys = [key_of(h["entrance"]["x"], h["entrance"]["y"]) for h in holes]

    turnos = []
    for linea in lineas[1:]:
        try:
            t = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if not isinstance(t, dict):
            continue
        if not t.get("turn"):
            continue  # turno 0: estado inicial, antes del primer act()
        turnos.append(t)

    # "match": identificador legible de la pierna. El nombre de archivo ya
    # no es confiable para esto (v5 usa <rival>_<version>_<fecha>_<rol>_
    # <casa>.jsonl, sin número de partida); house_id (header["house"], el
    # hash de la casa de Meowtel) es la clave real para EMPAREJAR las dos
    # piernas de un mismo match (§E), así que se guarda aparte.
    partes = ruta.stem.split("_")
    house_id = header.get("house") or ruta.stem
    jugadores = header.get("players") or {}
    rival_rol = "cat" if mi_rol == "mouse" else "mouse"
    resultado_raw = header.get("result") or {}
    score = resultado_raw.get("score") or {}
    mis_puntos, puntos_rival = score.get(mi_rol), score.get(rival_rol)
    if mis_puntos is None or puntos_rival is None:
        resultado_partida = None
    elif mis_puntos > puntos_rival:
        resultado_partida = "ganada"
    elif mis_puntos < puntos_rival:
        resultado_partida = "perdida"
    else:
        resultado_partida = "empate"

    return {
        "ruta": ruta,
        "version": ruta.parent.name,
        "archivo": ruta.name,
        "rival": (jugadores.get(rival_rol) or partes[0]).lower(),
        "match": house_id,
        "house_id": house_id,
        "mi_rol": mi_rol,
        "house_type": header.get("houseType"),
        "w": mapa["width"],
        "hg": mapa["height"],
        "hc": len(holes),
        "holes": holes,
        "holes_keys": holes_keys,
        "entrance_keys": entrance_keys,
        "rows": mapa["rows"],
        "reglas": reglas,
        "maxTurns": reglas.get("maxTurns"),
        "hidingTaxEvery": reglas.get("hidingTaxEvery", 15),
        "catchPoints": reglas.get("catchPoints", 3),
        "cheesePoints": reglas.get("cheesePoints", 3),
        "resultado": resultado_raw,
        "resultado_partida": resultado_partida,
        "turnos": turnos,
        "floor_graph": build_floor_graph(mapa["rows"], mapa["width"], mapa["height"]),
        "mouse_graph": build_mouse_graph(mapa["rows"], mapa["width"], mapa["height"], holes),
    }


def listar_piernas(carpeta):
    base = Path(carpeta)
    piernas = []
    avisos = []
    archivos = sorted(base.rglob("*.jsonl")) if base.is_dir() else [base]
    for ruta in archivos:
        if not ruta.is_file():
            continue
        p = leer_pierna(ruta)
        if p is None:
            avisos.append(f"aviso: {ruta.name} no tiene cabecera/mapa válido, se saltea")
            continue
        piernas.append(p)
    return piernas, avisos


def _pos_key(animal):
    if animal is None:
        return None
    return key_of(animal["x"], animal["y"])


def _escondido(pierna, animal, es_raton):
    if animal is None:
        return False
    if es_raton and animal.get("tunnel") is not None:
        return True
    return _pos_key(animal) in pierna["holes_keys"]


# ----------------------------------------------------- control de calidad


def control_calidad(piernas):
    """§QC: turnos == maxTurns, y puntos de eventos == marcador final.
    Devuelve (piernas_ok, lineas_de_aviso)."""
    ok = []
    avisos = []
    for p in piernas:
        n_turnos = len(p["turnos"])
        if p["maxTurns"] and n_turnos != p["maxTurns"]:
            avisos.append(f"QC {p['archivo']}: {n_turnos} turnos != maxTurns {p['maxTurns']} -> excluida")
            continue
        catches = delivered = dropped = hidingtax = 0
        for t in p["turnos"]:
            for e in t.get("events") or []:
                tipo = e.get("type")
                if tipo == "caught":
                    catches += 1
                elif tipo == "delivered":
                    delivered += 1
                elif tipo == "dropped":
                    dropped += 1
                elif tipo == "hidingTax":
                    hidingtax += 1
        score = p["resultado"].get("score") or {}
        cat_calc = p["catchPoints"] * catches + hidingtax
        mouse_calc = p["cheesePoints"] * delivered
        cat_real = score.get("cat")
        mouse_real = score.get("mouse")
        if cat_real != cat_calc or mouse_real != mouse_calc:
            avisos.append(
                f"QC {p['archivo']}: marcador no cuadra "
                f"(cat real={cat_real} calc={cat_calc}, mouse real={mouse_real} calc={mouse_calc}) -> excluida"
            )
            continue
        stats = p["resultado"].get("stats") or {}
        if stats:
            if stats.get("catches") not in (None, catches) or stats.get("delivered") not in (None, delivered) \
                    or stats.get("dropped") not in (None, dropped):
                avisos.append(f"QC {p['archivo']}: stats del header no coincide con eventos contados (se avisa, no se excluye)")
        p["catches"], p["delivered"], p["dropped"], p["hidingtax"] = catches, delivered, dropped, hidingtax
        ok.append(p)
    return ok, avisos


# --------------------------------------------------------- episodios: ratón


def _casa_sig(p):
    return f"{p['w']}x{p['hg']}_{p['hc']}h"


def episodios_raton_de_pierna(p):
    """§2: episodios del ratón de ESTA pierna (TL). bot='mio' si mi_rol es
    'mouse' en esta pierna, 'rival' si mi_rol es 'cat' (el ratón que juega
    acá es el del rival). Un mismo pierna da SIEMPRE episodios de ratón:
    el ratón es uno de los dos animales de la pierna, sin importar de quién.
    """
    bot = "mio" if p["mi_rol"] == "mouse" else "rival"
    dist = Distancias(p["floor_graph"])
    mouse_graph_dist = Distancias(p["mouse_graph"])
    episodios = []

    # turno0 (estado inicial, no está en p["turnos"]): el ratón arranca
    # adentro de un agujero. Lo usamos solo para inicializar "prev_escondido".
    prev_escondido = True
    activo = None
    turnos_impuesto_pendientes = 0  # hidingTax vistos desde el fin del episodio anterior

    for t in p["turnos"]:
        turno = t["turn"]
        raton = t.get("mouse")
        gato = t.get("cat")
        if raton is None:
            prev_escondido = True
            continue
        escondido = _escondido(p, raton, es_raton=True)
        eventos = [e.get("type") for e in (t.get("events") or [])]
        for e in t.get("events") or []:
            if e.get("type") == "hidingTax":
                turnos_impuesto_pendientes += 1

        if activo is None:
            if prev_escondido and not escondido:
                activo = {
                    "turno_inicio": turno,
                    "pos_inicio": _pos_key(raton),
                    "fase": "IDA",
                    "turno_cambio_fase": None,
                    "pos_cambio_fase": None,
                    "turnos_ida": 0,
                    "turnos_vuelta": 0,
                    "dist_min_gato": None,
                    "turnos_bajo_mesa": 0,
                    "turnos_totales": 0,
                    "impuesto_antes": turnos_impuesto_pendientes,
                }
                turnos_impuesto_pendientes = 0
        else:
            activo["turnos_totales"] += 1
            if activo["fase"] == "IDA":
                activo["turnos_ida"] += 1
            else:
                activo["turnos_vuelta"] += 1
            if p["rows"][raton["y"]][raton["x"]] == "T":
                activo["turnos_bajo_mesa"] += 1
            if gato is not None:
                d = dist.dist(_pos_key(raton), _pos_key(gato))
                if d is not None and (activo["dist_min_gato"] is None or d < activo["dist_min_gato"]):
                    activo["dist_min_gato"] = d

            if activo["fase"] == "IDA" and raton.get("carrying"):
                activo["fase"] = "VUELTA"
                activo["turno_cambio_fase"] = turno
                activo["pos_cambio_fase"] = _pos_key(raton)

            fin = None
            puntos = 0
            if "caught" in eventos:
                fin, puntos = "caught", -p["catchPoints"]
            elif "delivered" in eventos:
                fin, puntos = "delivered", p["cheesePoints"]
            elif "dropped" in eventos:
                fin, puntos = "dropped", 0
            elif escondido and not raton.get("carrying") and activo["fase"] == "IDA":
                fin, puntos = "vuelve_sin_queso", 0

            if fin is not None:
                pos_fin = _pos_key(raton)
                bfs_ida = mouse_graph_dist.dist(activo["pos_inicio"], activo["pos_cambio_fase"] or pos_fin)
                bfs_vuelta = (
                    mouse_graph_dist.dist(activo["pos_cambio_fase"], pos_fin)
                    if activo["pos_cambio_fase"] else None
                )
                episodios.append({
                    "bot": bot, "rival": p["rival"], "version": p["version"], "archivo": p["archivo"],
                    "match": p["match"], "casa": _casa_sig(p), "house_type": p["house_type"], "resultado_partida": p["resultado_partida"],
                    "w": p["w"], "hg": p["hg"], "hc": p["hc"],
                    "turno_inicio": activo["turno_inicio"], "turno_fin": turno, "fin": fin, "puntos": puntos,
                    "turnos_ida": activo["turnos_ida"], "turnos_vuelta": activo["turnos_vuelta"],
                    "bfs_ida": bfs_ida, "bfs_vuelta": bfs_vuelta,
                    "razon_ida": (activo["turnos_ida"] / bfs_ida) if bfs_ida else None,
                    "razon_vuelta": (activo["turnos_vuelta"] / bfs_vuelta) if bfs_vuelta else None,
                    "dist_min_gato": activo["dist_min_gato"],
                    "pct_bajo_mesa": activo["turnos_bajo_mesa"] / activo["turnos_totales"] if activo["turnos_totales"] else None,
                    "impuesto_antes": activo["impuesto_antes"],
                })
                activo = None

        prev_escondido = escondido

    if activo is not None:
        episodios.append({
            "bot": bot, "rival": p["rival"], "version": p["version"], "archivo": p["archivo"],
            "match": p["match"], "casa": _casa_sig(p), "house_type": p["house_type"], "resultado_partida": p["resultado_partida"],
            "w": p["w"], "hg": p["hg"], "hc": p["hc"],
            "turno_inicio": activo["turno_inicio"], "turno_fin": p["maxTurns"], "fin": "fin_partida", "puntos": 0,
            "turnos_ida": activo["turnos_ida"], "turnos_vuelta": activo["turnos_vuelta"],
            "bfs_ida": None, "bfs_vuelta": None, "razon_ida": None, "razon_vuelta": None,
            "dist_min_gato": activo["dist_min_gato"],
            "pct_bajo_mesa": activo["turnos_bajo_mesa"] / activo["turnos_totales"] if activo["turnos_totales"] else None,
            "impuesto_antes": activo["impuesto_antes"],
        })
    return episodios


# ---------------------------------------------------------- episodios: gato


def episodios_gato_de_pierna(p, df_d_pierna, df_emb_pierna):
    """§3: episodios del gato de ESTA pierna (TL + D| cuando es mío).
    bot='mio' si mi_rol es 'cat' en esta pierna (el gato es el mío y el
    ratón que levanta el queso es el rival); 'rival' si mi_rol es 'mouse'
    (el gato es el rival y el que levanta el queso soy yo).

    Inicio: evento pickup. Si se suelta y se vuelve a levantar, es un
    episodio NUEVO (consigna §3): no hay estado "entre pickups" que una dos
    pickups separados por un dropped.
    """
    bot = "mio" if p["mi_rol"] == "cat" else "rival"
    # D| del gato (md, mo, sm, emb/dg/dr) solo existe cuando el gato de esta
    # pierna es el mío: en una pierna donde mi_rol es "mouse", las filas D|
    # son del RATÓN (mío), no del gato rival -- no hay que mezclarlas acá.
    tiene_d = bot == "mio" and not df_d_pierna.empty
    dist_cat = Distancias(p["floor_graph"])
    dist_raton_graph = Distancias(p["mouse_graph"])
    entrance_por_hole = {i: key_of(h["entrance"]["x"], h["entrance"]["y"]) for i, h in enumerate(p["holes"])}
    holes_tile_keys = list(p["holes_keys"].keys())

    episodios = []
    activo = None

    for t in p["turnos"]:
        turno = t["turn"]
        gato = t.get("cat")
        raton = t.get("mouse")
        eventos = [e.get("type") for e in (t.get("events") or [])]

        if "pickup" in eventos:
            if activo is not None:
                # No debería pasar (un pickup nuevo sin haber cerrado el
                # anterior): se cierra como censurado para no perder datos.
                episodios.append(_cerrar_episodio_gato(p, bot, activo, turno - 1, "censurado_solape", 0))
            pickup_ev = next(e for e in t.get("events") or [] if e.get("type") == "pickup")
            pickup_key = key_of(pickup_ev["x"], pickup_ev["y"])
            hole_cercano, d_raton = dist_raton_graph.mas_cercano(pickup_key, holes_tile_keys)
            entrada = entrance_por_hole.get(p["holes_keys"].get(hole_cercano)) if hole_cercano else None
            d_gato = dist_cat.dist(key_of(gato["x"], gato["y"]), entrada) if gato and entrada else None
            activo = {
                "turno_inicio": turno, "pickup_key": pickup_key,
                "entrada_cercana": entrada, "d_gato_entrada": d_gato, "d_raton_entrada": d_raton,
                "turnos": 0, "turnos_mo_visto": 0, "sm_max": None, "emb": None, "dg": None, "dr": None,
            }
            continue

        if activo is None:
            continue

        activo["turnos"] += 1
        if tiene_d:
            fila = df_d_pierna[df_d_pierna["t"] == turno]
            if not fila.empty:
                f = fila.iloc[0]
                if f.get("mouse") is not None and isinstance(f.get("mouse"), list):
                    activo["turnos_mo_visto"] += 1
                sm = f.get("scentMax")
                if sm is not None and (activo["sm_max"] is None or sm > activo["sm_max"]):
                    activo["sm_max"] = sm
                activo["ultimo_md"] = f.get("modo")
        if bot == "mio" and df_emb_pierna is not None and not df_emb_pierna.empty:
            fila_e = df_emb_pierna[df_emb_pierna["t"] == turno]
            if not fila_e.empty:
                fe = fila_e.iloc[0]
                activo["emb"], activo["dg"], activo["dr"] = fe.get("emb"), fe.get("dg"), fe.get("dr")

        fin = None
        puntos = 0
        if "caught" in eventos:
            fin, puntos = "caught", p["catchPoints"]
        elif "delivered" in eventos:
            fin, puntos = "delivered", -p["cheesePoints"]
        elif "dropped" in eventos:
            fin, puntos = "dropped", 0
        if fin is not None:
            episodios.append(_cerrar_episodio_gato(p, bot, activo, turno, fin, puntos))
            activo = None

    if activo is not None:
        episodios.append(_cerrar_episodio_gato(p, bot, activo, p["maxTurns"], "fin_partida", 0))
    return episodios


def _cerrar_episodio_gato(p, bot, activo, turno_fin, fin, puntos):
    return {
        "bot": bot, "rival": p["rival"], "version": p["version"], "archivo": p["archivo"],
        "match": p["match"], "casa": _casa_sig(p), "house_type": p["house_type"], "resultado_partida": p["resultado_partida"],
        "w": p["w"], "hg": p["hg"], "hc": p["hc"],
        "turno_inicio": activo["turno_inicio"], "turno_fin": turno_fin, "fin": fin, "puntos": puntos,
        "turnos": activo["turnos"],
        "d_gato_entrada": activo["d_gato_entrada"], "d_raton_entrada": activo["d_raton_entrada"],
        "llego_a_tiempo": (activo["d_gato_entrada"] <= activo["d_raton_entrada"])
        if (activo["d_gato_entrada"] is not None and activo["d_raton_entrada"] is not None) else None,
        "pct_turnos_raton_visto": (activo["turnos_mo_visto"] / activo["turnos"]) if activo["turnos"] else None,
        "sm_max": activo["sm_max"], "emb": activo["emb"], "dg": activo["dg"], "dr": activo["dr"],
        "modo_al_cierre": activo.get("ultimo_md"),
    }


# ----------------------------------------------- tablas por turno (§C y §D)


def _fila_d(df_d_pierna, turno):
    if df_d_pierna is None or df_d_pierna.empty:
        return None
    fila = df_d_pierna[df_d_pierna["t"] == turno]
    return fila.iloc[0] if not fila.empty else None


def turnos_raton_de_pierna(p, df_d_pierna):
    """§C: una fila por turno del ratón FUERA del agujero, dentro de un
    episodio. y_captura/y_entrega = 1 si ESTE turno termina en ese evento
    (el TL de este turno ya es el resultado de la acción de este turno,
    así que no hace falta desplazar el índice)."""
    bot = "mio" if p["mi_rol"] == "mouse" else "rival"
    tiene_d = bot == "mio" and df_d_pierna is not None and not df_d_pierna.empty
    dist = Distancias(p["floor_graph"])
    filas = []
    prev_escondido = True
    prev_pos_raton = prev_pos_gato = None
    activo = False
    fase = "IDA"
    turno_inicio = None

    for t in p["turnos"]:
        turno = t["turn"]
        raton = t.get("mouse")
        gato = t.get("cat")
        if raton is None:
            prev_escondido = True
            prev_pos_raton = prev_pos_gato = None
            continue
        escondido = _escondido(p, raton, es_raton=True)
        eventos = [e.get("type") for e in (t.get("events") or [])]

        if not activo and prev_escondido and not escondido:
            activo, fase, turno_inicio = True, "IDA", turno

        if activo:
            # Un "caught" teletransporta al ratón A UN AGUJERO en el mismo
            # turno (igual con "delivered"): `escondido` ya daría True acá,
            # pero la fila de ESTE turno (donde pasó el evento) igual tiene
            # que quedar, por eso el gate es "activo", no "not escondido".
            fila = {
                "bot": bot, "rival": p["rival"], "archivo": p["archivo"], "version": p["version"],
                "casa": _casa_sig(p), "hc": p["hc"], "resultado_partida": p["resultado_partida"],
                "turno": turno, "turno_episodio": turno - turno_inicio + 1, "fase": fase,
                "carrying": int(bool(raton.get("carrying"))),
                "bajo_mesa": int(p["rows"][raton["y"]][raton["x"]] == "T"),
                "cd_real": dist.dist(prev_pos_raton, prev_pos_gato) if prev_pos_raton and prev_pos_gato else None,
                "y_captura": int("caught" in eventos), "y_entrega": int("delivered" in eventos),
            }
            if tiene_d:
                f = _fila_d(df_d_pierna, turno)
                if f is not None:
                    fila.update({
                        "md": f.get("modo"), "h": f.get("heavy"), "cd_d": f.get("cd"),
                        "gm": f.get("gm"), "qs": f.get("qs"), "bl": f.get("bell"), "bL": f.get("bellLoud"),
                    })
            filas.append(fila)
            if fase == "IDA" and raton.get("carrying"):
                fase = "VUELTA"
            if "caught" in eventos or "delivered" in eventos or "dropped" in eventos or \
                    (escondido and not raton.get("carrying") and fase == "IDA"):
                activo = False

        prev_escondido = escondido
        prev_pos_raton = _pos_key(raton)
        prev_pos_gato = _pos_key(gato) if gato else None
    return filas


def turnos_gato_de_pierna(p, df_d_pierna):
    """§C: una fila por turno de cada episodio del gato (desde el pickup
    hasta su cierre, inclusive). dist_entrada es TL (distancia real del
    gato a la entrada que se fijó al pickup); raton_visto/sm son D| (solo
    si bot es mío)."""
    bot = "mio" if p["mi_rol"] == "cat" else "rival"
    tiene_d = bot == "mio" and df_d_pierna is not None and not df_d_pierna.empty
    dist_cat = Distancias(p["floor_graph"])
    dist_raton_graph = Distancias(p["mouse_graph"])
    entrance_por_hole = {i: key_of(h["entrance"]["x"], h["entrance"]["y"]) for i, h in enumerate(p["holes"])}
    holes_tile_keys = list(p["holes_keys"].keys())

    filas = []
    activo = False
    turno_inicio = entrada = None

    for t in p["turnos"]:
        turno = t["turn"]
        gato = t.get("cat")
        eventos = [e.get("type") for e in (t.get("events") or [])]
        if "pickup" in eventos:
            activo, turno_inicio = True, turno
            pickup_ev = next(e for e in t.get("events") or [] if e.get("type") == "pickup")
            hole_cercano, _ = dist_raton_graph.mas_cercano(key_of(pickup_ev["x"], pickup_ev["y"]), holes_tile_keys)
            entrada = entrance_por_hole.get(p["holes_keys"].get(hole_cercano)) if hole_cercano else None
        if not activo:
            continue
        fila = {
            "bot": bot, "rival": p["rival"], "archivo": p["archivo"], "version": p["version"],
            "casa": _casa_sig(p), "hc": p["hc"], "resultado_partida": p["resultado_partida"],
            "turno": turno, "turno_episodio": turno - turno_inicio,
            "dist_entrada": dist_cat.dist(key_of(gato["x"], gato["y"]), entrada) if gato and entrada else None,
            "y_captura": int("caught" in eventos), "y_entrega": int("delivered" in eventos),
        }
        if tiene_d:
            f = _fila_d(df_d_pierna, turno)
            if f is not None:
                mo = f.get("mouse")
                fila["md"] = f.get("modo")
                fila["raton_visto"] = int(mo is not None and isinstance(mo, list))
                fila["sm"] = f.get("scentMax")
        filas.append(fila)
        if "caught" in eventos or "delivered" in eventos or "dropped" in eventos:
            activo = False
    return filas


def tramos(serie, cortes, etiquetas):
    """Discretiza una Serie numérica en tramos fijos; NaN queda como "null"
    (categoría propia, no se descarta: así entra al modelo igual que un
    "no hay gato" real, en vez de perderse la fila)."""
    out = pd.cut(serie, bins=cortes, labels=etiquetas, right=True, include_lowest=True)
    return out.astype(object).where(serie.notna(), "null")


# -------------------------------------------- dirección (para §H, visión)


def _primer_paso(graph, origen, destino):
    """Dirección del primer paso en el camino BFS más corto origen->destino
    (mismo desempate N,S,E,W que bfsFirstStep en bot.js), o None si no hay
    camino o ya está ahí."""
    if origen == destino:
        return None
    visitado, padre = {origen}, {}
    cola = deque([origen])
    while cola:
        cur = cola.popleft()
        for dir_, (dx, dy) in DELTA.items():
            x, y = map(int, cur.split(","))
            vecino = key_of(x + dx, y + dy)
            if vecino not in graph.get(cur, []) or vecino in visitado:
                continue
            visitado.add(vecino)
            padre[vecino] = (cur, dir_)
            if vecino == destino:
                nodo = vecino
                while padre[nodo][0] != origen:
                    nodo = padre[nodo][0]
                return padre[nodo][1]
            cola.append(vecino)
    return None


_OPUESTA = {"N": "S", "S": "N", "E": "W", "W": "E"}
_PERPENDICULAR = {"N": {"E", "W"}, "S": {"E", "W"}, "E": {"N", "S"}, "W": {"N", "S"}}


def clasificar_mirada(pierna, pos_cat, facing, direccion_objetivo):
    """DE_FRENTE/DE_COSTADO/DE_ESPALDAS/MIRA_PARED (§H.1). MIRA_PARED tiene
    prioridad: si la casilla de adelante no es piso, no importa hacia dónde
    "debería" mirar para el objetivo."""
    x, y = map(int, pos_cat.split(","))
    dx, dy = DELTA[facing]
    nx, ny = x + dx, y + dy
    if not (0 <= nx < pierna["w"] and 0 <= ny < pierna["hg"]) or not is_floor(pierna["rows"][ny][nx]):
        return "MIRA_PARED"
    if direccion_objetivo is None:
        return None
    if facing == direccion_objetivo:
        return "DE_FRENTE"
    if facing == _OPUESTA[direccion_objetivo]:
        return "DE_ESPALDAS"
    return "DE_COSTADO"


# ------------------------------------------------------ §D riesgo por causa


def ajustar_logit(df, y_col, variables, cluster_col, nombre, min_eventos_por_var=10):
    """Logit con errores agrupados por partida. Si hay menos de
    min_eventos_por_var eventos por variable, se avisa y se recorta la
    lista de variables (se sacan de atrás para adelante) hasta que entre o
    hasta quedarse sin ninguna."""
    datos = df.dropna(subset=[cluster_col]).copy()
    eventos = int(datos[y_col].sum())
    usar = list(variables)
    avisos = []

    def armar_X(cols):
        X = pd.DataFrame(index=datos.index)
        for v in cols:
            X = pd.concat([X, pd.get_dummies(datos[v].astype(str), prefix=v, drop_first=True, dtype=float)], axis=1)
        return sm.add_constant(X, has_constant="add")

    while usar:
        X = armar_X(usar)
        n_params = X.shape[1] - 1
        if n_params == 0 or eventos >= min_eventos_por_var * n_params:
            break
        avisos.append(f"{nombre}: {eventos} eventos insuficientes para {n_params} parámetros, se sacan variables")
        usar = usar[:-1]

    if not usar:
        return {"nombre": nombre, "avisos": avisos + [f"{nombre}: muy pocos eventos ({eventos}), no se ajusta modelo"],
                "n_eventos": eventos, "n_obs": len(datos), "tabla": pd.DataFrame()}

    X = armar_X(usar)
    y = datos[y_col].astype(float)
    try:
        modelo = sm.Logit(y, X.astype(float))
        resultado = modelo.fit(disp=0, maxiter=200, cov_type="cluster", cov_kwds={"groups": datos[cluster_col].values})
    except Exception as e:  # separación perfecta, matriz singular, no converge, etc.
        avisos.append(f"{nombre}: no converge con {usar} ({type(e).__name__}); se prueba con menos variables")
        if len(usar) > 1:
            return ajustar_logit(df, y_col, usar[:-1], cluster_col, nombre, min_eventos_por_var)
        return {"nombre": nombre, "avisos": avisos, "n_eventos": eventos, "n_obs": len(datos), "tabla": pd.DataFrame()}

    # Separación perfecta: a veces no tira excepción, pero el coeficiente
    # se va a un número absurdo con IC en NaN/infinito (pasa cuando una
    # variable predice el resultado de forma tautológica). Se trata igual
    # que un "no converge" y se prueba con menos variables.
    ci_raw = resultado.conf_int()
    separado = resultado.params.abs().max() > 15 or not np.isfinite(ci_raw.values).all()
    if separado:
        avisos.append(f"{nombre}: separación perfecta con {usar} (coeficiente o IC no finito); se prueba con menos variables")
        if len(usar) > 1:
            return ajustar_logit(df, y_col, usar[:-1], cluster_col, nombre, min_eventos_por_var)
        return {"nombre": nombre, "avisos": avisos, "n_eventos": eventos, "n_obs": len(datos), "tabla": pd.DataFrame()}

    or_ = np.exp(resultado.params)
    ci = np.exp(ci_raw)
    tabla = pd.DataFrame({"odds_ratio": or_, "ci95_bajo": ci[0], "ci95_alto": ci[1]})
    return {"nombre": nombre, "avisos": avisos, "n_eventos": eventos, "n_obs": len(datos), "tabla": tabla, "variables": usar}


# --------------------------------------------------- §E comparación pareada


def comparacion_pareada(piernas_ok):
    """Una fila por partida (dos piernas con el mismo house_id): puntos de
    mi ratón/gato y del ratón/gato rival, más la diferencia por rol."""
    por_house = {}
    for p in piernas_ok:
        por_house.setdefault(p["house_id"], {}).setdefault(p["mi_rol"], []).append(p)

    filas = []
    for house_id, lados in por_house.items():
        if "mouse" not in lados or "cat" not in lados:
            continue  # pierna sin su pareja (no se puede comparar)
        p_mouse, p_cat = lados["mouse"][0], lados["cat"][0]
        score_m, score_c = p_mouse["resultado"].get("score") or {}, p_cat["resultado"].get("score") or {}
        mi_raton, raton_rival = score_m.get("mouse"), score_c.get("mouse")
        mi_gato, gato_rival = score_c.get("cat"), score_m.get("cat")
        if None in (mi_raton, raton_rival, mi_gato, gato_rival):
            continue
        filas.append({
            "rival": p_mouse["rival"], "casa": _casa_sig(p_mouse), "house_type": p_mouse["house_type"],
            "mi_raton": mi_raton, "raton_rival": raton_rival, "diff_raton": mi_raton - raton_rival,
            "mi_gato": mi_gato, "gato_rival": gato_rival, "diff_gato": mi_gato - gato_rival,
        })
    return pd.DataFrame(filas)


def media_ic95(serie):
    serie = pd.Series(serie).dropna()
    n = len(serie)
    if n == 0:
        return None, None, None, 0
    media = serie.mean()
    if n < 2:
        return media, None, None, n
    sem = serie.std(ddof=1) / np.sqrt(n)
    return media, media - 1.96 * sem, media + 1.96 * sem, n


# ------------------------------------------------------- §F tasa ajustada


def tasa_ajustada(df_episodios, col_grupo, es_evento):
    """Beta-binomial por método de momentos: a partir de la tasa cruda de
    cada grupo, se estima (a, b) de la Beta que mejor explica la dispersión
    ENTRE grupos, y se devuelve, por grupo, la tasa cruda y la ajustada
    (eventos+a)/(episodios+a+b). Con 1 solo grupo o varianza nula entre
    grupos no se puede estimar (a,b) por momentos: se usa un prior débil
    (a=b=1, uniforme) y se avisa."""
    g = df_episodios.groupby(col_grupo).agg(
        episodios=("fin", "count"), eventos=("fin", lambda s: es_evento(s).sum()),
    )
    g = g[g["episodios"] > 0]
    if g.empty:
        return g, "sin datos"
    tasas = g["eventos"] / g["episodios"]
    aviso = None
    if len(g) < 2 or tasas.var(ddof=1) == 0 or pd.isna(tasas.var(ddof=1)):
        a, b = 1.0, 1.0
        aviso = f"{col_grupo}: no se pudo estimar (a,b) por momentos (pocos grupos o sin varianza); prior débil a=b=1"
    else:
        m, v = tasas.mean(), tasas.var(ddof=1)
        comun = m * (1 - m) / v - 1
        if comun <= 0:
            a, b = 1.0, 1.0
            aviso = f"{col_grupo}: varianza entre grupos implausible para Beta; prior débil a=b=1"
        else:
            a, b = m * comun, (1 - m) * comun
    g["tasa_cruda"] = tasas
    g["tasa_ajustada"] = (g["eventos"] + a) / (g["episodios"] + a + b)
    return g, aviso


# ---------------------------------------------------------- §G criterios v5


def criterios_v5(ep_raton_v5, ep_gato_v5, df_emb_v5, df_d_v5,
                  ep_raton_v31, ep_gato_v31, df_emb_v31, df_d_v31):
    """Compara el mecanismo de v5 contra v3.1 (data/rivals), pierna por
    pierna propia ("mio")."""
    out = []

    def pct_capturas_con_queso(ep):
        cap = ep[(ep["bot"] == "mio") & (ep["fin"] == "caught")]
        if cap.empty:
            return None, 0
        con_queso = (cap["turnos_vuelta"] > 0).sum()
        return con_queso / len(cap), len(cap)

    for etiqueta, ep in (("v5", ep_raton_v5), ("v3.1", ep_raton_v31)):
        pct, n = pct_capturas_con_queso(ep)
        out.append(f"% capturas con queso ({etiqueta}): {pct:.0%} (n={n})" if pct is not None else f"% capturas con queso ({etiqueta}): sin capturas")

    if df_d_v5 is not None and not df_d_v5.empty and "modo" in df_d_v5:
        soltar = df_d_v5[df_d_v5["modo"] == "SOLTAR"].sort_values(["archivo", "t"])
        n_soltar = len(soltar)
        n_gm1 = int((soltar["gm"] == 1).sum()) if "gm" in soltar else 0
        capturas_tras_soltar = 0
        for _, fila in soltar.iterrows():
            siguientes = df_d_v5[(df_d_v5["archivo"] == fila["archivo"]) & (df_d_v5["t"] > fila["t"]) & (df_d_v5["t"] <= fila["t"] + 5)]
            if "eventTypes" in siguientes and siguientes["eventTypes"].apply(lambda evs: isinstance(evs, list) and "caught" in evs).any():
                capturas_tras_soltar += 1
        out.append(f"SOLTAR: {n_soltar} veces (gm=1 en {n_gm1}); captura en los 5 turnos siguientes en {capturas_tras_soltar}")
    else:
        out.append("SOLTAR: sin datos D| (no es v5 o sin filas de ratón)")

    def rebote_posiciones(df_turnos, col_partida="archivo"):
        """Turnos donde la posición repite la de 2 turnos atrás (vaivén A,B,A)."""
        total = 0
        por_partida = {}
        for archivo, grupo in df_turnos.sort_values(["archivo", "t"]).groupby(col_partida):
            pos = list(zip(grupo["x"], grupo["y"])) if "x" in grupo else []
            n = sum(1 for i in range(2, len(pos)) if pos[i] == pos[i - 2] and pos[i] != pos[i - 1])
            por_partida[archivo] = n
            total += n
        return total, por_partida

    def media_trabado(df_d, rol, modo=None):
        if df_d is None or df_d.empty or "x" not in df_d:
            return None, 0
        sub = df_d[df_d["rol"] == rol]
        if modo is not None:
            sub = sub[sub.get("modo") == modo] if "modo" in sub else sub.iloc[0:0]
        total, por_partida = rebote_posiciones(sub)
        return (np.mean(list(por_partida.values())) if por_partida else 0.0), len(por_partida)

    media_v5, n_v5 = media_trabado(df_d_v5, "m")
    media_v31, n_v31 = media_trabado(df_d_v31, "m")
    out.append(f"Turnos trabado (ratón, vaivén A,B,A) por partida: v5={media_v5:.1f} (n={n_v5}), v3.1={media_v31:.1f} (n={n_v31})")
    media_o_v5, n_o_v5 = media_trabado(df_d_v5, "c", "SEGUIR_OLOR")
    media_o_v31, n_o_v31 = media_trabado(df_d_v31, "c", "SEGUIR_OLOR")
    out.append(f"Turnos de rebote en SEGUIR_OLOR por partida: v5={media_o_v5:.1f} (n={n_o_v5}), v3.1={media_o_v31:.1f} (n={n_o_v31})")

    if df_emb_v5 is not None and not df_emb_v5.empty:
        n_pickups_con_emb = len(df_emb_v5)
        n_emb1 = int((df_emb_v5["emb"] == 1).sum())
        out.append(f"Emboscadas a tiempo (v5): {n_emb1}/{n_pickups_con_emb} pickups ({n_emb1 / n_pickups_con_emb:.0%})")
    else:
        out.append("Emboscadas a tiempo (v5): sin líneas emb (0 pickups con gato mío, o v3.1)")

    entregas_rivales_v5 = ep_gato_v5[(ep_gato_v5["bot"] == "mio") & (ep_gato_v5["fin"] == "delivered")].groupby("archivo").size()
    entregas_rivales_v31 = ep_gato_v31[(ep_gato_v31["bot"] == "mio") & (ep_gato_v31["fin"] == "delivered")].groupby("archivo").size()
    out.append(
        f"Entregas rivales por partida: v5={entregas_rivales_v5.mean():.2f} (n={entregas_rivales_v5.shape[0]}), "
        f"v3.1={entregas_rivales_v31.mean():.2f} (n={entregas_rivales_v31.shape[0]})"
    )
    return out


# -------------------------------------------- §H validar visión del gato


def validar_vision_gato(piernas, df_d):
    """Solo piernas donde mi_rol es "cat". Devuelve 3 tablas:
    (miradas, primeras_vistas_antes_de_pickup, transiciones_visto_a_null)."""
    filas_mirada, primeras_vistas, transiciones = [], [], []

    for p in piernas:
        if p["mi_rol"] != "cat":
            continue
        dfp = df_d[df_d["archivo"] == p["archivo"]] if df_d is not None and not df_d.empty else df_d
        if dfp is None or dfp.empty:
            continue
        dist_cat = Distancias(p["floor_graph"])
        dist_raton_graph = Distancias(p["mouse_graph"])
        holes_tile_keys = list(p["holes_keys"].keys())
        entrance_por_hole = {i: key_of(h["entrance"]["x"], h["entrance"]["y"]) for i, h in enumerate(p["holes"])}

        prev_pos = None
        historial_mo = []  # (turno, visto, pos_decidir, facing, mo_val)
        for t in p["turnos"]:
            turno = t["turn"]
            gato = t.get("cat")
            if gato is None:
                continue
            pos_decidir, prev_pos = prev_pos, _pos_key(gato)
            if pos_decidir is None:
                continue
            f = _fila_d(dfp, turno)
            if f is None:
                continue
            modo, facing = f.get("modo"), f.get("facing")
            if modo in ("VIGILAR_QUESO", "EMBOSCADA"):
                hole_cercano, _ = dist_raton_graph.mas_cercano(pos_decidir, holes_tile_keys)
                entrada = entrance_por_hole.get(p["holes_keys"].get(hole_cercano)) if hole_cercano else None
                direccion = _primer_paso(p["floor_graph"], pos_decidir, entrada) if entrada else None
                clase = clasificar_mirada(p, pos_decidir, facing, direccion)
                if clase:
                    filas_mirada.append({"archivo": p["archivo"], "rival": p["rival"], "modo": modo, "clase": clase})
            mo_val = f.get("mouse")
            historial_mo.append((turno, mo_val is not None and isinstance(mo_val, list), pos_decidir, facing, mo_val))

        for t in p["turnos"]:
            eventos = [e.get("type") for e in (t.get("events") or [])]
            if "pickup" not in eventos:
                continue
            turno_pickup = t["turn"]
            ventana = [x for x in historial_mo if turno_pickup - 10 <= x[0] < turno_pickup]
            vio_antes = any(v for _, v, _, _, _ in ventana)
            primera = next((x for x in ventana if x[1]), None)
            de_frente_o_1 = None
            if primera:
                _, _, pos_v, facing_v, mo_v = primera
                dist_1 = dist_cat.dist(pos_v, key_of(mo_v[0], mo_v[1]))
                direccion_mouse = _primer_paso(p["floor_graph"], pos_v, key_of(mo_v[0], mo_v[1]))
                clase = clasificar_mirada(p, pos_v, facing_v, direccion_mouse)
                de_frente_o_1 = (clase == "DE_FRENTE") or (dist_1 == 1)
            primeras_vistas.append({
                "archivo": p["archivo"], "rival": p["rival"], "turno_pickup": turno_pickup,
                "vio_antes": vio_antes, "de_frente_o_1": de_frente_o_1,
            })

        for i in range(1, len(historial_mo)):
            turno_i, visto_i = historial_mo[i][0], historial_mo[i][1]
            visto_prev = historial_mo[i - 1][1]
            if visto_prev and not visto_i:
                eventos_ventana = [
                    e.get("type") for tt in p["turnos"] if turno_i <= tt["turn"] < turno_i + 10
                    for e in (tt.get("events") or [])
                ]
                resultado = "entrega" if "delivered" in eventos_ventana else ("captura" if "caught" in eventos_ventana else "nada")
                transiciones.append({"archivo": p["archivo"], "rival": p["rival"], "turno": turno_i, "resultado": resultado})

    return pd.DataFrame(filas_mirada), pd.DataFrame(primeras_vistas), pd.DataFrame(transiciones)


# ------------------------------------------- §I validar la carrera del ratón


def validar_carrera_raton(piernas, df_d):
    """Solo piernas donde mi_rol es "mouse". Por cada pickup: margen =
    cd (D|, gato visto o recordado) a la entrada del agujero más cercano al
    pickup, menos la distancia del ratón a ese mismo agujero sobre
    (1 - pPesado), con pPesado estimado en esa misma partida."""
    filas = []
    for p in piernas:
        if p["mi_rol"] != "mouse":
            continue
        dfp = df_d[df_d["archivo"] == p["archivo"]] if df_d is not None and not df_d.empty else df_d
        if dfp is None or dfp.empty:
            continue
        cargando = dfp[dfp.get("carrying") == 1] if "carrying" in dfp else dfp.iloc[0:0]
        p_pesado = (cargando["heavy"] == 1).mean() if not cargando.empty else 0.0
        if pd.isna(p_pesado):
            p_pesado = 0.0

        mouse_graph_dist = Distancias(p["mouse_graph"])
        holes_tile_keys = list(p["holes_keys"].keys())

        for t in p["turnos"]:
            eventos = [e.get("type") for e in (t.get("events") or [])]
            if "pickup" not in eventos:
                continue
            turno = t["turn"]
            raton = t.get("mouse")
            hole_cercano, d_raton = mouse_graph_dist.mas_cercano(_pos_key(raton), holes_tile_keys)
            if hole_cercano is None or p_pesado >= 1:
                continue
            f = _fila_d(dfp, turno)
            cd = f.get("cd") if f is not None else None
            if cd is None:
                continue
            margen = cd - (d_raton / (1 - p_pesado))

            resultado = None
            for tt in p["turnos"]:
                if tt["turn"] < turno:
                    continue
                evs = [e.get("type") for e in (tt.get("events") or [])]
                if "delivered" in evs:
                    resultado = "delivered"
                    break
                if "caught" in evs:
                    resultado = "caught"
                    break
            if resultado:
                filas.append({
                    "archivo": p["archivo"], "rival": p["rival"], "turno_pickup": turno,
                    "margen": margen, "resultado": resultado, "p_pesado": p_pesado,
                })
    return pd.DataFrame(filas)


# --------------------------------------------------------- aparte §B: cheeseSpawned -> pickup


def cheese_spawn_a_pickup(piernas_ok):
    filas = []
    for p in piernas_ok:
        dist_cat = Distancias(p["floor_graph"])
        turno_spawn = None
        cheese_prev = set()
        tile_nuevo = None
        for t in p["turnos"]:
            cheese_act = set(tuple(c) for c in (t.get("cheese") or []))
            eventos = [e.get("type") for e in (t.get("events") or [])]
            nuevos = cheese_act - cheese_prev
            if "cheeseSpawned" in eventos:
                turno_spawn = t["turn"]
                tile_nuevo = next(iter(nuevos), None)
                turnos_cerca = 0
                turnos_totales_spawn = 0
            elif turno_spawn is not None:
                gato = t.get("cat")
                if gato is not None and tile_nuevo is not None:
                    turnos_totales_spawn += 1
                    if dist_cat.dist(key_of(gato["x"], gato["y"]), key_of(*tile_nuevo)) is not None and \
                            dist_cat.dist(key_of(gato["x"], gato["y"]), key_of(*tile_nuevo)) <= 1:
                        turnos_cerca += 1
            if "pickup" in eventos and turno_spawn is not None:
                filas.append({
                    "archivo": p["archivo"], "mi_rol": p["mi_rol"],
                    "turnos_hasta_pickup": t["turn"] - turno_spawn,
                    "pct_gato_cerca": (turnos_cerca / turnos_totales_spawn) if turnos_totales_spawn else None,
                })
                turno_spawn = None
            cheese_prev = cheese_act
    return pd.DataFrame(filas)


# --------------------------------------------------------------------- top 3


def top3(df_ep_raton, df_ep_gato):
    """Las 3 situaciones (de un puñado de variables TL comparables entre mi
    bot y el rival) donde mi bot pierde más puntos por episodio que el
    rival en la MISMA situación."""
    candidatos = []

    if not df_ep_raton.empty and "dist_min_gato" in df_ep_raton:
        tmp = df_ep_raton.copy()
        tmp["bucket"] = tramos(tmp["dist_min_gato"], [-1, 2, 5, 9999], ["<=2", "3-5", ">5"])
        for bucket, g in tmp.groupby("bucket"):
            mio, riv = g[g.bot == "mio"]["puntos"], g[g.bot == "rival"]["puntos"]
            if len(mio) >= 3 and len(riv) >= 3:
                diff = riv.mean() - mio.mean()
                candidatos.append(("ratón", f"dist_min_gato={bucket}", diff, len(mio), mio.mean(), riv.mean(), "cd/gm (memoria del gato)"))

    if not df_ep_gato.empty and "d_gato_entrada" in df_ep_gato:
        tmp = df_ep_gato.copy()
        tmp["bucket"] = tramos(tmp["d_gato_entrada"], [-1, 2, 6, 9999], ["<=2", "3-6", ">6"])
        for bucket, g in tmp.groupby("bucket"):
            mio, riv = g[g.bot == "mio"]["puntos"], g[g.bot == "rival"]["puntos"]
            if len(mio) >= 3 and len(riv) >= 3:
                diff = riv.mean() - mio.mean()
                candidatos.append(("gato", f"d_gato_entrada={bucket}", diff, len(mio), mio.mean(), riv.mean(), "emb (emboscada a tiempo)"))

    if not df_ep_raton.empty:
        tmp = df_ep_raton.copy()
        tmp["bucket"] = tramos(tmp["hc"], [0, 2, 4, 999], ["1-2 agujeros", "3-4 agujeros", "5+ agujeros"])
        for bucket, g in tmp.groupby("bucket"):
            mio, riv = g[g.bot == "mio"]["puntos"], g[g.bot == "rival"]["puntos"]
            if len(mio) >= 3 and len(riv) >= 3:
                diff = riv.mean() - mio.mean()
                candidatos.append(("ratón", f"hc={bucket}", diff, len(mio), mio.mean(), riv.mean(), "mg (margen del agujero elegido)"))

    candidatos.sort(key=lambda c: c[2], reverse=True)
    return candidatos[:3]


# --------------------------------------------------------------------- CLI


def main(argv=None):
    carpeta = argv[0] if argv else (sys.argv[1] if len(sys.argv) > 1 else "data")
    lineas = []

    piernas, avisos_carga = listar_piernas(carpeta)
    piernas_ok, avisos_qc = control_calidad(piernas)

    lineas.append(f"=== CONTROL DE CALIDAD ({carpeta}) ===")
    lineas.append(f"piernas leídas: {len(piernas)} | OK: {len(piernas_ok)} | excluidas: {len(piernas) - len(piernas_ok)}")
    for a in (avisos_carga + avisos_qc)[:8]:
        lineas.append(f"  - {a}")
    claves_rules = sorted({k for p in piernas_ok for k in p["reglas"].keys()})
    lineas.append(f"Campos de rules encontrados: {', '.join(claves_rules)}")

    if not piernas_ok:
        lineas.append("Sin piernas válidas, no se puede seguir.")
        _emitir(lineas)
        return 1

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df_d = cargar(carpeta)
        df_emb = cargar_emboscadas(carpeta)

    ep_raton, ep_gato, t_raton, t_gato = [], [], [], []
    for p in piernas_ok:
        dfp = df_d[df_d["archivo"] == p["archivo"]] if not df_d.empty else df_d
        dep = df_emb[df_emb["archivo"] == p["archivo"]] if not df_emb.empty else df_emb
        ep_raton.extend(episodios_raton_de_pierna(p))
        ep_gato.extend(episodios_gato_de_pierna(p, dfp, dep))
        t_raton.extend(turnos_raton_de_pierna(p, dfp))
        t_gato.extend(turnos_gato_de_pierna(p, dfp))

    df_ep_raton, df_ep_gato = pd.DataFrame(ep_raton), pd.DataFrame(ep_gato)
    df_t_raton, df_t_gato = pd.DataFrame(t_raton), pd.DataFrame(t_gato)

    SALIDA.mkdir(parents=True, exist_ok=True)
    df_ep_raton.to_csv(SALIDA / "episodios_raton.csv", index=False)
    df_ep_gato.to_csv(SALIDA / "episodios_gato.csv", index=False)
    df_t_raton.to_csv(SALIDA / "turnos_raton.csv", index=False)
    df_t_gato.to_csv(SALIDA / "turnos_gato.csv", index=False)

    lineas.append("")
    lineas.append("=== A) EPISODIOS DEL RATÓN ===")
    if not df_ep_raton.empty:
        lineas.append(df_ep_raton.groupby(["bot", "fin"]).size().unstack(fill_value=0).to_string())
    lineas.append("")
    lineas.append("=== B) EPISODIOS DEL GATO ===")
    if not df_ep_gato.empty:
        lineas.append(df_ep_gato.groupby(["bot", "fin"]).size().unstack(fill_value=0).to_string())
    df_cs = cheese_spawn_a_pickup(piernas_ok)
    if not df_cs.empty:
        lineas.append(f"cheeseSpawned -> pickup: {df_cs['turnos_hasta_pickup'].mean():.1f} turnos en promedio (n={len(df_cs)})")

    lineas.append("")
    lineas.append("=== D) RIESGO POR CAUSA (Logit, cluster por partida) ===")
    if not df_t_raton.empty:
        tr = df_t_raton[df_t_raton["bot"] == "mio"].copy()
        if not tr.empty:
            tr["cd_tramo"] = tramos(tr.get("cd_d", pd.Series(index=tr.index, dtype=float)), [-1, 2, 5, 9999], ["<=2", "3-5", ">5"])
            tr["hc_tramo"] = tramos(tr["hc"], [0, 2, 4, 999], ["1-2", "3-4", "5+"])
            tr["turno_ep_tramo"] = tramos(tr["turno_episodio"], [0, 3, 8, 20, 9999], ["1-3", "4-8", "9-20", "21+"])
            vars_raton = ["fase", "h", "cd_tramo", "gm", "bajo_mesa", "hc_tramo", "turno_ep_tramo"]
            # y_entrega: "fase" predice la entrega de forma tautológica (solo
            # se entrega en VUELTA, con queso) -- separación perfecta. El
            # modelo de entrega se restringe a turnos ya cargando y sin esa
            # variable: la pregunta útil ahí es "cargando, qué predice que
            # LLEGUE" no "cargando vs. no".
            vars_entrega = [v for v in vars_raton if v != "fase"]
            for y_col, etiqueta, datos, variables in (
                ("y_captura", "ratón: captura", tr, vars_raton),
                # fase=="VUELTA" (no carrying==1: el "delivered" pasa al
                # entrar al agujero, y ahí "carrying" ya quedó en 0 el
                # mismo turno, pero la fila sigue marcada VUELTA).
                ("y_entrega", "ratón: entrega", tr[tr["fase"] == "VUELTA"], vars_entrega),
            ):
                m = ajustar_logit(datos, y_col, variables, "archivo", etiqueta)
                for a in m["avisos"]:
                    lineas.append(f"  aviso: {a}")
                lineas.append(f"{etiqueta} (n_obs={m['n_obs']}, n_eventos={m['n_eventos']}):")
                if not m["tabla"].empty:
                    lineas.append(m["tabla"].round(2).to_string())
    if not df_t_gato.empty:
        tg = df_t_gato[df_t_gato["bot"] == "mio"].copy()
        if not tg.empty and "dist_entrada" in tg:
            tg["dist_tramo"] = tramos(tg["dist_entrada"], [-1, 2, 6, 9999], ["<=2", "3-6", ">6"])
            tg["sm_tramo"] = tramos(tg.get("sm", pd.Series(index=tg.index, dtype=float)), [-0.01, 0.3, 0.6, 1.01], ["bajo", "medio", "alto"])
            tg["hc_tramo"] = tramos(tg["hc"], [0, 2, 4, 999], ["1-2", "3-4", "5+"])
            vars_gato = ["raton_visto", "sm_tramo", "dist_tramo", "md", "hc_tramo"]
            for y_col, etiqueta in (("y_entrega", "gato: entrega"), ("y_captura", "gato: captura")):
                m = ajustar_logit(tg, y_col, vars_gato, "archivo", etiqueta)
                for a in m["avisos"]:
                    lineas.append(f"  aviso: {a}")
                lineas.append(f"{etiqueta} (n_obs={m['n_obs']}, n_eventos={m['n_eventos']}):")
                if not m["tabla"].empty:
                    lineas.append(m["tabla"].round(2).to_string())

    lineas.append("")
    lineas.append("=== E) COMPARACIÓN PAREADA POR CASA ===")
    df_par = comparacion_pareada(piernas_ok)
    if not df_par.empty:
        for col in ("diff_raton", "diff_gato"):
            media, ic_b, ic_a, n = media_ic95(df_par[col])
            lineas.append(f"{col}: media={media:.2f} IC95%=[{ic_b and round(ic_b,2)}, {ic_a and round(ic_a,2)}] (n={n})")
        for tipo, g in df_par.groupby("house_type"):
            media, ic_b, ic_a, n = media_ic95(g["diff_raton"])
            lineas.append(f"  {tipo}: diff_raton media={media:.2f} (n={n})" if media is not None else f"  {tipo}: sin datos")
    else:
        lineas.append("sin partidas pareadas (faltan piernas de cat o mouse del mismo house_id)")

    lineas.append("")
    lineas.append("=== F) TASA AJUSTADA (beta-binomial) ===")
    if not df_ep_raton.empty:
        mio_raton = df_ep_raton[df_ep_raton.bot == "mio"].copy()
        for col_grupo in ("casa", "rival"):
            g, aviso = tasa_ajustada(mio_raton, col_grupo, lambda s: s == "caught")
            if aviso:
                lineas.append(f"  aviso: captura ratón por {col_grupo}: {aviso}")
            if not g.empty:
                lineas.append(f"Captura de mi ratón por {col_grupo}:")
                lineas.append(g[["episodios", "eventos", "tasa_cruda", "tasa_ajustada"]].round(3).to_string())
    if not df_ep_gato.empty:
        mio_gato = df_ep_gato[df_ep_gato.bot == "mio"].copy()
        for col_grupo in ("casa", "rival"):
            g, aviso = tasa_ajustada(mio_gato, col_grupo, lambda s: s == "delivered")
            if aviso:
                lineas.append(f"  aviso: entrega rival por {col_grupo}: {aviso}")
            if not g.empty:
                lineas.append(f"Entrega rival (contra mi gato) por {col_grupo}:")
                lineas.append(g[["episodios", "eventos", "tasa_cruda", "tasa_ajustada"]].round(3).to_string())

    if carpeta.rstrip("/\\").endswith("v5"):
        lineas.append("")
        lineas.append("=== G) CRITERIOS DE v5 (contra v3.1 en data/rivals) ===")
        piernas_v31, _ = listar_piernas("data/rivals")
        piernas_v31_ok, _ = control_calidad(piernas_v31)
        ep_raton_v31 = [e for p in piernas_v31_ok for e in episodios_raton_de_pierna(p)]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            df_d_v31, df_emb_v31 = cargar("data/rivals"), cargar_emboscadas("data/rivals")
        ep_gato_v31 = [e for p in piernas_v31_ok for e in episodios_gato_de_pierna(
            p, df_d_v31[df_d_v31["archivo"] == p["archivo"]] if not df_d_v31.empty else df_d_v31,
            df_emb_v31[df_emb_v31["archivo"] == p["archivo"]] if not df_emb_v31.empty else df_emb_v31,
        )]
        for linea in criterios_v5(df_ep_raton, pd.DataFrame(ep_gato), df_emb, df_d,
                                   pd.DataFrame(ep_raton_v31), pd.DataFrame(ep_gato_v31), df_emb_v31, df_d_v31):
            lineas.append(linea)

        lineas.append("")
        lineas.append("=== H) VALIDAR LA VISIÓN DEL GATO (mío) ===")
        miradas, primeras, transiciones = validar_vision_gato(piernas_ok, df_d)
        if not miradas.empty:
            lineas.append((miradas.groupby("clase").size() / len(miradas)).round(2).to_string())
        if not primeras.empty:
            lineas.append(f"Pickups rivales: vi al ratón en los 10 turnos previos en {primeras['vio_antes'].mean():.0%} (n={len(primeras)})")
            de_frente = primeras["de_frente_o_1"].dropna()
            if not de_frente.empty:
                lineas.append(f"  de esos, de frente o a distancia 1 la primera vez: {de_frente.mean():.0%} (n={len(de_frente)})")
        if not transiciones.empty:
            lineas.append("Tras perder de vista al ratón (10 turnos siguientes):")
            lineas.append(transiciones["resultado"].value_counts(normalize=True).round(2).to_string())

        lineas.append("")
        lineas.append("=== I) VALIDAR LA CARRERA DEL RATÓN (mío) ===")
        margenes = validar_carrera_raton(piernas_ok, df_d)
        if not margenes.empty:
            for res, g in margenes.groupby("resultado"):
                lineas.append(f"margen en pickups que terminaron en {res}: media={g['margen'].mean():.2f} mediana={g['margen'].median():.2f} (n={len(g)})")

    lineas.append("")
    lineas.append("=== TOP 3: dónde pierdo más puntos que el rival en la misma situación ===")
    for rol, situacion, diff, n, mio_prom, riv_prom, var_regla in top3(df_ep_raton, df_ep_gato):
        lineas.append(f"  [{rol}] {situacion}: mío={mio_prom:.2f} rival={riv_prom:.2f} (diff={diff:.2f}, n_mio={n}) -> candidata: {var_regla}")

    _emitir(lineas)
    return 0


def _emitir(lineas):
    recortadas = lineas[:MAX_LINEAS_REPORTE]
    if len(lineas) > MAX_LINEAS_REPORTE:
        recortadas.append(f"... ({len(lineas) - MAX_LINEAS_REPORTE} líneas más, recortado a {MAX_LINEAS_REPORTE})")
    texto = "\n".join(recortadas)
    print(texto)
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / "episodios.txt").write_text(texto, encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
