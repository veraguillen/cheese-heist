# Cheese Heist — a Midnight Kitchen bot

A cat-and-mouse bot for [Meowtel's Midnight Kitchen](https://meow.tel) challenge, written in plain JavaScript (one file, no imports). One bot plays both roles: the cat hunts, the mouse steals cheese.

I built it as an **experiment loop**: every version has one explicit hypothesis, one conceptual change, and a decision based on data from real matches.

## How I work

1. **Hypothesis:** "If I change X, I expect Y to improve, because Z."
2. **One change per version**, so I can measure its effect without mixing causes.
3. **Instrumentation:** the bot logs one compact `D|` JSON line per turn (see [LOGS.md](LOGS.md)).
4. **Analysis:** I download the turn logs from meow.tel and analyze them in Python (pandas).
5. **Decision:** keep, adjust or revert, using criteria written *before* seeing the results.

Timothy, the house bot, is my control group. I don't draw conclusions from fewer than 10 matches.

## Architecture

| Layer | What it does |
|---|---|
| Precompute (`createBot`) | Builds the walkable graph once: floor tiles for the cat; floor plus holes (as leaf nodes) for the mouse. |
| Decision | A fixed-priority state machine per role. The first rule that matches wins. |
| Movement | One BFS step toward the goal of the current mode. Fixed tie-break: N, S, E, W. |
| Logging | One `D|` line per turn, plus `debug` notes and `debugTiles` (the chosen route) in the replays. |

**Mouse modes:** `TUNEL`, `VOLVER` (return with cheese), `IR_AL_QUESO` (go to cheese), `ESCONDIDO` (hide), `ALEJARSE` (back off, v2).
**Cat modes:** `PERSEGUIR` (chase), `SEGUIR_OLOR` (follow scent), `VIGILAR_QUESO` (guard cheese).

## Versions

| Version | Hypothesis | Change | Result |
|---|---|---|---|
| v0 | — | Unchanged starter (stays still). | Not uploaded: the result (0 points) was predictable from the rules. |
| v1 | Moving with BFS toward clear goals turns a bot that doesn't play into one that scores. | BFS movement + fixed mode priority in both roles. | Lost the first 7 matches. Against Timothy, **83% of his points came from catching my mouse** (47 captures, 23.5 per game). |
| v2 | If the mouse avoids tiles within 2 steps of a visible cat, captures drop by at least half. | Mouse avoids the cat's danger zone; backs off when no safe path exists. Compact logs. | In progress. |

**Why v2:** before writing any code, I checked the v1 logs. In **44 of 47 captures (94%)**, the mouse had already seen the cat in the previous 3 turns, usually 3 or more tiles away. The mouse had the information and the space to react; v1 simply ignored it.

Full details for each version: [CHANGELOG.md](CHANGELOG.md), [DISENO_V1.md](DISENO_V1.md), [DISENO_V2.md](DISENO_V2.md) (in Spanish).

## Things I learned from the data

- The game cuts each `console.log` at about 300 characters. My v1 log lines (~390) were truncated, so in v2 I redesigned them with short keys (~180 characters). The legend is in [LOGS.md](LOGS.md).
- The bell (rough distance to the cat) was heard up to about 10–14 tiles away and correlates with the real distance (r ≈ 0.77).
- A loud bell matched a cat sprint the previous turn in 56 of 56 cases.

## Repository

```
bot.js                  the bot (the file uploaded to meow.tel)
scripts/pre-ship.mjs    local check before every upload: no imports, valid actions, time limits
scripts/log-version.mjs adds a version entry to CHANGELOG.md
analysis/leer_logs.py   reads meow.tel turn logs and the bot's D| lines (pandas)
data/vN/                turn logs per version, named <rival>_m<N>_<role>
DISENO_V*.md            design spec for each version
LOGS.md                 legend of the D| log format
CHANGELOG.md            hypothesis, change, decisions and results per version
```

Before every upload:

```bash
node scripts/pre-ship.mjs bot.js
```

## Use of AI

I used Claude (Sonnet 5.5 and Opus 5.5 in Claude Code, plus a Claude project as a technical sparring partner).

- **I made the strategy and design decisions**: what to change, the danger radius, the fallback rules, the decision criteria. The AI presented options and trade-offs.
- **The AI wrote most of the code** from my specs, and also proposed some details (for example, tie-break rules). Each AI suggestion is listed in the CHANGELOG under "Sugirió la IA".
- **I review every version**, run the checks, and make sure I can explain and change every line.