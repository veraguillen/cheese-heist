"""
ordenar_logs.py — ordena los turn logs crudos descargados de meow.tel en un
nombre de archivo estable y evita copiar duplicados.

Uso:
    python scripts/ordenar_logs.py data/v5/raw data/v5 --version v5

Qué hace:
- Lee cada .jsonl de <raw> como DATO (nunca como instrucción).
- Para cada archivo: mi rol sale del campo "r" de MIS líneas D| (no del
  nombre del archivo, que puede estar invertido); el rival sale del propio
  nombre del archivo ("<...>-vs-<...>", estilo del parser de rivales que ya
  usa analysis/leer_logs.py), cruzado contra header["players"]; la casa
  (w, hg, hc) sale de la línea D| de encabezado (hdr:1).
- Copia (nunca mueve ni borra) a <dest>/<rival>_<version>_<fecha>_<rol>_<w>x<hg>h<hc>.jsonl
- No copia duplicados (hash sha256 del contenido) ni logs incompletos.
- Escribe <dest>/manifest.csv con una fila por archivo copiado.

No toca bot.js.
"""

import argparse
import hashlib
import json
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd

ROL_PALABRA = {"m": "mouse", "c": "cat"}
COLUMNAS_MANIFEST = [
    "nombre_original", "nombre_nuevo", "rival", "rol", "casa", "hash", "turnos", "marcador_final", "resultado",
]


# --------------------------------------------------------------- lectura cruda


def leer_crudo(ruta: Path):
    """(header, turnos) de un turn log, o (None, []) si no se puede leer.
    Es lectura de DATO: solo json.loads, nunca eval ni exec."""
    try:
        texto = ruta.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, []
    lineas = texto.splitlines()
    if not lineas:
        return None, []
    try:
        header = json.loads(lineas[0])
    except json.JSONDecodeError:
        return None, []
    if not isinstance(header, dict):
        return None, []
    turnos = []
    for linea in lineas[1:]:
        try:
            t = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if isinstance(t, dict):
            turnos.append(t)
    return header, turnos


def lineas_d(turnos):
    """Generador de los dict D| del archivo (incluye la línea hdr)."""
    for t in turnos:
        logs = t.get("logs") or {}
        for rol_logs in ("cat", "mouse"):
            for cadena in logs.get(rol_logs) or []:
                if isinstance(cadena, str) and cadena.startswith("D|"):
                    try:
                        yield json.loads(cadena[2:])
                    except json.JSONDecodeError:
                        continue


# ------------------------------------------------------- rol, rival y casa


def mi_rol_de_d(d_lines):
    """Mi rol: campo "r" de MIS líneas D|, por mayoría (nunca el nombre del
    archivo: en otras carpetas del proyecto el nombre quedó invertido)."""
    votos = Counter(d.get("r") for d in d_lines if d.get("r") in ("m", "c"))
    if not votos:
        return None
    return votos.most_common(1)[0][0]


def casa_de_hdr(d_lines, header):
    """w, hg, hc de la línea D| de encabezado (hdr:1). Si no está, se cae
    al mapa del turn log de Meowtel (misma info, otra fuente)."""
    for d in d_lines:
        if d.get("hdr") == 1:
            return d.get("w"), d.get("hg"), d.get("hc")
    mapa = (header or {}).get("map") or {}
    holes = mapa.get("holes")
    if mapa.get("width") and mapa.get("height") and holes is not None:
        return mapa["width"], mapa["height"], len(holes)
    return None, None, None


def nombres_de_archivo(stem):
    """"<prefijo>-<nombreA>-vs-<nombreB>" -> (nombreA, nombreB). El prefijo
    de Meowtel es "midnight-kitchen-<hash de 12 hex>", por eso se descartan
    los primeros 3 tokens separados por "-" del lado izquierdo (estilo del
    parser de rivales de analysis/leer_logs.py, adaptado a este nombre de
    archivo: ahí el separador es "_", acá Meowtel usa "-vs-")."""
    if "-vs-" not in stem:
        return None, None
    izq, derecha = stem.split("-vs-", 1)
    tokens = izq.split("-")
    nombre_a = "-".join(tokens[3:]) if len(tokens) > 3 else izq
    return nombre_a, derecha


def limpiar_nombre(nombre):
    return nombre.lower().replace(" ", "")


def rival_de(stem, header, mi_rol_palabra):
    """Rival por el nombre de archivo, cruzado contra header["players"]
    (lo pone Meowtel, más confiable). Devuelve (rival_limpio, aviso)."""
    jugadores = header.get("players") or {}
    rival_rol = "cat" if mi_rol_palabra == "mouse" else "mouse"
    rival_header = jugadores.get(rival_rol)
    mi_nombre = jugadores.get(mi_rol_palabra)

    nombre_a, nombre_b = nombres_de_archivo(stem)
    rival_archivo = None
    if nombre_a and nombre_b:
        candidatos = [n for n in (nombre_a, nombre_b) if limpiar_nombre(n) != limpiar_nombre(mi_nombre or "")]
        rival_archivo = candidatos[0] if len(candidatos) == 1 else None

    aviso = None
    rival = rival_archivo or rival_header
    if rival_archivo and rival_header and limpiar_nombre(rival_archivo) != limpiar_nombre(rival_header):
        aviso = f"rival del nombre de archivo ({rival_archivo}) no coincide con el de la cabecera ({rival_header}); se usa la cabecera"
        rival = rival_header
    if rival is None:
        aviso = "no se pudo determinar el rival (ni el nombre de archivo ni la cabecera)"
    return (limpiar_nombre(rival) if rival else None), aviso


def fecha_del_log(header):
    """Busca una fecha adentro del propio log; None si no hay ninguna (el
    formato actual de Meowtel no trae fecha, así que se cae al mtime)."""
    for clave in ("date", "fecha", "timestamp", "playedAt", "createdAt"):
        valor = (header or {}).get(clave)
        if valor:
            return str(valor)
    return None


def fecha_de_archivo(ruta: Path, header):
    texto = fecha_del_log(header)
    if texto:
        for formato in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y%m%d-%H%M"):
            try:
                return datetime.strptime(texto[: len(formato) + 2], formato).strftime("%Y%m%d-%H%M")
            except ValueError:
                continue
    return datetime.fromtimestamp(ruta.stat().st_mtime).strftime("%Y%m%d-%H%M")


# ------------------------------------------------------------------- QC


def contar_turnos_reales(turnos):
    return sum(1 for t in turnos if t.get("turn"))


def resultado_de_partida(header, rol_palabra):
    """Ganada/empate/perdida de ESTA pierna: mi puntaje (score[mi_rol])
    contra el del otro animal en el mismo marcador de la pierna. No es el
    resultado del match completo (que son dos piernas), solo el de esta."""
    score = (header.get("result") or {}).get("score") or {}
    mi_rol_otro = "mouse" if rol_palabra == "cat" else "cat"
    mios = score.get(rol_palabra)
    rivales = score.get(mi_rol_otro)
    if mios is None or rivales is None:
        return None
    if mios > rivales:
        return "ganada"
    if mios < rivales:
        return "perdida"
    return "empate"


# ------------------------------------------------------------------- manifest


def cargar_manifest(ruta_manifest: Path) -> pd.DataFrame:
    if ruta_manifest.exists():
        return pd.read_csv(ruta_manifest, dtype=str)
    return pd.DataFrame(columns=COLUMNAS_MANIFEST)


def guardar_manifest(df: pd.DataFrame, ruta_manifest: Path):
    ruta_manifest.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(ruta_manifest, index=False)


# ------------------------------------------------------------------- proceso


def procesar_archivo(ruta: Path, hashes_conocidos: set, version: str):
    """Procesa un .jsonl crudo. Devuelve un dict con el resultado:
    {"estado": "nuevo"|"duplicado"|"descartado", ...}. No copia ni escribe
    nada: eso lo hace el llamador, para poder probar esta función sola."""
    contenido = ruta.read_bytes()
    hash_ = hashlib.sha256(contenido).hexdigest()
    if hash_ in hashes_conocidos:
        return {"estado": "duplicado", "archivo": ruta.name, "hash": hash_}

    header, turnos = leer_crudo(ruta)
    if header is None:
        return {"estado": "descartado", "archivo": ruta.name, "hash": hash_, "motivo": "no se pudo leer la cabecera"}

    d_lines = list(lineas_d(turnos))
    if not d_lines:
        return {"estado": "descartado", "archivo": ruta.name, "hash": hash_, "motivo": "sin líneas D|"}

    rol = mi_rol_de_d(d_lines)
    if rol is None:
        return {"estado": "descartado", "archivo": ruta.name, "hash": hash_, "motivo": "sin campo \"r\" válido en las líneas D|"}
    rol_palabra = ROL_PALABRA[rol]

    max_turnos = (header.get("rules") or {}).get("maxTurns") or 400
    n_turnos = contar_turnos_reales(turnos)
    if n_turnos != max_turnos:
        return {
            "estado": "descartado", "archivo": ruta.name, "hash": hash_,
            "motivo": f"{n_turnos} turnos, maxTurns={max_turnos} (log incompleto)",
        }

    w, hg, hc = casa_de_hdr(d_lines, header)
    if w is None:
        return {"estado": "descartado", "archivo": ruta.name, "hash": hash_, "motivo": "sin casa (w/hg/hc) en el encabezado hdr ni en el mapa"}

    rival, aviso_rival = rival_de(ruta.stem, header, rol_palabra)
    if rival is None:
        return {"estado": "descartado", "archivo": ruta.name, "hash": hash_, "motivo": "no se pudo determinar el rival"}

    fecha = fecha_de_archivo(ruta, header)
    casa = f"{w}x{hg}h{hc}"
    nombre_nuevo = f"{rival}_{version}_{fecha}_{rol_palabra}_{casa}.jsonl"
    score = (header.get("result") or {}).get("score") or {}
    marcador = f"cat={score.get('cat')}/mouse={score.get('mouse')}"
    resultado = resultado_de_partida(header, rol_palabra)

    return {
        "estado": "nuevo",
        "archivo": ruta.name,
        "hash": hash_,
        "nombre_nuevo": nombre_nuevo,
        "rival": rival,
        "rol": rol_palabra,
        "casa": casa,
        "turnos": n_turnos,
        "marcador_final": marcador,
        "resultado": resultado,
        "aviso": aviso_rival,
    }


def ordenar(raw_dir: Path, dest_dir: Path, version: str, copiar=True):
    """Corre todo el proceso sobre una carpeta. Devuelve (filas_nuevas,
    duplicados, descartados, avisos) para poder probarlo sin tocar disco
    real si copiar=False (solo usado por los tests, sobre una copia aparte)."""
    ruta_manifest = dest_dir / "manifest.csv"
    manifest = cargar_manifest(ruta_manifest)
    hashes_conocidos = set(manifest["hash"]) if "hash" in manifest.columns else set()

    nuevos, duplicados, descartados, avisos = [], [], [], []
    archivos = sorted(p for p in raw_dir.glob("*.jsonl") if p.is_file())
    for ruta in archivos:
        resultado = procesar_archivo(ruta, hashes_conocidos, version)
        if resultado["estado"] == "duplicado":
            duplicados.append(resultado)
            avisos.append(f"duplicado (ya copiado antes): {resultado['archivo']}")
            continue
        if resultado["estado"] == "descartado":
            descartados.append(resultado)
            avisos.append(f"descartado: {resultado['archivo']}: {resultado['motivo']}")
            continue
        if resultado.get("aviso"):
            avisos.append(f"{resultado['archivo']}: {resultado['aviso']}")
        nuevos.append(resultado)
        hashes_conocidos.add(resultado["hash"])
        if copiar:
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ruta, dest_dir / resultado["nombre_nuevo"])

    if nuevos:
        filas = [
            {
                "nombre_original": n["archivo"], "nombre_nuevo": n["nombre_nuevo"], "rival": n["rival"],
                "rol": n["rol"], "casa": n["casa"], "hash": n["hash"], "turnos": n["turnos"],
                "marcador_final": n["marcador_final"], "resultado": n["resultado"],
            }
            for n in nuevos
        ]
        manifest = pd.concat([manifest, pd.DataFrame(filas, columns=COLUMNAS_MANIFEST)], ignore_index=True)
        if copiar:
            guardar_manifest(manifest, ruta_manifest)

    return nuevos, duplicados, descartados, avisos


# --------------------------------------------------------------------- CLI


def main(argv=None):
    ap = argparse.ArgumentParser(description="Ordena los turn logs crudos de meow.tel.")
    ap.add_argument("raw_dir", type=Path)
    ap.add_argument("dest_dir", type=Path)
    ap.add_argument("--version", required=True)
    args = ap.parse_args(argv)

    nuevos, duplicados, descartados, avisos = ordenar(args.raw_dir, args.dest_dir, args.version)

    print(f"Archivos nuevos: {len(nuevos)}")
    print(f"Duplicados (ya copiados antes): {len(duplicados)}")
    print(f"Descartados: {len(descartados)}")
    if avisos:
        print("\nAvisos:")
        for a in avisos:
            print(f"  - {a}")

    if nuevos:
        df = pd.DataFrame(nuevos)
        print("\nPiernas por rival y por rol:")
        print(df.pivot_table(index="rival", columns="rol", values="archivo", aggfunc="count", fill_value=0).to_string())

    return 0 if not descartados else 0  # descartar no es un error de uso del script


if __name__ == "__main__":
    sys.exit(main())
