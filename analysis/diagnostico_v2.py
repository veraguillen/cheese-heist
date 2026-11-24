"""
diagnostico_v2.py — diagnóstico de dos patrones de fallo de v2 contra Timothy,
con los turn logs de data/v1/ y data/v2/.

Qué hace y qué no:
- Es SOLO análisis de datos (preguntas A1-A5 y B1-B5). No propone cambios al
  bot ni hipótesis de v3: eso lo decide Vera a partir de estas tablas.
- Reutiliza analysis/leer_logs.py para las líneas "D|" (lo que el propio bot
  registró). Para todo lo que el D| NO trae -eventos, posiciones reales del
  gato y el ratón, acciones ejecutadas, facing del gato rival- lee el turn
  log completo de Meowtel directamente (son JSONL: línea 1 = encabezado,
  resto = un turno por línea).
- Cuando un dato no se puede obtener del log, la tabla dice "no disponible"
  en vez de estimarlo. Las razones concretas están en la sección final del
  reporte ("datos que no se pudieron obtener").

Uso:
    python analysis/diagnostico_v2.py
"""

import json
import sys
from pathlib import Path

import pandas as pd

# En Windows, al redirigir la salida a un archivo, stdout puede quedar con el
# codepage del sistema en vez de UTF-8 y mutilar los acentos. Lo forzamos acá
# para no tener que evitar tildes en el resto del archivo.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from leer_logs import cargar  # reutilizamos la lectura de "D|"

BASE = Path(__file__).parent.parent / "data"


# --------------------------------------------------------------- utilidades

def _xy_entrada(entrada):
    """Las entrances de v1 son objetos {hole,x,y} (logEntrances viejo, antes
    de LOGS.md) y las de v2 son [x, y] (LOGS.md). OJO: tuple(dict) da las
    CLAVES del diccionario, no (x, y) -- por eso hace falta normalizar antes
    de comparar posiciones, en vez de usar tuple() directo sobre cada
    entrada como si ya fueran todas listas.
    """
    if entrada is None:
        return None
    if isinstance(entrada, dict):
        return entrada["x"], entrada["y"]
    return entrada[0], entrada[1]


def to_md(df: pd.DataFrame) -> str:
    """Tabla markdown sin depender de 'tabulate' (no está instalado acá)."""
    if df is None or df.empty:
        return "_(sin datos)_"
    cols = list(df.columns)
    header = "| " + " | ".join(str(c) for c in cols) + " |"
    sep = "|" + "|".join(["---"] * len(cols)) + "|"
    rows = []
    for _, r in df.iterrows():
        celdas = []
        for v in r:
            if pd.isna(v):
                celdas.append("")
            elif isinstance(v, float):
                celdas.append(f"{v:.2f}")
            else:
                celdas.append(str(v))
        rows.append("| " + " | ".join(celdas) + " |")
    return "\n".join([header, sep] + rows)


def leer_crudo(ruta: Path):
    """Header + lista de turnos completos (no solo D|) de un turn log."""
    lineas = ruta.read_text(encoding="utf-8", errors="replace").splitlines()
    header = json.loads(lineas[0])
    turnos = [json.loads(l) for l in lineas[1:]]
    por_turno = {t["turn"]: t for t in turnos}
    return header, turnos, por_turno


def listar_partidas():
    """[{version, match, cat: Path, mouse: Path}] para cada partida contra Timothy."""
    partidas = []
    for version_dir in sorted(BASE.glob("v*")):
        version = version_dir.name
        matches = sorted({p.stem.split("_")[1] for p in version_dir.glob("timothy_m*_*.jsonl")})
        for m in matches:
            p_cat = version_dir / f"timothy_{m}_cat.jsonl"
            p_mouse = version_dir / f"timothy_{m}_mouse.jsonl"
            if p_cat.exists() and p_mouse.exists():
                partidas.append({"version": version, "match": m, "cat": p_cat, "mouse": p_mouse})
    return partidas


# ------------------------------------------------------- carga de todo junto

CATALOGO = listar_partidas()

# Header + turnos crudos de cada pata (cat/mouse) de cada partida, una sola vez.
CRUDOS = {}  # (version, match, role) -> {header, turnos, por_turno, ruta}
for p in CATALOGO:
    for role, ruta in (("cat", p["cat"]), ("mouse", p["mouse"])):
        header, turnos, por_turno = leer_crudo(ruta)
        CRUDOS[(p["version"], p["match"], role)] = {
            "header": header, "turnos": turnos, "por_turno": por_turno, "ruta": ruta,
        }

# Líneas "D|" propias (leer_logs.py), para v1 y v2 juntas.
DF_D = cargar(str(BASE))
DF_D["es_encabezado"] = DF_D["entrances"].notna()
DF_HEADER = DF_D[DF_D["es_encabezado"]].copy()
DF_TURNOS = DF_D[~DF_D["es_encabezado"]].copy()

# Firma de casa: ancho x alto _ cantidad de agujeros, tomada del propio
# encabezado "D|" (no del houseType crudo), como pide la consigna.
CASA_POR_ARCHIVO = {
    (row.version, row.archivo): f"{int(row.width)}x{int(row.height)}_{int(row.holeCount)}h"
    for row in DF_HEADER.itertuples()
}
ENTRADAS_POR_ARCHIVO = {
    (row.version, row.archivo): row.entrances
    for row in DF_HEADER.itertuples()
}
DF_TURNOS["casa"] = [CASA_POR_ARCHIVO.get((v, a)) for v, a in zip(DF_TURNOS["version"], DF_TURNOS["archivo"])]

# houseType crudo, solo como etiqueta legible (no se usa para agrupar).
TIPO_CASA_POR_ARCHIVO = {}
for p in CATALOGO:
    for role, ruta in (("cat", p["cat"]), ("mouse", p["mouse"])):
        header = CRUDOS[(p["version"], p["match"], role)]["header"]
        CASA_SIG = CASA_POR_ARCHIVO.get((p["version"], ruta.name))
        TIPO_CASA_POR_ARCHIVO[CASA_SIG] = header.get("houseType")

# Índice rápido (version, archivo, turno) -> fila D| (dict), para ventanas de
# turnos anteriores sin tener que filtrar el DataFrame en cada llamada.
D_POR_ARCHIVO_TURNO = {}
for row in DF_TURNOS.itertuples():
    D_POR_ARCHIVO_TURNO[(row.version, row.archivo, int(row.t))] = row._asdict()


def d_en(version, match, role, turno):
    archivo = f"timothy_{match}_{role}.jsonl"
    return D_POR_ARCHIVO_TURNO.get((version, archivo, turno))


def eventos(version, match, role, tipo):
    turnos = CRUDOS[(version, match, role)]["turnos"]
    out = []
    for t in turnos:
        for ev in t.get("events") or []:
            if ev.get("type") == tipo:
                out.append({"turn": t["turn"], **{k: v for k, v in ev.items() if k != "type"}})
    return out


def n_partidas(version, casa=None):
    ms = {p["match"] for p in CATALOGO if p["version"] == version
          and (casa is None or CASA_POR_ARCHIVO.get((version, f"timothy_{p['match']}_mouse.jsonl")) == casa)}
    return len(ms)


# Límite real de v1: el D| por turno de v1 (claves largas) quedó truncado a
# ~300 caracteres por el motor y casi no se puede parsear como JSON (ver
# aviso "JSON inválido" de leer_logs.py más arriba). Lo confirmamos acá en
# vez de suponerlo.
TURNOS_V1_DISPONIBLES = int((DF_TURNOS["version"] == "v1").sum())
NOTA_V1 = (
    f"v1: el D| por turno no se pudo leer (0 filas recuperadas de ~{4 * 400} turnos "
    "posibles; el formato de claves largas de v1 se cortaba a mitad de JSON). "
    "Todo lo que dependa del D| por turno (modo, c, h, ih, cd, dv, vc, sc, mo, dist) "
    "queda 'no disponible' para v1; lo que sale de eventos del turn log crudo "
    "(capturas, entregas, pickups, posiciones) sí está disponible para las dos versiones."
)
if TURNOS_V1_DISPONIBLES == 0:
    print("\nAVISO:", NOTA_V1, "\n")


# --------------------------------------------------- capturas de mi ratón

def capturas_de_mi_raton(version, match):
    """Lista de capturas de MI ratón en esta partida, con contexto derivado
    de datos ya logueados (nunca estimado): si llevaba queso (carrying,
    ground truth del turno anterior), si fue en la casilla de entrada de
    algún agujero (comparando contra la lista de entrances del encabezado).
    """
    archivo = f"timothy_{match}_mouse.jsonl"
    por_turno = CRUDOS[(version, match, "mouse")]["por_turno"]
    casa = CASA_POR_ARCHIVO.get((version, archivo))
    entradas = ENTRADAS_POR_ARCHIVO.get((version, archivo)) or []
    entradas_set = {_xy_entrada(e) for e in entradas}

    out = []
    for ev in eventos(version, match, "mouse", "caught"):
        tc = ev["turn"]
        prev = por_turno.get(tc - 1)
        carrying = prev["mouse"]["carrying"] if prev else None
        out.append({
            "version": version, "match": match, "casa": casa, "turn": tc,
            "x": ev["x"], "y": ev["y"],
            "carrying": carrying,
            "en_entrada": (ev["x"], ev["y"]) in entradas_set,
            "respawnHole": ev.get("respawnHole"),
        })
    return out


CAPTURAS_RATON = pd.DataFrame(
    [fila for p in CATALOGO for fila in capturas_de_mi_raton(p["version"], p["match"])]
)


# ================================================================ PARTE A

def A1():
    """Tasa de captura por turno: capturas / turnos, separando c=1 (lleva
    queso) de c=0 fuera del agujero. v1 no tiene turnos de D| recuperables
    (ver NOTA_V1): se muestran sus capturas pero la tasa queda 'no disponible'.
    """
    filas = []
    for version in ("v1", "v2"):
        casas = sorted({CASA_POR_ARCHIVO[(version, f"timothy_{p['match']}_mouse.jsonl")]
                        for p in CATALOGO if p["version"] == version})
        turnos_m = DF_TURNOS[(DF_TURNOS.version == version) & (DF_TURNOS.rol == "m")]
        for casa in casas:
            sub = turnos_m[turnos_m.casa == casa]
            turnos_c1 = int((sub.carrying == 1).sum())
            turnos_c0_fuera = int(((sub.carrying == 0) & (sub.inHole.isna())).sum())
            cap = CAPTURAS_RATON[(CAPTURAS_RATON.version == version) & (CAPTURAS_RATON.casa == casa)]
            cap_con = int((cap.carrying == True).sum())  # noqa: E712
            cap_sin = int((cap.carrying == False).sum())  # noqa: E712
            filas.append({
                "version": version, "casa": casa, "n_partidas": n_partidas(version, casa),
                "turnos_c1": turnos_c1 or "no disponible",
                "capturas_con_queso": cap_con,
                "tasa_con_queso": round(cap_con / turnos_c1, 4) if turnos_c1 else "no disponible",
                "turnos_c0_fuera_agujero": turnos_c0_fuera or "no disponible",
                "capturas_sin_queso": cap_sin,
                "tasa_sin_queso": round(cap_sin / turnos_c0_fuera, 4) if turnos_c0_fuera else "no disponible",
            })
    return pd.DataFrame(filas)


def A2():
    """% de turnos con c=1 que tienen h=1 (pesado); y, de las capturas con
    queso, cuántas tuvieron h=1 en alguno de los 3 turnos anteriores.
    """
    filas = []
    for version in ("v1", "v2"):
        casas = sorted({CASA_POR_ARCHIVO[(version, f"timothy_{p['match']}_mouse.jsonl")]
                        for p in CATALOGO if p["version"] == version})
        turnos_m = DF_TURNOS[(DF_TURNOS.version == version) & (DF_TURNOS.rol == "m")]
        for casa in casas:
            sub = turnos_m[(turnos_m.casa == casa) & (turnos_m.carrying == 1)]
            n_c1 = len(sub)
            n_h1 = int((sub.heavy == 1).sum())
            pct_heavy = round(100 * n_h1 / n_c1, 1) if n_c1 else "no disponible"

            cap = CAPTURAS_RATON[(CAPTURAS_RATON.version == version) & (CAPTURAS_RATON.casa == casa)
                                  & (CAPTURAS_RATON.carrying == True)]  # noqa: E712
            con_heavy_antes = 0
            disponibles = 0
            for r in cap.itertuples():
                vistos = [d_en(version, r.match, "mouse", r.turn - k) for k in (3, 2, 1)]
                vistos = [d for d in vistos if d is not None]
                if not vistos:
                    continue
                disponibles += 1
                if any(d.get("heavy") == 1 for d in vistos):
                    con_heavy_antes += 1
            filas.append({
                "version": version, "casa": casa, "n_partidas": n_partidas(version, casa),
                "turnos_c1": n_c1 or "no disponible",
                "pct_turnos_c1_con_h1": pct_heavy,
                "capturas_con_queso": len(cap),
                "con_h1_en_3_turnos_antes": con_heavy_antes if disponibles else "no disponible",
                "n_con_ventana_disponible": disponibles,
            })
    return pd.DataFrame(filas)


def A3():
    """Dónde ocurre cada captura con queso: en la entrada, distancia BFS al
    agujero más cercano en ese momento (solo disponible si md=='VOLVER' en
    ese turno: ahí 'd' es, por construcción, la distancia al agujero más
    cercano; en otros modos 'd' mide otra cosa y se reporta 'no disponible'
    en vez de recalcularla con un BFS propio), modo en los 3 turnos previos,
    y cd/dv de la decisión que terminó en la captura.

    Alineación de turnos (verificada a mano con un caso real, ver A4): el
    turn log crudo registra en el turno T el RESULTADO de ejecutar la
    decisión D| de ESE MISMO turno T (que a su vez se tomó con la posición
    del turno T-1 como entrada). Si el evento "caught" aparece en T, la
    decisión que terminó atrapando al ratón es el D| de T (no el de T-1):
    por eso acá se usa r.turn, y T-1 sólo para la posición/carrying de
    entrada (que es donde estaba parado al decidir).
    """
    filas = []
    for version in ("v1", "v2"):
        cap = CAPTURAS_RATON[(CAPTURAS_RATON.version == version) & (CAPTURAS_RATON.carrying == True)]  # noqa: E712
        n = len(cap)
        if n == 0:
            continue
        en_entrada = int(cap.en_entrada.sum())

        distancias = []
        modos_antes = {"VOLVER": 0, "ALEJARSE": 0, "otro": 0}
        cds, dvs = [], []
        n_dist_disp = n_modo_disp = n_cd_disp = n_dv_disp = 0
        for r in cap.itertuples():
            d_fatal = d_en(version, r.match, "mouse", r.turn)
            # OJO: pandas convierte los "null" del JSON en NaN (float) cuando
            # la columna termina siendo numérica, no en None de Python. Hay
            # que usar pd.notna(), no "is not None", para detectar "no vino".
            if d_fatal is not None and d_fatal.get("modo") == "VOLVER" and pd.notna(d_fatal.get("dist")):
                distancias.append(d_fatal["dist"])
                n_dist_disp += 1

            vistos = [d_en(version, r.match, "mouse", r.turn - k) for k in (3, 2, 1)]
            vistos = [d for d in vistos if d is not None]
            if vistos:
                n_modo_disp += 1
                modos_vistos = {d.get("modo") for d in vistos}
                if "VOLVER" in modos_vistos:
                    modos_antes["VOLVER"] += 1
                if "ALEJARSE" in modos_vistos:
                    modos_antes["ALEJARSE"] += 1
                if modos_vistos - {"VOLVER", "ALEJARSE"}:
                    modos_antes["otro"] += 1

            if d_fatal is not None and "cd" in d_fatal and pd.notna(d_fatal.get("cd")):
                cds.append(d_fatal["cd"])
                n_cd_disp += 1
            if d_fatal is not None and "dv" in d_fatal and pd.notna(d_fatal.get("dv")):
                dvs.append(d_fatal["dv"])
                n_dv_disp += 1

        s_dist = pd.Series(distancias, dtype="float64")
        s_cd = pd.Series(cds, dtype="float64")
        filas.append({
            "version": version, "n_capturas_con_queso": n,
            "pct_en_entrada": round(100 * en_entrada / n, 1),
            "dist_bfs_al_agujero_media": round(s_dist.mean(), 2) if n_dist_disp else "no disponible",
            "dist_bfs_al_agujero_mediana": s_dist.median() if n_dist_disp else "no disponible",
            "n_dist_disponible": f"{n_dist_disp}/{n}",
            "pct_VOLVER_en_3_antes": round(100 * modos_antes["VOLVER"] / n_modo_disp, 1) if n_modo_disp else "no disponible",
            "pct_ALEJARSE_en_3_antes": round(100 * modos_antes["ALEJARSE"] / n_modo_disp, 1) if n_modo_disp else "no disponible",
            "pct_otro_modo_en_3_antes": round(100 * modos_antes["otro"] / n_modo_disp, 1) if n_modo_disp else "no disponible",
            "n_modo_disponible": f"{n_modo_disp}/{n}",
            "cd_de_la_decision_fatal_media": round(s_cd.mean(), 2) if n_cd_disp else "no disponible",
            "cd_de_la_decision_fatal_mediana": s_cd.median() if n_cd_disp else "no disponible",
            "n_cd_disponible": f"{n_cd_disp}/{n}",
            "pct_dv1_de_la_decision_fatal": round(100 * sum(dvs) / n_dv_disp, 1) if n_dv_disp else "no disponible",
            "n_dv_disponible": f"{n_dv_disp}/{n}",
        })
    return pd.DataFrame(filas)


def A4():
    """Desde el pickup hasta la captura: turnos transcurridos y distancia al
    agujero más cercano en el momento de levantar el queso.

    Ojo con el desfasaje de turnos: en el turn log crudo, el registro del
    turno T ya es el resultado DESPUÉS de mover (ground truth), pero el D|
    de ese mismo turno T es la decisión tomada ANTES de mover. El evento
    "pickup" que aparece en events del turno T describe el resultado de la
    jugada DECIDIDA en T (ground truth de T: carrying ya en true, sobre la
    casilla del queso). Por eso, para leer "carrying=true + modo VOLVER
    recién levantado", hay que mirar el D| del turno T+1 (ya con esa
    posición como punto de partida), no el de T (que todavía dice
    IR_AL_QUESO/dist=1, la decisión que CAUSÓ el pickup). Se verificó a mano
    con un caso real antes de escribir esto.
    """
    filas = []
    for version in ("v1", "v2"):
        cap = CAPTURAS_RATON[(CAPTURAS_RATON.version == version) & (CAPTURAS_RATON.carrying == True)]  # noqa: E712
        n = len(cap)
        if n == 0:
            continue
        turnos_transcurridos = []
        distancias_al_levantar = []
        n_dist_disp = 0
        sin_pickup_previo = 0
        for r in cap.itertuples():
            pickups = [e["turn"] for e in eventos(version, r.match, "mouse", "pickup") if e["turn"] <= r.turn]
            if not pickups:
                sin_pickup_previo += 1
                continue
            t_pickup = max(pickups)
            turnos_transcurridos.append(r.turn - t_pickup)
            d_pickup = d_en(version, r.match, "mouse", t_pickup + 1)
            if d_pickup is not None and d_pickup.get("modo") == "VOLVER" and pd.notna(d_pickup.get("dist")):
                distancias_al_levantar.append(d_pickup["dist"])
                n_dist_disp += 1
        s_t = pd.Series(turnos_transcurridos, dtype="float64")
        s_d = pd.Series(distancias_al_levantar, dtype="float64")
        filas.append({
            "version": version, "n_capturas_con_queso": n,
            "sin_pickup_previo_en_el_log": sin_pickup_previo,
            "turnos_media": round(s_t.mean(), 2) if len(s_t) else "no disponible",
            "turnos_mediana": s_t.median() if len(s_t) else "no disponible",
            "turnos_min_max": f"{int(s_t.min())}-{int(s_t.max())}" if len(s_t) else "no disponible",
            "dist_al_levantar_media": round(s_d.mean(), 2) if n_dist_disp else "no disponible",
            "dist_al_levantar_mediana": s_d.median() if n_dist_disp else "no disponible",
            "n_dist_disponible": f"{n_dist_disp}/{n - sin_pickup_previo}",
        })
    return pd.DataFrame(filas)


def _clasificar_direccion(cat_x, cat_y, cat_facing, mouse_x, mouse_y):
    """Clasificación geométrica determinística a partir de datos logueados
    (facing y posiciones), no una estimación de intención: compara hacia
    dónde mira el gato contra el vector gato->ratón.
    """
    dx, dy = mouse_x - cat_x, mouse_y - cat_y
    vec = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}.get(cat_facing)
    if vec is None:
        return "no disponible"
    dot = vec[0] * dx + vec[1] * dy
    if dx == 0 and dy == 0:
        return "misma_casilla"
    if dot > 0:
        return "de_frente"
    if dot < 0:
        return "de_espaldas"
    return "lateral"


def A5():
    """Posición/facing del gato de Timothy justo antes de la decisión que
    terminó en cada captura con queso (ground truth del turno T-1: es la
    posición desde la que el ratón decidió el movimiento que lo atrapó en
    T), y el objetivo que el ratón tenía en esa decisión fatal (D| de T, ver
    nota de alineación en A3): ¿estaba el gato en la casilla de entrada de
    algún agujero?, ¿y en la del agujero objetivo (si se conoce)?, y
    clasificación geométrica de_frente/de_espaldas/lateral a partir de
    facing vs. posición del ratón (cálculo determinístico sobre datos
    logueados, no una inferencia de intención).
    """
    filas_detalle = []
    for version in ("v1", "v2"):
        cap = CAPTURAS_RATON[(CAPTURAS_RATON.version == version) & (CAPTURAS_RATON.carrying == True)]  # noqa: E712
        for r in cap.itertuples():
            archivo = f"timothy_{r.match}_mouse.jsonl"
            entradas = {_xy_entrada(e) for e in (ENTRADAS_POR_ARCHIVO.get((version, archivo)) or [])}
            por_turno = CRUDOS[(version, r.match, "mouse")]["por_turno"]
            prev = por_turno.get(r.turn - 1)
            if prev is None:
                continue
            cat_gt, mouse_gt = prev.get("cat"), prev.get("mouse")
            d_fatal = d_en(version, r.match, "mouse", r.turn)
            objetivo = d_fatal.get("target") if d_fatal is not None else None
            entrada_objetivo = None
            if objetivo:
                hx, hy = map(int, objetivo.split(","))
                entrada_objetivo = (hx, hy) in entradas  # "target" en VOLVER es la casilla del agujero/hueco; se compara contra entrances igual
            filas_detalle.append({
                "version": version, "match": r.match, "turn": r.turn,
                "cat_pos": (cat_gt["x"], cat_gt["y"]) if cat_gt else None,
                "cat_facing": cat_gt["facing"] if cat_gt else None,
                "mouse_pos": (mouse_gt["x"], mouse_gt["y"]) if mouse_gt else None,
                "cat_en_alguna_entrada": (cat_gt["x"], cat_gt["y"]) in entradas if cat_gt else None,
                "cat_en_entrada_objetivo": entrada_objetivo,
                "direccion": _clasificar_direccion(cat_gt["x"], cat_gt["y"], cat_gt["facing"], mouse_gt["x"], mouse_gt["y"]) if cat_gt and mouse_gt else "no disponible",
            })
    detalle = pd.DataFrame(filas_detalle)
    if detalle.empty:
        return detalle, pd.DataFrame()

    def pct_objetivo(s):
        disp = s.dropna()
        return f"{round(100 * disp.mean(), 1)} (n={len(disp)})" if len(disp) else "no disponible"

    resumen = (
        detalle.groupby("version")
        .agg(
            n=("turn", "count"),
            pct_cat_en_alguna_entrada=("cat_en_alguna_entrada", lambda s: round(100 * s.mean(), 1)),
        )
    )
    resumen["pct_cat_en_entrada_objetivo"] = detalle.groupby("version")["cat_en_entrada_objetivo"].apply(pct_objetivo)
    direccion_tabla = detalle.groupby(["version", "direccion"]).size().unstack(fill_value=0)
    direccion_tabla.columns = [f"dir_{c}" for c in direccion_tabla.columns]
    resumen = resumen.join(direccion_tabla)
    return detalle, resumen.reset_index()


# ================================================================ PARTE B

def B1():
    """Turnos por modo (md) de MI gato, y dentro de VIGILAR_QUESO cuántos
    tienen d=0 (parado sobre el queso).
    """
    filas = []
    for version in ("v1", "v2"):
        casas = sorted({CASA_POR_ARCHIVO[(version, f"timothy_{p['match']}_cat.jsonl")]
                        for p in CATALOGO if p["version"] == version})
        turnos_c = DF_TURNOS[(DF_TURNOS.version == version) & (DF_TURNOS.rol == "c")]
        for casa in casas:
            sub = turnos_c[turnos_c.casa == casa]
            if sub.empty:
                filas.append({"version": version, "casa": casa, "n_partidas": n_partidas(version, casa),
                               "turnos": "no disponible"})
                continue
            fila = {"version": version, "casa": casa, "n_partidas": n_partidas(version, casa), "turnos": len(sub)}
            for modo, cnt in sub["modo"].value_counts().items():
                fila[f"modo_{modo}"] = int(cnt)
            vq = sub[sub.modo == "VIGILAR_QUESO"]
            fila["VIGILAR_QUESO_con_d0"] = int((vq.dist == 0).sum()) if not vq.empty else 0
            filas.append(fila)
    return pd.DataFrame(filas)


def B2():
    """vc (casillas visibles) promedio/mediana cuando MI gato hace STAY vs.
    cuando se mueve. El D| no trae el movimiento ejecutado (solo modo y
    distancia al objetivo); el movimiento real sale de actions.cat.move en
    el turn log crudo del mismo turno.
    """
    filas = []
    for version in ("v1", "v2"):
        for p in [p for p in CATALOGO if p["version"] == version]:
            turnos = CRUDOS[(version, p["match"], "cat")]["turnos"]
            archivo = f"timothy_{p['match']}_cat.jsonl"
            for t in turnos:
                d = d_en(version, p["match"], "cat", t["turn"])
                if d is None or pd.isna(d.get("visibleCount")):
                    continue
                accion = (t.get("actions") or {}).get("cat") or {}
                move = accion.get("move")
                if move is None:
                    continue
                filas.append({
                    "version": version, "casa": CASA_POR_ARCHIVO.get((version, archivo)),
                    "vc": d["visibleCount"], "stay": move == "STAY",
                })
    df = pd.DataFrame(filas)
    if df.empty:
        return df
    out = (
        df.groupby(["version", "stay"])["vc"]
        .agg(n="count", media="mean", mediana="median")
        .reset_index()
    )
    out["stay"] = out["stay"].map({True: "STAY", False: "se mueve"})
    return out


def _dist_euclidiana(x1, y1, x2, y2):
    return round(((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5, 2)


def _episodios_avistamiento(version, match):
    """Tramos de turnos consecutivos con mo != null (MI gato viendo al
    ratón de Timothy), con la distancia en línea recta al principio del
    tramo (en línea recta entre las coordenadas logueadas, no BFS: el D|
    no trae el camino) y si el tramo terminó con una captura.
    """
    turnos = sorted(CRUDOS[(version, match, "cat")]["turnos"], key=lambda t: t["turn"])
    capturas_turnos = {e["turn"] for e in eventos(version, match, "cat", "caught")}
    episodios = []
    actual = None
    for t in turnos:
        d = d_en(version, match, "cat", t["turn"])
        mo = d.get("mouse") if d is not None else None
        visto = isinstance(mo, list) and len(mo) >= 2
        if visto:
            dist = _dist_euclidiana(d["x"], d["y"], mo[0], mo[1])
            if actual is None:
                actual = {"version": version, "match": match, "inicio": t["turn"], "fin": t["turn"], "dist_inicio": dist}
            else:
                actual["fin"] = t["turn"]
        elif actual is not None:
            episodios.append(actual)
            actual = None
    if actual is not None:
        episodios.append(actual)
    for ep in episodios:
        ep["duracion_turnos"] = ep["fin"] - ep["inicio"] + 1
        ep["termino_en_captura"] = ep["fin"] in capturas_turnos
    return episodios


def B3():
    """Turnos con mo != null (vio al ratón) y sc > 0 (olió algo). Por cada
    vez que vio al ratón (tramo de turnos consecutivos con mo != null):
    distancia en línea recta al empezar a verlo, cuántos turnos lo mantuvo a
    la vista, y cómo terminó (en captura o sin atraparlo).
    """
    conteos = []
    episodios_todos = []
    for version in ("v1", "v2"):
        casas = sorted({CASA_POR_ARCHIVO[(version, f"timothy_{p['match']}_cat.jsonl")]
                        for p in CATALOGO if p["version"] == version})
        turnos_c = DF_TURNOS[(DF_TURNOS.version == version) & (DF_TURNOS.rol == "c")]
        for casa in casas:
            sub = turnos_c[turnos_c.casa == casa]
            if sub.empty:
                conteos.append({"version": version, "casa": casa, "n_partidas": n_partidas(version, casa),
                                 "turnos": "no disponible", "turnos_con_mo": "no disponible", "turnos_con_sc_mayor_0": "no disponible"})
                continue
            conteos.append({
                "version": version, "casa": casa, "n_partidas": n_partidas(version, casa),
                "turnos": len(sub),
                "turnos_con_mo": int(sub["mouse"].apply(lambda v: isinstance(v, list)).sum()),
                "turnos_con_sc_mayor_0": int((sub["scentCount"] > 0).sum()),
            })
        for p in [p for p in CATALOGO if p["version"] == version]:
            episodios_todos.extend(_episodios_avistamiento(version, p["match"]))

    tabla_conteos = pd.DataFrame(conteos)
    ep_df = pd.DataFrame(episodios_todos)
    if ep_df.empty:
        tabla_episodios = pd.DataFrame()
    else:
        tabla_episodios = (
            ep_df.groupby("version")
            .agg(
                n_episodios=("inicio", "count"),
                dist_inicio_media=("dist_inicio", "mean"),
                dist_inicio_mediana=("dist_inicio", "median"),
                duracion_media_turnos=("duracion_turnos", "mean"),
                duracion_mediana_turnos=("duracion_turnos", "median"),
                pct_termino_en_captura=("termino_en_captura", lambda s: round(100 * s.mean(), 1)),
            )
            .round(2)
            .reset_index()
        )
    return tabla_conteos, tabla_episodios


def B4():
    """Cada entrega del ratón de Timothy: en qué agujero, distancia en línea
    recta de MI gato a esa entrada en ese momento (NO es BFS: ver nota de
    'datos no disponibles' al final, el gato nunca calcula distancia a
    agujeros en su propia decisión), y si lo veía (mo != null) o lo olía
    (sc > 0) en los 10 turnos anteriores.
    """
    filas = []
    for p in CATALOGO:
        version, match = p["version"], p["match"]
        archivo = f"timothy_{match}_cat.jsonl"
        entradas = ENTRADAS_POR_ARCHIVO.get((version, archivo)) or []
        por_turno = CRUDOS[(version, match, "cat")]["por_turno"]
        for ev in eventos(version, match, "cat", "delivered"):
            td = ev["turn"]
            hole_idx = ev.get("hole")
            entrada = _xy_entrada(entradas[hole_idx]) if hole_idx is not None and hole_idx < len(entradas) else None
            gt = por_turno.get(td)
            cat_gt = gt.get("cat") if gt else None
            dist = _dist_euclidiana(cat_gt["x"], cat_gt["y"], entrada[0], entrada[1]) if (cat_gt and entrada) else None

            vio_antes = olio_antes = False
            n_ventana_disp = 0
            for k in range(1, 11):
                d = d_en(version, match, "cat", td - k)
                if d is None:
                    continue
                n_ventana_disp += 1
                if isinstance(d.get("mouse"), list):
                    vio_antes = True
                if pd.notna(d.get("scentCount")) and d.get("scentCount") > 0:
                    olio_antes = True

            filas.append({
                "version": version, "match": match, "turn": td, "hole": hole_idx,
                "dist_recta_a_la_entrada": dist if dist is not None else "no disponible",
                "vio_en_10_turnos_antes": vio_antes, "olio_en_10_turnos_antes": olio_antes,
                "n_turnos_ventana_disponibles": f"{n_ventana_disp}/10",
            })
    detalle = pd.DataFrame(filas)
    if detalle.empty:
        return detalle, pd.DataFrame()
    resumen = (
        detalle.groupby("version")
        .agg(
            n_entregas=("turn", "count"),
            dist_recta_media=("dist_recta_a_la_entrada", lambda s: round(pd.to_numeric(s, errors="coerce").mean(), 2)),
            pct_vio_en_10_antes=("vio_en_10_turnos_antes", lambda s: round(100 * s.mean(), 1)),
            pct_olio_en_10_antes=("olio_en_10_turnos_antes", lambda s: round(100 * s.mean(), 1)),
        )
        .reset_index()
    )
    return detalle, resumen


def B5():
    """Confirmado leyendo bot.js: ¿el gato usa sprint o look alguna vez?"""
    bot = (Path(__file__).parent.parent / "bot.js").read_text(encoding="utf-8")
    linea_accion = [l for l in bot.splitlines() if "const action = {" in l][0]
    usa_sprint_o_look_en_codigo = ("sprint:" in bot.split("function createBot")[-1]) or ("look:" in bot.split("function createBot")[-1])
    # cruce con los logs: ¿aparecio alguna vez sprint/look en las acciones
    # que devolvio MI gato, segun el turn log crudo?
    sprint_en_logs = look_en_logs = False
    for p in CATALOGO:
        turnos = CRUDOS[(p["version"], p["match"], "cat")]["turnos"]
        for t in turnos:
            accion = (t.get("actions") or {}).get("cat") or {}
            if "sprint" in accion and accion.get("sprint"):
                sprint_en_logs = True
            if "look" in accion:
                look_en_logs = True
    return {
        "linea_que_arma_la_accion": linea_accion.strip(),
        "sprint_o_look_presentes_en_el_codigo_de_decideCat_o_en_action": usa_sprint_o_look_en_codigo,
        "sprint_visto_en_turn_logs": sprint_en_logs,
        "look_visto_en_turn_logs": look_en_logs,
    }


print(to_md(A1()))
print()
print(to_md(A2()))
print()
print(to_md(A3()))
print()
print(to_md(A4()))
print()
_detalle_a5, _resumen_a5 = A5()
print(to_md(_resumen_a5))
print()
_conteos_b3, _episodios_b3 = B3()
print(to_md(B1()))
print()
print(to_md(B2()))
print()
print(to_md(_conteos_b3))
print()
print(to_md(_episodios_b3))
print()
_detalle_b4, _resumen_b4 = B4()
print(to_md(_resumen_b4))
print()
print("B5:", B5())
