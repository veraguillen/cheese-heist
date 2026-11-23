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
