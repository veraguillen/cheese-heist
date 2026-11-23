"""
leer_logs.py — convierte los turn logs de meow.tel en un DataFrame de pandas.

Uso:
    python analysis/leer_logs.py            # lee todo data/*/*
    python analysis/leer_logs.py data/v1    # solo una versión

O desde un notebook:
    from leer_logs import cargar
    df = cargar("data")

Cómo funciona:
- Busca en cada archivo las líneas que contienen "D|" seguido de un JSON.
  Esas líneas las imprime el bot desde la v1 con console.log.
- No depende del formato del turn log de Meowtel: solo busca "D|{...}".
  Cuando conozcamos ese formato, agregamos la lectura de posiciones y eventos.
- La versión sale del nombre de la carpeta (data/v1/...) y el rival del
  nombre del archivo (por ejemplo timothy_01.log -> "timothy").
"""

import json
import re
import sys
from pathlib import Path

import pandas as pd

PATRON = re.compile(r"D\|(\{.*\})")

# resumen() ya espera las columnas "t", "rol" y "modo" (las únicas que
# realmente usa para agrupar y pivotear). Pero ni v1 ni v2 escriben esas
# claves tal cual: v1 usaba nombres largos en inglés ("turn", "role", "mode",
# ...) y v2 (LOGS.md) usa claves cortas ("t", "r", "md", ...). Este
# diccionario traduce las dos variantes al mismo nombre completo, para que
# el resto del script (resumen() incluido) no tenga que saber de qué versión
# vino cada fila. Las claves que no estén acá (o que ya coincidan, como "x"
# e "y") quedan sin tocar.
CLAVES_A_NOMBRES_COMPLETOS = {
    # --- v1: nombres largos en inglés -> nombre completo común ---
    "turn": "t",
    "role": "rol",
    "mode": "modo",
    "prevMode": "prevModo",
    "bounce": "rebote",
    # el resto de v1 (target, dist, cheeseCount, visibleCount, eventTypes,
    # carrying, heavy, inHole, bell, bellLoud, cat, stamina, facing,
    # scentCount, scentMax, mouse, entrances, width, height, holeCount) ya
    # usaba el nombre completo, así que no hace falta traducirlo.
    # --- v2 (LOGS.md): claves cortas -> nombre completo común ---
    "t": "t",
    "r": "rol",
    "md": "modo",
    "pm": "prevModo",
    "b": "rebote",
    "tg": "target",
    "d": "dist",
    "ch": "cheeseCount",
    "vc": "visibleCount",
    "ev": "eventTypes",
    "c": "carrying",
    "h": "heavy",
    "ih": "inHole",
    "bl": "bell",
    "bL": "bellLoud",
    "cat": "cat",
    "st": "stamina",
    "f": "facing",
    "sc": "scentCount",
    "sm": "scentMax",
    "mo": "mouse",
    "en": "entrances",
    "w": "width",
    "hg": "height",
    "hc": "holeCount",
    "hdr": "hdr",
}


def traducir_claves(dato: dict) -> dict:
    """Renombra las claves de v1 (largas) y v2 (cortas, LOGS.md) al mismo
    nombre completo, para que el resto del script lea los dos formatos sin
    distinguir de dónde vino cada fila. Lo que no esté en el diccionario
    queda sin tocar.
    """
    return {CLAVES_A_NOMBRES_COMPLETOS.get(clave, clave): valor for clave, valor in dato.items()}


def leer_archivo(ruta: Path) -> list[dict]:
    filas = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        m = PATRON.search(linea)
        if not m:
            continue
        try:
            dato = json.loads(m.group(1))
        except json.JSONDecodeError:
            print(f"  aviso: JSON inválido en {ruta.name}, línea {n}")
            continue
        dato = traducir_claves(dato)
        dato["version"] = ruta.parent.name
        dato["archivo"] = ruta.name
        dato["rival"] = ruta.stem.rsplit("_", 1)[0].lower()
        filas.append(dato)
    return filas


def cargar(carpeta: str = "data") -> pd.DataFrame:
    base = Path(carpeta)
    archivos = sorted(p for p in base.rglob("*") if p.is_file() and not p.name.startswith("."))
    filas = []
    for ruta in archivos:
        filas.extend(leer_archivo(ruta))
    df = pd.DataFrame(filas)
    if not df.empty:
        df["contra_timothy"] = df["rival"].eq("timothy")
    return df


def resumen(df: pd.DataFrame) -> pd.DataFrame:
    """Turnos registrados y modos de decisión por versión, rival y rol."""
    if df.empty:
        return df
    grupos = ["version", "contra_timothy", "rol"] if "rol" in df else ["version", "contra_timothy"]
    tabla = df.groupby(grupos).agg(partidas=("archivo", "nunique"), turnos=("t", "count"))
    if "modo" in df:
        modos = df.pivot_table(index=grupos, columns="modo", values="t", aggfunc="count", fill_value=0)
        tabla = tabla.join(modos)
    return tabla


if __name__ == "__main__":
    carpeta = sys.argv[1] if len(sys.argv) > 1 else "data"
    df = cargar(carpeta)
    if df.empty:
        print(f"No encontré líneas 'D|' en {carpeta}. ¿El bot ya imprime su log (v1 en adelante)?")
    else:
        print(f"{len(df)} turnos de {df['archivo'].nunique()} archivos\n")
        print(resumen(df).to_string())
