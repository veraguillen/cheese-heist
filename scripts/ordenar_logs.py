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
import re
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd

ROL_PALABRA = {"m": "mouse", "c": "cat"}
COLUMNAS_MANIFEST = [
    "nombre_original", "nombre_nuevo", "rival", "rol", "casa", "hash", "turnos", "marcador_final", "resultado",
    "version_detectada",
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


def tiene_senal_v7(d_lines):
    """Señal PROPIA de v7 en el archivo (cualquier turno): "sp" en una línea
    de gato (sprint pedido) o md="CAMBIAR_AGUJERO" en una de ratón. Es
    opcional -- un partido corto puede no activar nunca ninguna de las dos
    reglas y seguir siendo v7 -- así que su ausencia es aviso, no descarte."""
    return any("sp" in d for d in d_lines) or any(d.get("md") == "CAMBIAR_AGUJERO" for d in d_lines)


def version_detectada_de_d(d_lines, rol_palabra):
    """Detecta versiones con marcador explícito y, para logs antiguos, las
    señales históricas disponibles. v10 se identifica por CENTINELA; v11
    escribe ``v: 11`` en cada línea D|. Las piernas de ratón v10 heredan la
    versión de su gato por house_id."""
    for d in d_lines:
        version = d.get("v")
        if isinstance(version, (int, float)) and version >= 11:
            return f"v{int(version)}"
    if any(d.get("md") == "CENTINELA" for d in d_lines):
        return "v10"
    if rol_palabra != "cat":
        return None
    return "v6" if any("lk" in d for d in d_lines) else "v5"


def version_por_house_id(raw_dir: Path):
    """Primera pasada por <raw_dir>: detecta la versión en cada pierna de
    gato y la indexa por header["house"], para que las piernas de ratón
    antiguas sin marcador propio puedan heredarla."""
    por_house = {}
    for ruta in sorted(raw_dir.glob("*.jsonl")):
        if not ruta.is_file():
            continue
        header, turnos = leer_crudo(ruta)
        if header is None:
            continue
        d_lines = list(lineas_d(turnos))
        rol = mi_rol_de_d(d_lines)
        if rol != "c":
            continue
        house_id = header.get("house")
        if not house_id:
            continue
        por_house[house_id] = version_detectada_de_d(d_lines, "cat")
    return por_house


def _version_numero(version_str):
    m = re.match(r"v?(\d+(?:\.\d+)?)", version_str or "", re.IGNORECASE)
    return float(m.group(1)) if m else None


def aviso_version(version_detectada, version_declarada):
    """Solo para --version fija (no "auto"): avisa si la generación
    detectada no coincide con la declarada."""
    if version_detectada is None:
        return None
    numero = _version_numero(version_declarada)
    if numero is None:
        return None
    if version_detectada in ("v10", "v11"):
        detectado = _version_numero(version_detectada)
        if numero != detectado:
            return f'detectada {version_detectada}, pero --version={version_declarada}'
        return None
    es_v6_o_mas = numero >= 6
    if version_detectada == "v6" and not es_v6_o_mas:
        return f'detectada v6 (tiene "lk") pero --version={version_declarada} dice v5 o anterior'
    if version_detectada == "v5" and es_v6_o_mas:
        return f'detectada v5 (sin "lk") pero --version={version_declarada} dice v6 o posterior'
    return None


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


def procesar_archivo(ruta: Path, hashes_conocidos: set, version: str, version_por_house=None, corte_mtime=None):
    """Procesa un .jsonl crudo. Devuelve un dict con el resultado:
    {"estado": "nuevo"|"duplicado"|"descartado", ...}. No copia ni escribe
    nada: eso lo hace el llamador, para poder probar esta función sola.

    version="auto": version_detectada sale del marcador D|, del modo
    CENTINELA (v10) o de las señales históricas del gato; el ratón puede
    heredarla por house_id. Si no se puede determinar, se descarta."""
    # Control de --corte-mtime (pedido para v7, "filtra por la hora de
    # subida"): un archivo subido ANTES del corte no puede ser de la
    # versión nueva, aunque esté en esta carpeta -- se descarta antes de
    # leerlo siquiera.
    if corte_mtime is not None and ruta.stat().st_mtime <= corte_mtime:
        return {
            "estado": "descartado", "archivo": ruta.name, "hash": None,
            "motivo": "se subió antes del corte de --corte-mtime (probablemente de la versión anterior)",
        }

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

    house_id = header.get("house")
    version_detectada = version_detectada_de_d(d_lines, rol_palabra)
    if version_detectada is None and version_por_house is not None:
        version_detectada = version_por_house.get(house_id)

    modo_auto = version == "auto"
    if modo_auto and version_detectada is None:
        return {
            "estado": "descartado", "archivo": ruta.name, "hash": hash_,
            "motivo": "no se pudo determinar la versión (sin marcador ni pierna de gato identificable en esta carpeta)",
        }
    version_para_nombre = version_detectada if modo_auto else version

    fecha = fecha_de_archivo(ruta, header)
    casa = f"{w}x{hg}h{hc}"
    # house_id (los primeros 6 hex) evita que dos rondas contra el mismo
    # rival, con la misma casa, descargadas en el mismo minuto, se pisen
    # entre sí (pasó de verdad: 25 archivos de v6 se perdieron así antes de
    # este fix).
    sufijo_casa = (house_id or "")[:6]
    nombre_nuevo = f"{rival}_{version_para_nombre}_{fecha}_{rol_palabra}_{casa}_{sufijo_casa}.jsonl"
    score = (header.get("result") or {}).get("score") or {}
    marcador = f"cat={score.get('cat')}/mouse={score.get('mouse')}"
    resultado = resultado_de_partida(header, rol_palabra)
    aviso_ver = None if modo_auto else aviso_version(version_detectada, version)
    # Control pedido para --version v6: una pierna de GATO sin "lk" es de
    # v5 (lk se agregó en v6), aunque esté en la carpeta "de v6" -- se avisa
    # y NO se copia (el ratón no tiene esta señal, así que no se filtra).
    if not modo_auto and rol_palabra == "cat" and aviso_ver is not None:
        return {
            "estado": "descartado", "archivo": ruta.name, "hash": hash_,
            "motivo": f'pierna de gato detectada como {version_detectada} ({aviso_ver}); no se copia a --version={version}',
        }

    # Aviso suave para --version v7 (no descarta: sp y CAMBIAR_AGUJERO son
    # opcionales, un partido corto puede no activarlos nunca y seguir
    # siendo v7 de verdad).
    aviso_v7 = None
    if not modo_auto and _version_numero(version) == 7 and not tiene_senal_v7(d_lines):
        aviso_v7 = 'sin señal propia de v7 (ni "sp" ni "CAMBIAR_AGUJERO") en todo el archivo; podría ser v6, revisar'

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
        "version_detectada": version_detectada,
        "version_para_nombre": version_para_nombre,
        "aviso": aviso_rival,
        "aviso_version": aviso_ver,
        "aviso_v7": aviso_v7,
    }


def _carpeta_destino(dest_dir: Path, resultado: dict, modo_auto: bool) -> Path:
    return (dest_dir / resultado["version_para_nombre"]) if modo_auto else dest_dir


def ordenar(raw_dir: Path, dest_dir: Path, version: str, copiar=True, corte_mtime=None):
    """Corre todo el proceso sobre una carpeta. Devuelve (filas_nuevas,
    duplicados, descartados, avisos) para poder probarlo sin tocar disco
    real si copiar=False (solo usado por los tests, sobre una copia aparte).

    version="auto": cada archivo va a <dest_dir>/<version>/ según lo detectado
    (ver version_detectada_de_d y version_por_house_id), CADA carpeta con su
    propio manifest.csv. Los duplicados se chequean contra TODOS los
    manifest.csv que ya existan bajo dest_dir (de cualquier versión), no
    solo el de la carpeta a la que iría este archivo -- un mismo contenido
    no debería quedar copiado dos veces aunque "parezca" de otra versión."""
    modo_auto = version == "auto"

    if modo_auto:
        version_por_house = version_por_house_id(raw_dir)
        hashes_conocidos = set()
        for ruta_m in dest_dir.glob("*/manifest.csv"):
            m = cargar_manifest(ruta_m)
            if "hash" in m.columns:
                hashes_conocidos |= set(m["hash"])
        manifest_directo = cargar_manifest(dest_dir / "manifest.csv")
        if "hash" in manifest_directo.columns:
            hashes_conocidos |= set(manifest_directo["hash"])
    else:
        version_por_house = None
        manifest = cargar_manifest(dest_dir / "manifest.csv")
        hashes_conocidos = set(manifest["hash"]) if "hash" in manifest.columns else set()

    nuevos, duplicados, descartados, avisos = [], [], [], []
    archivos = sorted(p for p in raw_dir.glob("*.jsonl") if p.is_file())
    for ruta in archivos:
        resultado = procesar_archivo(ruta, hashes_conocidos, version, version_por_house, corte_mtime)
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
        if resultado.get("aviso_version"):
            avisos.append(f"{resultado['archivo']}: {resultado['aviso_version']}")
        if resultado.get("aviso_v7"):
            avisos.append(f"{resultado['archivo']}: {resultado['aviso_v7']}")
        nuevos.append(resultado)
        hashes_conocidos.add(resultado["hash"])
        if copiar:
            carpeta = _carpeta_destino(dest_dir, resultado, modo_auto)
            carpeta.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ruta, carpeta / resultado["nombre_nuevo"])

    # Un manifest.csv por carpeta destino (en modo fijo es solo una).
    por_carpeta = {}
    for n in nuevos:
        por_carpeta.setdefault(_carpeta_destino(dest_dir, n, modo_auto), []).append(n)
    for carpeta, filas_n in por_carpeta.items():
        ruta_manifest = carpeta / "manifest.csv"
        manifest = cargar_manifest(ruta_manifest)
        filas = [
            {
                "nombre_original": n["archivo"], "nombre_nuevo": n["nombre_nuevo"], "rival": n["rival"],
                "rol": n["rol"], "casa": n["casa"], "hash": n["hash"], "turnos": n["turnos"],
                "marcador_final": n["marcador_final"], "resultado": n["resultado"],
                "version_detectada": n["version_detectada"],
            }
            for n in filas_n
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
    ap.add_argument(
        "--corte-mtime", default=None,
        help='Descarta archivos subidos antes de esta fecha/hora ("YYYY-MM-DD HH:MM"); '
             'con --version v7 y sin este flag, se calcula solo como el mtime más nuevo '
             'de data/v6/raw (si existe), para no mezclar piernas de v6 descargadas tarde.',
    )
    args = ap.parse_args(argv)

    corte_mtime = None
    if args.corte_mtime:
        corte_mtime = datetime.strptime(args.corte_mtime, "%Y-%m-%d %H:%M").timestamp()
    elif _version_numero(args.version) == 7:
        carpeta_v6 = Path("data/v6/raw")
        if carpeta_v6.is_dir():
            mtimes_v6 = [p.stat().st_mtime for p in carpeta_v6.glob("*.jsonl") if p.is_file()]
            if mtimes_v6:
                corte_mtime = max(mtimes_v6)
                print(f"--corte-mtime no especificado: se usa el mtime más nuevo de data/v6/raw ({datetime.fromtimestamp(corte_mtime)})")

    nuevos, duplicados, descartados, avisos = ordenar(args.raw_dir, args.dest_dir, args.version, corte_mtime=corte_mtime)

    print(f"Archivos nuevos: {len(nuevos)}")
    print(f"Duplicados (ya copiados antes): {len(duplicados)}")
    print(f"Descartados: {len(descartados)}")
    if avisos:
        print("\nAvisos:")
        for a in avisos:
            print(f"  - {a}")

    if nuevos:
        df = pd.DataFrame(nuevos)
        if args.version == "auto":
            print("\nPiernas por versión detectada:")
            print(df["version_detectada"].value_counts().to_string())
            print("\nPiernas por versión, rival y rol:")
            print(df.pivot_table(index="rival", columns=["version_detectada", "rol"], values="archivo", aggfunc="count", fill_value=0).to_string())
        else:
            print("\nPiernas por rival y por rol:")
            print(df.pivot_table(index="rival", columns="rol", values="archivo", aggfunc="count", fill_value=0).to_string())

    return 0 if not descartados else 0  # descartar no es un error de uso del script


if __name__ == "__main__":
    sys.exit(main())
