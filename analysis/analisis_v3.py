"""
analisis_v3.py — v2 frente a v3, con los turn logs de data/v2/ y data/v3/.

Qué hace y qué no:
- Es SOLO análisis de datos (partes 1-4 pedidas). Sin recomendaciones.
- Reutiliza analysis/leer_logs.py para las líneas "D|" (lo que el propio bot
  registró). Para todo lo que el D| NO trae -eventos, posiciones reales,
  errores, resultado final de la casa- lee el turn log crudo de Meowtel
  directamente (JSONL: línea 1 = encabezado, resto = un turno por línea).
- Cuando un dato no se puede obtener del log, las tablas dicen "no
  disponible" en vez de estimarlo. Las razones están en la sección final.

Uso:
    python analysis/analisis_v3.py
"""

import json
import sys
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from leer_logs import cargar  # reutilizamos la lectura de "D|"

BASE = Path(__file__).parent.parent / "data"


# --------------------------------------------------------------- utilidades

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


VERSIONES = ["v2", "v3"]  # la consigna pide solo v2 frente a v3


def listar_partidas():
    """[{version, match, rival, cat: Path, mouse: Path}] para cada partida.

    OJO (hallazgo de la Parte 1): en data/v3/ los DOS archivos de cada
    partida tienen el rol cambiado de nombre -- "timothy_m1_cat.jsonl" es
    en realidad la pata del RATÓN (header.you == "mouse"), y viceversa, en
    las 8 patas de v3 (en v2 los 6 archivos están bien). Por eso el rol de
    cada archivo se decide leyendo su propio encabezado ("you"), nunca por
    el nombre del archivo.
    """
    partidas = []
    for version_dir in sorted(BASE / v for v in VERSIONES):
        version = version_dir.name
        claves = {}
        for p in version_dir.glob("*_m*_*.jsonl"):
            partes = p.stem.split("_")
            if len(partes) < 3:
                continue
            rival, match = partes[0], partes[1]
            with open(p, encoding="utf-8") as f:
                you = json.loads(f.readline()).get("you")
            claves.setdefault((rival, match), {})[you] = p
        for (rival, match), paths in sorted(claves.items()):
            if "cat" in paths and "mouse" in paths:
                partidas.append({"version": version, "match": match, "rival": rival,
                                  "cat": paths["cat"], "mouse": paths["mouse"]})
    return partidas


CATALOGO = listar_partidas()

# Header + turnos crudos de cada pata (cat/mouse) de cada partida, una vez.
# ARCHIVO_DE[(version, match, role)] = nombre real del archivo para esa pata
# (puede NO coincidir con "<rival>_<match>_<role>.jsonl" por el swap de v3).
CRUDOS = {}  # (version, match, role) -> {header, turnos, por_turno, ruta}
ARCHIVO_DE = {}
for p in CATALOGO:
    for role, ruta in (("cat", p["cat"]), ("mouse", p["mouse"])):
        header, turnos, por_turno = leer_crudo(ruta)
        CRUDOS[(p["version"], p["match"], role)] = {
            "header": header, "turnos": turnos, "por_turno": por_turno, "ruta": ruta,
        }
        ARCHIVO_DE[(p["version"], p["match"], role)] = ruta.name

# Líneas "D|" propias (leer_logs.py), para v2 y v3 juntas (no v1: no la pide la consigna).
DF_D = pd.concat([cargar(str(BASE / v)) for v in VERSIONES], ignore_index=True)
DF_D["es_encabezado"] = DF_D["entrances"].notna()
DF_HEADER = DF_D[DF_D["es_encabezado"]].copy()
DF_TURNOS = DF_D[~DF_D["es_encabezado"]].copy()

# Firma de casa: ancho x alto _ cantidad de agujeros, tomada del propio
# encabezado "D|" (no del houseType crudo), como en el diagnóstico de v2.
CASA_POR_ARCHIVO = {
    (row.version, row.archivo): f"{int(row.width)}x{int(row.height)}_{int(row.holeCount)}h"
    for row in DF_HEADER.itertuples()
}
ENTRADAS_POR_ARCHIVO = {
    (row.version, row.archivo): row.entrances
    for row in DF_HEADER.itertuples()
}
DF_TURNOS["casa"] = [CASA_POR_ARCHIVO.get((v, a)) for v, a in zip(DF_TURNOS["version"], DF_TURNOS["archivo"])]

# Índice rápido (version, archivo, turno) -> fila D| (dict).
D_POR_ARCHIVO_TURNO = {}
for row in DF_TURNOS.itertuples():
    D_POR_ARCHIVO_TURNO[(row.version, row.archivo, int(row.t))] = row._asdict()


def d_en(version, match, role, turno):
    archivo = ARCHIVO_DE[(version, match, role)]
    return D_POR_ARCHIVO_TURNO.get((version, archivo, turno))


def _xy_entrada(entrada):
    """v1 guardaba las entrances como objetos {hole,x,y}; v2/v3 como [x, y]."""
    if entrada is None:
        return None
    if isinstance(entrada, dict):
        return entrada["x"], entrada["y"]
    return entrada[0], entrada[1]


def eventos(version, match, role, tipo):
    turnos = CRUDOS[(version, match, role)]["turnos"]
    out = []
    for t in turnos:
        for ev in t.get("events") or []:
            if ev.get("type") == tipo:
                out.append({"turn": t["turn"], **{k: v for k, v in ev.items() if k != "type"}})
    return out


def todos_eventos(version, match, role):
    turnos = CRUDOS[(version, match, role)]["turnos"]
    out = []
    for t in turnos:
        for ev in t.get("events") or []:
            out.append({"turn": t["turn"], **ev})
    return out


# self-test mínimo: confirmamos que el catálogo y el D| calzan antes de
# construir nada encima.
assert len(CATALOGO) > 0, "no encontré ninguna partida en data/"
for p in CATALOGO:
    assert (p["version"], p["match"], "cat") in CRUDOS
    assert (p["version"], p["match"], "mouse") in CRUDOS
print(f"SELFTEST OK: {len(CATALOGO)} partidas encontradas -> " +
      ", ".join(f"{p['version']}/{p['rival']}_{p['match']}" for p in CATALOGO))
print(f"Filas D|: {len(DF_D)} (encabezados {len(DF_HEADER)}, turnos {len(DF_TURNOS)})")


# =====================================================================
# PARTE 1 — ¿Hay un bug? (solo v3)
# =====================================================================

def P1_errores():
    """Errores/excepciones/timeouts de MI bot en cualquier pata de v3."""
    filas = []
    for p in CATALOGO:
        if p["version"] != "v3":
            continue
        for role, archivo_key in (("cat", "cat"), ("mouse", "mouse")):
            header = CRUDOS[(p["version"], p["match"], role)]["header"]
            mis_errores = header["result"]["errors"][role]
            filas.append({
                "match": p["match"], "pata": role, "mis_errores": mis_errores,
                "errores_rival": header["result"]["errors"]["mouse" if role == "cat" else "cat"],
            })
    return pd.DataFrame(filas)


def P1_emboscada():
    """Turnos en EMBOSCADA, parado (d=0) vs caminando (d>0) vs sin objetivo
    (d null); cambios de tg por partida; rachas de >=20 turnos sin moverse
    (misma x,y que el turno anterior) estando fuera de una entrada.
    """
    filas_resumen = []
    filas_rachas = []
    for p in CATALOGO:
        if p["version"] != "v3":
            continue
        archivo = ARCHIVO_DE[("v3", p["match"], "cat")]
        sub = DF_TURNOS[(DF_TURNOS.version == "v3") & (DF_TURNOS.rol == "c")
                         & (DF_TURNOS.archivo == archivo)].sort_values("t")
        emb = sub[sub.modo == "EMBOSCADA"]
        parado = int((emb.dist == 0).sum())
        caminando = int((emb.dist > 0).sum())
        sin_objetivo = int(emb.dist.isna().sum())

        cambios_tg = 0
        tg_prev = None
        for tg in emb.target:
            if tg_prev is not None and tg != tg_prev and pd.notna(tg) and pd.notna(tg_prev):
                cambios_tg += 1
            tg_prev = tg

        filas_resumen.append({
            "match": p["match"], "turnos_EMBOSCADA": len(emb),
            "parado_d0": parado, "caminando_d>0": caminando, "sin_objetivo_d_null": sin_objetivo,
            "cambios_de_tg": cambios_tg,
        })

        # rachas de >=20 turnos sin moverse (misma x,y que el turno anterior)
        # y fuera de una entrada, sobre TODOS los turnos del gato (no solo
        # EMBOSCADA: un atasco podría pasar en cualquier modo).
        entradas = {_xy_entrada(e) for e in (ENTRADAS_POR_ARCHIVO.get(("v3", archivo)) or [])}
        racha = 0
        x_prev = y_prev = None
        for row in sub.itertuples():
            mismo_lugar = x_prev is not None and row.x == x_prev and row.y == y_prev
            if mismo_lugar:
                racha += 1
            else:
                racha = 1
            en_entrada = (row.x, row.y) in entradas
            if racha >= 20 and not en_entrada:
                filas_rachas.append({"match": p["match"], "turn": int(row.t), "x": int(row.x), "y": int(row.y), "racha_turnos": racha, "modo": row.modo})
            x_prev, y_prev = row.x, row.y
    return pd.DataFrame(filas_resumen), pd.DataFrame(filas_rachas)


def P1_raton():
    """Entregas por partida; rachas de >=20 turnos en {IR_AL_QUESO, VOLVER}
    sin un 'delivered' en esa ventana; distribución de mg cuando no es null.
    """
    filas_entregas = []
    filas_rachas = []
    mg_valores = []
    for p in CATALOGO:
        if p["version"] != "v3":
            continue
        entregas = eventos("v3", p["match"], "mouse", "delivered")
        filas_entregas.append({"match": p["match"], "entregas": len(entregas)})
        turnos_entrega = {e["turn"] for e in entregas}

        archivo_m = ARCHIVO_DE[("v3", p["match"], "mouse")]
        sub = DF_TURNOS[(DF_TURNOS.version == "v3") & (DF_TURNOS.rol == "m")
                         & (DF_TURNOS.archivo == archivo_m)].sort_values("t")
        mg_valores.extend(sub["mg"].dropna().tolist())

        racha_inicio = None
        for row in sub.itertuples():
            t = int(row.t)
            en_ciclo = row.modo in ("IR_AL_QUESO", "VOLVER")
            if en_ciclo:
                if racha_inicio is None:
                    racha_inicio = t
            else:
                if racha_inicio is not None:
                    largo = t - racha_inicio  # turnos del 1 al anterior a este
                    if largo >= 20 and not ({*range(racha_inicio, t)} & turnos_entrega):
                        filas_rachas.append({"match": p["match"], "turno_inicio": racha_inicio, "turno_fin": t - 1, "largo": largo})
                racha_inicio = None
        if racha_inicio is not None:
            largo = int(sub["t"].max()) - racha_inicio + 1
            if largo >= 20 and not ({*range(racha_inicio, int(sub["t"].max()) + 1)} & turnos_entrega):
                filas_rachas.append({"match": p["match"], "turno_inicio": racha_inicio, "turno_fin": int(sub["t"].max()), "largo": largo})

    s_mg = pd.Series(mg_valores, dtype="float64")
    resumen_mg = pd.DataFrame([{
        "n": len(s_mg),
        "media": round(s_mg.mean(), 2) if len(s_mg) else "no disponible",
        "mediana": s_mg.median() if len(s_mg) else "no disponible",
        "min": s_mg.min() if len(s_mg) else "no disponible",
        "max": s_mg.max() if len(s_mg) else "no disponible",
    }])
    return pd.DataFrame(filas_entregas), pd.DataFrame(filas_rachas), resumen_mg


print("\n===== PARTE 1: errores =====")
print(to_md(P1_errores()))
_p1_emb_resumen, _p1_emb_rachas = P1_emboscada()
print("\n===== PARTE 1: EMBOSCADA =====")
print(to_md(_p1_emb_resumen))
print("\nRachas >=20 turnos sin moverse fuera de una entrada (gato):")
print(to_md(_p1_emb_rachas))
_p1_entregas, _p1_rachas_raton, _p1_mg = P1_raton()
print("\n===== PARTE 1: ratón =====")
print(to_md(_p1_entregas))
print("\nRachas >=20 turnos en IR_AL_QUESO/VOLVER sin entregar:")
print(to_md(_p1_rachas_raton))
print("\nDistribución de mg (no null):")
print(to_md(_p1_mg))


# =====================================================================
# PARTE 2 — Por pierna, v2 frente a v3
# =====================================================================

def capturas_con_contexto(version, match):
    """Capturas de MI ratón en esta partida, con si llevaba queso (ground
    truth del turno anterior a la captura, no estimado).
    """
    por_turno = CRUDOS[(version, match, "mouse")]["por_turno"]
    out = []
    for ev in eventos(version, match, "mouse", "caught"):
        prev = por_turno.get(ev["turn"] - 1)
        carrying = prev["mouse"]["carrying"] if prev else None
        out.append({"turn": ev["turn"], "carrying": carrying})
    return out


def P2_por_partida():
    filas = []
    for p in CATALOGO:
        version, match, rival = p["version"], p["match"], p["rival"]
        archivo_cat = ARCHIVO_DE[(version, match, "cat")]
        archivo_mouse = ARCHIVO_DE[(version, match, "mouse")]
        casa = CASA_POR_ARCHIVO.get((version, archivo_cat))

        header_cat = CRUDOS[(version, match, "cat")]["header"]
        header_mouse = CRUDOS[(version, match, "mouse")]["header"]
        score_cat_leg = header_cat["result"]["score"]  # {cat: mio, mouse: rival} en esta pata
        score_mouse_leg = header_mouse["result"]["score"]  # {cat: rival, mouse: mio}

        marcador_mio = score_cat_leg["cat"] + score_mouse_leg["mouse"]
        marcador_rival = score_cat_leg["mouse"] + score_mouse_leg["cat"]

        cap_raton = capturas_con_contexto(version, match)
        cap_raton_con_queso = sum(1 for c in cap_raton if c["carrying"])
        entregas_raton = len(eventos(version, match, "mouse", "delivered"))
        impuesto_raton = len(eventos(version, match, "mouse", "hidingTax"))

        cap_gato = len(eventos(version, match, "cat", "caught"))
        impuesto_cobrado = len(eventos(version, match, "cat", "hidingTax"))
        entregas_rival = len(eventos(version, match, "cat", "delivered"))

        neto_pierna_raton = score_mouse_leg["mouse"] - score_mouse_leg["cat"]
        neto_pierna_gato = score_cat_leg["cat"] - score_cat_leg["mouse"]

        filas.append({
            "version": version, "rival": rival, "casa": casa, "match": match,
            "marcador_mio": marcador_mio, "marcador_rival": marcador_rival,
            "raton_capturas": len(cap_raton), "raton_capturas_con_queso": cap_raton_con_queso,
            "raton_entregas": entregas_raton, "raton_impuesto": impuesto_raton,
            "gato_capturas": cap_gato, "gato_impuesto_cobrado": impuesto_cobrado, "gato_entregas_rival": entregas_rival,
            "neto_pierna_raton": neto_pierna_raton, "neto_pierna_gato": neto_pierna_gato,
        })
    return pd.DataFrame(filas)


def P2_promedios(df_partidas):
    if df_partidas.empty:
        return df_partidas
    cols_num = ["marcador_mio", "marcador_rival", "raton_capturas", "raton_capturas_con_queso",
                "raton_entregas", "raton_impuesto", "gato_capturas", "gato_impuesto_cobrado",
                "gato_entregas_rival", "neto_pierna_raton", "neto_pierna_gato"]
    df_partidas = df_partidas.copy()
    df_partidas["contra_timothy"] = df_partidas["rival"].eq("timothy")
    out = df_partidas.groupby(["version", "contra_timothy"]).agg(
        n_partidas=("match", "count"), **{c: (c, "mean") for c in cols_num}
    ).round(2).reset_index()
    return out


_p2_partidas = P2_por_partida()
print("\n===== PARTE 2: por partida =====")
print(to_md(_p2_partidas.sort_values(["version", "rival", "match"])))
print("\n===== PARTE 2: promedios por versión y rival =====")
print(to_md(P2_promedios(_p2_partidas)))


# =====================================================================
# PARTE 3 — Patrones de v3 (máximo 3, ordenados por puntos cedidos)
# =====================================================================

def P3_patrones():
    v3 = _p2_partidas[_p2_partidas.version == "v3"]
    pts_capturas = int((v3.raton_capturas * 3).sum())
    pts_entregas_rival = int((v3.gato_entregas_rival * 3).sum())
    pts_impuesto_raton = int(v3.raton_impuesto.sum())
    total_rival = pts_capturas + pts_entregas_rival + pts_impuesto_raton

    pts_mios_entregas = int((v3.raton_entregas * 3).sum())
    pts_mios_capturas = int((v3.gato_capturas * 3).sum())
    pts_mios_impuesto = int(v3.gato_impuesto_cobrado.sum())

    resumen = pd.DataFrame([
        {"patron": "Capturas de mi ratón (Timothy cat)", "puntos_cedidos": pts_capturas,
         "evidencia": f"{int(v3.raton_capturas.sum())} capturas en 4 partidas ({int(v3.raton_capturas_con_queso.sum())} con queso); ver Parte 1/2"},
        {"patron": "Entregas del ratón de Timothy contra mi gato", "puntos_cedidos": pts_entregas_rival,
         "evidencia": f"{int(v3.gato_entregas_rival.sum())} entregas rivales en 4 partidas, modo EMBOSCADA del gato"},
        {"patron": "Impuesto (hidingTax) pagado por mi ratón", "puntos_cedidos": pts_impuesto_raton,
         "evidencia": f"{int(v3.raton_impuesto.sum())} eventos hidingTax en 4 partidas"},
    ]).sort_values("puntos_cedidos", ascending=False).reset_index(drop=True)
    resumen["pct_de_puntos_de_timothy"] = (resumen["puntos_cedidos"] / total_rival * 100).round(1)
    return resumen, total_rival, (pts_mios_entregas, pts_mios_capturas, pts_mios_impuesto)


_p3_resumen, _p3_total_rival, _p3_mios = P3_patrones()
print("\n===== PARTE 3: patrones de v3 =====")
print(to_md(_p3_resumen))
print(f"\nTotal puntos de Timothy en v3 (4 partidas): {_p3_total_rival}")
print(f"Mis puntos en v3: entregas={_p3_mios[0]}, capturas={_p3_mios[1]}, impuesto cobrado={_p3_mios[2]}, total={sum(_p3_mios)}")


# =====================================================================
# PARTE 4 — Victorias y empates
# =====================================================================

def P4_resultados():
    df = _p2_partidas.copy()
    df["resultado"] = df.apply(
        lambda r: "ganada" if r.marcador_mio > r.marcador_rival
        else ("empatada" if r.marcador_mio == r.marcador_rival else "perdida"),
        axis=1,
    )
    ganadas_o_empatadas = df[df.resultado.isin(["ganada", "empatada"])][
        ["rival", "version", "casa", "match", "marcador_mio", "marcador_rival",
         "neto_pierna_raton", "neto_pierna_gato", "resultado"]
    ]
    pct = (
        df.groupby("version")["resultado"]
        .value_counts(normalize=True)
        .mul(100).round(1)
        .unstack(fill_value=0)
        .reset_index()
    )
    return ganadas_o_empatadas, pct


_p4_lista, _p4_pct = P4_resultados()
print("\n===== PARTE 4: partidas ganadas o empatadas =====")
print(to_md(_p4_lista) if not _p4_lista.empty else "_(ninguna: todas las partidas de v2 y v3 en los datos están perdidas)_")
print("\n===== PARTE 4: % de resultados por versión =====")
print(to_md(_p4_pct))
