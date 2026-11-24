"""Prueba de scripts/ordenar_logs.py con logs sintéticos (no datos reales)."""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from ordenar_logs import ordenar  # noqa: E402

MAX_TURNOS = 3


def _log_sintetico(mi_rol: str, rival_header: str, w=11, hg=7, hc=2, score_cat=3, score_mouse=6):
    rol_char = "m" if mi_rol == "mouse" else "c"
    rol_logs_key = "mouse" if mi_rol == "mouse" else "cat"
    jugadores = {"cat": rival_header, "mouse": "veraguillen"} if mi_rol == "mouse" \
        else {"cat": "veraguillen", "mouse": rival_header}

    header = {
        "about": "Midnight Kitchen turn log (sintético, solo para la prueba).",
        "house": "test0000",
        "houseType": "cottage",
        "you": mi_rol,
        "players": jugadores,
        "result": {"score": {"cat": score_cat, "mouse": score_mouse}},
        "rules": {"maxTurns": MAX_TURNOS},
        "map": {"width": w, "height": hg, "rows": ["#" * w] * hg, "holes": [{"x": 1, "y": 0, "entrance": {"x": 1, "y": 1}}] * hc},
    }
    lineas = [json.dumps(header)]
    for turno in range(1, MAX_TURNOS + 1):
        d_lines = []
        if turno == 1:
            d_lines.append(json.dumps({"hdr": 1, "r": rol_char, "w": w, "hg": hg, "hc": hc, "ch": 1, "en": [[1, 1]]}))
        d_lines.append(json.dumps({"t": turno, "r": rol_char, "md": "VIGILAR_QUESO"}))
        turno_obj = {
            "turn": turno,
            "cat": {"x": 1, "y": 1, "facing": "N", "stamina": 10},
            "mouse": {"x": 2, "y": 1, "carrying": False, "tunnel": None},
            "cheese": [[3, 1]],
            "events": [],
            "score": {"cat": 0, "mouse": 0},
            "logs": {rol_logs_key: ["D|" + d for d in d_lines]},
        }
        lineas.append(json.dumps(turno_obj))
    return "\n".join(lineas) + "\n"


def _armar_raw(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    partida1 = _log_sintetico("mouse", "RivalUno", w=11, hg=7, hc=2, score_cat=3, score_mouse=6)
    partida2 = _log_sintetico("cat", "RivalDos", w=9, hg=5, hc=1, score_cat=9, score_mouse=0)

    (raw / "midnight-kitchen-aaaaaaaaaaaa-RivalUno-vs-veraguillen.jsonl").write_text(partida1, encoding="utf-8")
    (raw / "midnight-kitchen-bbbbbbbbbbbb-veraguillen-vs-RivalDos.jsonl").write_text(partida2, encoding="utf-8")
    # "uno repetido": copia exacta (mismo contenido) de la partida 1, como
    # pasaría si se descarga el mismo turn log dos veces.
    (raw / "midnight-kitchen-aaaaaaaaaaaa-RivalUno-vs-veraguillen - copia.jsonl").write_text(partida1, encoding="utf-8")
    return raw


def test_nombres_rol_y_casa(tmp_path):
    raw = _armar_raw(tmp_path)
    dest = tmp_path / "dest"

    nuevos, duplicados, descartados, avisos = ordenar(raw, dest, "v5")

    assert len(descartados) == 0, descartados
    assert len(nuevos) == 2
    assert len(duplicados) == 1

    nombres_nuevos = {n["nombre_nuevo"] for n in nuevos}
    fecha_parte = next(iter(nombres_nuevos)).split("_")[2]  # mismo mtime para los 3 archivos de prueba
    assert f"rivaluno_v5_{fecha_parte}_mouse_11x7h2.jsonl" in nombres_nuevos
    assert f"rivaldos_v5_{fecha_parte}_cat_9x5h1.jsonl" in nombres_nuevos

    # Entre las dos copias idénticas de la partida 1 ("RivalUno" y su
    # " - copia"), cuál de las dos queda como "nuevo" depende del orden de
    # recorrido (sorted() por nombre) -- no importa cuál, mientras sea
    # exactamente una. Se busca por rival, no por nombre de archivo exacto.
    por_rival = {n["rival"]: n for n in nuevos}
    assert por_rival["rivaluno"]["rol"] == "mouse"
    assert por_rival["rivaluno"]["archivo"].startswith("midnight-kitchen-aaaaaaaaaaaa-RivalUno-vs-veraguillen")
    assert por_rival["rivaldos"]["rol"] == "cat"
    assert por_rival["rivaldos"]["archivo"] == "midnight-kitchen-bbbbbbbbbbbb-veraguillen-vs-RivalDos.jsonl"
    # partida1: mouse score=6 > cat score=3 -> gané esa pierna de ratón.
    assert por_rival["rivaluno"]["resultado"] == "ganada"
    # partida2: cat score=9 > mouse score=0 -> gané esa pierna de gato.
    assert por_rival["rivaldos"]["resultado"] == "ganada"


def test_duplicado_no_se_copia_y_raw_queda_intacto(tmp_path):
    raw = _armar_raw(tmp_path)
    dest = tmp_path / "dest"
    archivos_raw_antes = sorted(p.name for p in raw.glob("*.jsonl"))
    hashes_raw_antes = {p.name: p.read_bytes() for p in raw.glob("*.jsonl")}

    ordenar(raw, dest, "v5")

    # raw queda exactamente igual: mismos archivos, mismo contenido.
    archivos_raw_despues = sorted(p.name for p in raw.glob("*.jsonl"))
    assert archivos_raw_despues == archivos_raw_antes
    for p in raw.glob("*.jsonl"):
        assert p.read_bytes() == hashes_raw_antes[p.name]

    # dest tiene solo los 2 nuevos (la copia duplicada no se copió).
    copiados = sorted(p.name for p in dest.glob("*.jsonl"))
    assert len(copiados) == 2

    manifest = pd.read_csv(dest / "manifest.csv")
    assert len(manifest) == 2
    assert set(manifest["rival"]) == {"rivaluno", "rivaldos"}


def test_segunda_corrida_no_repite_nada(tmp_path):
    raw = _armar_raw(tmp_path)
    dest = tmp_path / "dest"

    ordenar(raw, dest, "v5")
    nuevos2, duplicados2, descartados2, _ = ordenar(raw, dest, "v5")

    # Correr de nuevo sobre el mismo raw (como al descargar otra vez) no
    # debe agregar ni duplicar nada: las 3 ya están en el manifest.
    assert len(nuevos2) == 0
    assert len(duplicados2) == 3
    assert len(descartados2) == 0
    assert len(list(dest.glob("*.jsonl"))) == 2

    manifest = pd.read_csv(dest / "manifest.csv")
    assert len(manifest) == 2  # no se duplicaron filas


def test_resultado_empate_y_perdida(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"
    empate = _log_sintetico("mouse", "RivalEmpate", score_cat=5, score_mouse=5)
    perdida = _log_sintetico("cat", "RivalGana", score_cat=2, score_mouse=8)
    (raw / "midnight-kitchen-dddddddddddd-RivalEmpate-vs-veraguillen.jsonl").write_text(empate, encoding="utf-8")
    (raw / "midnight-kitchen-eeeeeeeeeeee-veraguillen-vs-RivalGana.jsonl").write_text(perdida, encoding="utf-8")

    nuevos, _, descartados, _ = ordenar(raw, dest, "v5")
    assert len(descartados) == 0
    por_rival = {n["rival"]: n for n in nuevos}
    assert por_rival["rivalempate"]["resultado"] == "empate"
    assert por_rival["rivalgana"]["resultado"] == "perdida"


def test_log_incompleto_se_descarta(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"
    contenido = _log_sintetico("mouse", "RivalChico", w=5, hg=5, hc=1)
    # Le sacamos el último turno: ahora tiene menos turnos que maxTurns.
    lineas = contenido.splitlines()
    incompleto = "\n".join(lineas[:-1]) + "\n"
    (raw / "midnight-kitchen-cccccccccccc-RivalChico-vs-veraguillen.jsonl").write_text(incompleto, encoding="utf-8")

    nuevos, duplicados, descartados, avisos = ordenar(raw, dest, "v5")

    assert len(nuevos) == 0
    assert len(descartados) == 1
    assert "incompleto" in descartados[0]["motivo"]
    assert not dest.exists() or len(list(dest.glob("*.jsonl"))) == 0
