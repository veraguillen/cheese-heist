"""Prueba de scripts/ordenar_logs.py con logs sintéticos (no datos reales)."""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from ordenar_logs import ordenar  # noqa: E402

MAX_TURNOS = 3


def _log_sintetico(
    mi_rol: str,
    rival_header: str,
    w=11,
    hg=7,
    hc=2,
    score_cat=3,
    score_mouse=6,
    con_lk=False,
    version=None,
    centinela=False,
):
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
        fila = {"t": turno, "r": rol_char, "md": "CENTINELA" if centinela else "VIGILAR_QUESO"}
        if version is not None:
            fila["v"] = version
        if con_lk and rol_char == "c":
            fila["lk"] = "N"  # v6: el gato suma este campo (puede ser null, lo que importa es la clave).
        d_lines.append(json.dumps(fila))
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
    # Sufijo = primeros 6 caracteres de header["house"] (acá "test0000" en
    # los dos, por eso "test00" en los dos nombres); evita que dos piernas
    # con mismo rival/rol/casa/minuto se pisen (pasó de verdad con datos reales).
    assert f"rivaluno_v5_{fecha_parte}_mouse_11x7h2_test00.jsonl" in nombres_nuevos
    assert f"rivaldos_v5_{fecha_parte}_cat_9x5h1_test00.jsonl" in nombres_nuevos

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


def test_version_detectada_por_lk(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"

    # Pierna de gato con "lk" (v6) y pierna de gato sin "lk" (en realidad v5,
    # aunque esté en la carpeta de v6).
    con_lk = _log_sintetico("cat", "RivalV6", con_lk=True)
    sin_lk = _log_sintetico("cat", "RivalV5", con_lk=False)
    (raw / "midnight-kitchen-f0f0f0f0f0f0-veraguillen-vs-RivalV6.jsonl").write_text(con_lk, encoding="utf-8")
    (raw / "midnight-kitchen-f1f1f1f1f1f1-veraguillen-vs-RivalV5.jsonl").write_text(sin_lk, encoding="utf-8")

    nuevos, _, descartados, avisos = ordenar(raw, dest, "v6")
    # La pierna sin "lk" es de v5: se avisa y NO se copia a v6 (queda
    # descartada, no en "nuevos").
    assert len(descartados) == 1
    assert "v5" in descartados[0]["motivo"]
    por_rival = {n["rival"]: n for n in nuevos}
    assert "rivalv5" not in por_rival
    assert por_rival["rivalv6"]["version_detectada"] == "v6"
    assert any("v5" in a for a in avisos)

    manifest = pd.read_csv(dest / "manifest.csv")
    assert set(manifest["version_detectada"]) == {"v6"}


def test_version_detectada_none_para_raton(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"
    # El ratón no cambió entre v5 y v6: nunca hay señal para distinguirlas,
    # así que version_detectada queda indeterminada (None) y no hay aviso.
    contenido = _log_sintetico("mouse", "RivalRaton")
    (raw / "midnight-kitchen-aaaabbbbcccc-RivalRaton-vs-veraguillen.jsonl").write_text(contenido, encoding="utf-8")

    nuevos, _, descartados, avisos = ordenar(raw, dest, "v6")
    assert len(descartados) == 0
    assert nuevos[0]["version_detectada"] is None
    assert not any("detectad" in a for a in avisos)


def test_version_v10_cent_inela_se_hereda_a_la_pierna_mouse(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"
    gato = _log_sintetico("cat", "RivalV10", con_lk=True, centinela=True)
    raton = _log_sintetico("mouse", "RivalV10", con_lk=True)
    (raw / "midnight-kitchen-v10cat000000-veraguillen-vs-RivalV10.jsonl").write_text(gato, encoding="utf-8")
    (raw / "midnight-kitchen-v10mouse0000-RivalV10-vs-veraguillen.jsonl").write_text(raton, encoding="utf-8")

    nuevos, _, descartados, _ = ordenar(raw, dest, "auto")

    assert not descartados, descartados
    assert {fila["version_detectada"] for fila in nuevos} == {"v10"}
    assert all(fila["nombre_nuevo"].startswith("rivalv10_v10_") for fila in nuevos)


def test_version_v11_marcador_explicito_en_ambos_roles(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    dest = tmp_path / "dest"
    gato = _log_sintetico("cat", "RivalV11", version=11, con_lk=True)
    raton = _log_sintetico("mouse", "RivalV11", version=11)
    (raw / "midnight-kitchen-v11cat000000-veraguillen-vs-RivalV11.jsonl").write_text(gato, encoding="utf-8")
    (raw / "midnight-kitchen-v11mouse0000-RivalV11-vs-veraguillen.jsonl").write_text(raton, encoding="utf-8")

    nuevos, _, descartados, _ = ordenar(raw, dest, "auto")

    assert not descartados, descartados
    assert {fila["version_detectada"] for fila in nuevos} == {"v11"}
    assert all(fila["nombre_nuevo"].startswith("rivalv11_v11_") for fila in nuevos)
