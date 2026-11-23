# Midnight Kitchen bot

Bot en JavaScript para el desafío Midnight Kitchen de Meowtel. Un solo archivo (`bot.js`) que juega como gato y como ratón.

> Borrador: se completa durante la semana. La versión final se escribe el día 6.

## Estrategia

### Ratón
_(por completar)_

### Gato
_(por completar)_

### Números ocultos
_(cómo estima el bot la visión, el olor, el cascabel y el peso del queso en cada casa)_

## Cómo trabajé
- Un cambio conceptual por versión, con una hipótesis explícita (ver `CHANGELOG.md`).
- El bot registra cada decisión (`D|` en el log). Analicé los turn logs con Python/pandas (`analysis/`).
- Timothy, el bot de la casa, fue mi grupo de control para comparar versiones.
- Antes de cada subida: `node scripts/pre-ship.mjs bot.js`.

## Uso de IA
_(qué modelo usé, para qué, qué decidí yo y qué sugerencias descarté)_

## Qué funcionó y qué no
_(por completar)_

## Si tuviera más tiempo
_(por completar)_

## Estructura
```
bot.js                  el bot que se sube
scripts/pre-ship.mjs    revisión antes de subir
scripts/log-version.mjs agrega una versión a CHANGELOG.md
analysis/leer_logs.py   turn logs → DataFrame
data/vX/                turn logs descargados por versión
```
