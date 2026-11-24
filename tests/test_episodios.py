"""Prueba de analysis/episodios.py con un log sintético de 30 turnos.

Escenario (mi_rol="mouse", pasillo de 1 fila con un agujero en x=1):
  T1-T4   el ratón sale del agujero y camina hacia el queso en (5,1).
  T5      pickup -> arranca el episodio A del gato (mío=rival) y la fase
          VUELTA del episodio 1 del ratón (mío=mio).
  T10     delivered -> cierra episodio 1 del ratón (delivered) y A del gato.
  T11-T14 el ratón vuelve a salir (episodio 2 del ratón).
  T15     pickup -> episodio B del gato.
  T16     caught (con teletransporte al agujero) -> cierra episodio 2 del
          ratón (caught) y B del gato (caught).
  T17-T20 el ratón vuelve a salir (episodio 3 del ratón).
  T21     pickup -> episodio C del gato.
  T22     dropped (se queda en la misma casilla) -> cierra episodio 3 del
          ratón (dropped) y C del gato (dropped). El ratón NO vuelve a un
          agujero entre el drop y el re-pickup, así que no abre un cuarto
          episodio de ratón (consigna: el ratón arranca episodio al salir
          de un agujero, no al volver a levantar un queso soltado).
  T23     el ratón se corre de la casilla (paso necesario para poder
          levantar el mismo queso otra vez).
  T24     pickup (re-pickup) -> episodio NUEVO D del gato (consigna §B).
  T29     delivered -> cierra D del gato. Para el ratón, este tramo (T23-29)
          queda fuera de cualquier episodio (no hubo agujero de por medio).
  T30     sin eventos, el ratón se queda adentro.

Episodios de ratón esperados (mío): exactamente 3 -> delivered, caught, dropped.
Episodios de gato esperados (rival): exactamente 4 -> delivered, caught, dropped, delivered.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "analysis"))
from episodios import control_calidad, episodios_gato_de_pierna, episodios_raton_de_pierna, leer_pierna  # noqa: E402

import pandas as pd

MAX_TURNOS = 30


def _d_mouse(turno, x, y, carrying):
    piezas = []
    if turno == 1:
        piezas.append({"hdr": 1, "r": "m", "w": 10, "hg": 3, "hc": 1, "ch": 1, "en": [[1, 1]]})
    piezas.append({"t": turno, "r": "m", "md": "IR_AL_QUESO" if not carrying else "VOLVER", "x": x, "y": y, "c": int(carrying)})
    return ["D|" + json.dumps(p) for p in piezas]


def _armar_log():
    # (x, y, carrying, events) por turno, 1..30. El gato queda fijo en (8,1).
    plan = {
        1: (1, 1, False, []), 2: (2, 1, False, []), 3: (3, 1, False, []), 4: (4, 1, False, []),
        5: (5, 1, True, [{"type": "pickup", "x": 5, "y": 1}]),
        6: (4, 1, True, []), 7: (3, 1, True, []), 8: (2, 1, True, []), 9: (1, 1, True, []),
        10: (1, 0, False, [{"type": "delivered", "hole": 0}]),
        11: (1, 1, False, []), 12: (2, 1, False, []), 13: (3, 1, False, []), 14: (4, 1, False, []),
        15: (5, 1, True, [{"type": "pickup", "x": 5, "y": 1}]),
        16: (1, 0, False, [{"type": "caught", "x": 5, "y": 1, "respawnHole": 0}]),
        17: (1, 1, False, []), 18: (2, 1, False, []), 19: (3, 1, False, []), 20: (4, 1, False, []),
        21: (5, 1, True, [{"type": "pickup", "x": 5, "y": 1}]),
        22: (5, 1, False, [{"type": "dropped", "x": 5, "y": 1}]),
        23: (4, 1, False, []),
        24: (5, 1, True, [{"type": "pickup", "x": 5, "y": 1}]),
        25: (4, 1, True, []), 26: (3, 1, True, []), 27: (2, 1, True, []), 28: (1, 1, True, []),
        29: (1, 0, False, [{"type": "delivered", "hole": 0}]),
        30: (1, 0, False, []),
    }
    header = {
        "about": "sintético, solo para la prueba",
        "house": "synthtest",
        "houseType": "cottage",
        "you": "mouse",
        "players": {"cat": "RivalGato", "mouse": "veraguillen"},
        "result": {"score": {"cat": 3, "mouse": 6}, "stats": {"catches": 1, "delivered": 2, "dropped": 1, "hiddenTurns": 0}},
        "rules": {"maxTurns": MAX_TURNOS, "catchPoints": 3, "cheesePoints": 3, "hidingTaxEvery": 15},
        "map": {
            "width": 10, "height": 3,
            "rows": ["#H########", "#........#", "##########"],
            "holes": [{"x": 1, "y": 0, "entrance": {"x": 1, "y": 1}}],
        },
    }
    lineas = [json.dumps(header)]
    for turno in range(1, MAX_TURNOS + 1):
        x, y, carrying, eventos = plan[turno]
        turno_obj = {
            "turn": turno,
            "cat": {"x": 8, "y": 1, "facing": "W", "stamina": 20},
            "mouse": {"x": x, "y": y, "carrying": carrying, "tunnel": None},
            "cheese": [],
            "events": eventos,
            "score": {"cat": 0, "mouse": 0},
            "logs": {"mouse": _d_mouse(turno, x, y, carrying)},
        }
        lineas.append(json.dumps(turno_obj))
    return "\n".join(lineas) + "\n"


def test_episodios_sintetico(tmp_path):
    ruta = tmp_path / "synthtest_mouse.jsonl"
    ruta.write_text(_armar_log(), encoding="utf-8")

    p = leer_pierna(ruta)
    assert p is not None
    ok, avisos = control_calidad([p])
    assert avisos == []
    assert len(ok) == 1
    p = ok[0]

    ep_raton = episodios_raton_de_pierna(p)
    ep_gato = episodios_gato_de_pierna(p, pd.DataFrame(), pd.DataFrame())

    # Ratón (mío): exactamente 3 episodios, en orden, con estos finales.
    assert [e["fin"] for e in ep_raton] == ["delivered", "caught", "dropped"]
    assert all(e["bot"] == "mio" for e in ep_raton)
    assert [e["turno_inicio"] for e in ep_raton] == [1, 11, 17]
    assert [e["turno_fin"] for e in ep_raton] == [10, 16, 22]
    assert ep_raton[0]["puntos"] == 3     # cheesePoints
    assert ep_raton[1]["puntos"] == -3    # -catchPoints
    assert ep_raton[2]["puntos"] == 0     # dropped, censurado

    # Gato (rival): exactamente 4 episodios -- el re-pickup después del
    # drop abre uno nuevo (no se pega al del drop).
    assert [e["fin"] for e in ep_gato] == ["delivered", "caught", "dropped", "delivered"]
    assert all(e["bot"] == "rival" for e in ep_gato)
    assert [e["turno_inicio"] for e in ep_gato] == [5, 15, 21, 24]
    assert [e["turno_fin"] for e in ep_gato] == [10, 16, 22, 29]

    # Control de calidad: el marcador real sale de los eventos, no de los
    # episodios de UN solo lado (el score.mouse cuenta las 2 entregas, una
    # de ellas -la del re-pickup- quedó fuera de cualquier episodio de ratón).
    delivered_mouse = sum(1 for t in p["turnos"] for e in t.get("events") or [] if e.get("type") == "delivered")
    assert delivered_mouse * p["cheesePoints"] == p["resultado"]["score"]["mouse"] == 6
    caught = sum(1 for t in p["turnos"] for e in t.get("events") or [] if e.get("type") == "caught")
    assert caught * p["catchPoints"] == p["resultado"]["score"]["cat"] == 3
