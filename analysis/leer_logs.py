"""
leer_logs.py — convierte los turn logs de meow.tel en un DataFrame de pandas.

Uso:
    python analysis/leer_logs.py            # lee todo data/*/*
    python analysis/leer_logs.py data/v1    # solo una versión

O desde un notebook:
    from leer_logs import cargar, cargar_emboscadas
    df = cargar("data")
    df_emboscadas = cargar_emboscadas("data")  # aparte: líneas "emb", no turnos

Cómo funciona:
- Cada archivo es un turn log de Meowtel en formato JSONL: la línea 1 es un
  encabezado (con el resultado final y las reglas de la casa, entre otras
  cosas) y cada línea siguiente es un turno completo.
- De la línea 1 guardamos "result" y "rules" (si están) y los repetimos en
  cada fila de ese archivo, para poder cruzarlos con los turnos.
- De cada turno recorremos logs.cat y logs.mouse (arrays de las líneas que
  imprimió TU bot con console.log; Meowtel no expone las del rival) y nos
  quedamos con las que empiezan con "D|{...}": esas son nuestras.
- La versión sale del nombre de la carpeta (data/v1/...) y el rival del
  nombre del archivo (por ejemplo timothy_01.log -> "timothy").
"""

import json
import sys
from pathlib import Path

import pandas as pd

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


def leer_archivo(ruta: Path) -> tuple[list[dict], list[dict]]:
    filas = []
    filas_emboscadas = []
    lineas = ruta.read_text(encoding="utf-8", errors="replace").splitlines()
    if not lineas:
        return filas, filas_emboscadas

    # Línea 1: encabezado del turn log (no es un turno). Si tiene "result" o
    # "rules", los guardamos para pegarlos en cada fila de este archivo.
    resultado_final = None
    reglas_casa = None
    try:
        encabezado = json.loads(lineas[0])
    except json.JSONDecodeError:
        encabezado = None
    if isinstance(encabezado, dict):
        resultado_final = encabezado.get("result")
        reglas_casa = encabezado.get("rules")

    # Desde la línea 2, cada línea es un turno. "logs.cat"/"logs.mouse" trae
    # SOLO las líneas de console.log de tu propio rol en ese turno (Meowtel
    # no expone las del rival); de ahí sacamos las que empiezan con "D|".
    for n, linea in enumerate(lineas[1:], 2):
        try:
            turno = json.loads(linea)
        except json.JSONDecodeError:
            print(f"  aviso: línea {n} de {ruta.name} no es un turno JSON válido, se saltea")
            continue
        if not isinstance(turno, dict):
            continue
        logs = turno.get("logs") or {}
        for rol_logs in ("cat", "mouse"):
            for cadena in logs.get(rol_logs) or []:
                if not isinstance(cadena, str) or not cadena.startswith("D|"):
                    continue
                try:
                    dato = json.loads(cadena[2:])
                except json.JSONDecodeError:
                    print(f"  aviso: JSON inválido en {ruta.name}, línea {n}")
                    continue
                # El nombre del archivo es <rival>_m<N>_<rol> (por ejemplo
                # timothy_m1_cat.jsonl): la primera parte es el rival y la
                # segunda, el número de partida ("m1").
                partes = ruta.stem.split("_")
                metadatos = {
                    "version": ruta.parent.name,
                    "archivo": ruta.name,
                    "rival": partes[0].lower(),
                    "match": partes[1] if len(partes) > 1 else None,
                }
                # Línea de emboscada a tiempo (DISENO_V5.md §3, LOGS.md): no
                # es un turno completo (no tiene "md"), así que va a su
                # propia lista y no se mezcla con las filas de turno.
                if "emb" in dato and "md" not in dato:
                    filas_emboscadas.append({**dato, **metadatos})
                    continue
                dato = traducir_claves(dato)
                dato.update(metadatos)
                dato["resultado_final"] = resultado_final
                dato["reglas_casa"] = reglas_casa
                filas.append(dato)
    return filas, filas_emboscadas


def _leer_todo(carpeta: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Recorre la carpeta una sola vez y separa filas de turno de líneas de
    emboscada (ver leer_archivo). Uso interno de cargar() y cargar_emboscadas()."""
    base = Path(carpeta)
    archivos = sorted(p for p in base.rglob("*") if p.is_file() and not p.name.startswith("."))
    filas = []
    filas_emboscadas = []
    for ruta in archivos:
        f, e = leer_archivo(ruta)
        filas.extend(f)
        filas_emboscadas.extend(e)
    df = pd.DataFrame(filas)
    if not df.empty:
        df["contra_timothy"] = df["rival"].eq("timothy")
    return df, pd.DataFrame(filas_emboscadas)


def cargar(carpeta: str = "data") -> pd.DataFrame:
    """Solo filas de turno, igual que antes de las líneas de emboscada (v5)."""
    df, _ = _leer_todo(carpeta)
    return df


def cargar_emboscadas(carpeta: str = "data") -> pd.DataFrame:
    """Líneas sueltas de emboscada a tiempo (DISENO_V5.md §3, LOGS.md), aparte de cargar()."""
    _, df_emboscadas = _leer_todo(carpeta)
    return df_emboscadas


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
    df, df_emboscadas = _leer_todo(carpeta)
    if df.empty:
        print(f"No encontré líneas 'D|' en {carpeta}. ¿El bot ya imprime su log (v1 en adelante)?")
    else:
        print(f"{len(df)} turnos de {df['archivo'].nunique()} archivos\n")
        print(resumen(df).to_string())
    if not df_emboscadas.empty:
        print(f"\n{len(df_emboscadas)} líneas de emboscada a tiempo\n")
        print(df_emboscadas.to_string(index=False))
