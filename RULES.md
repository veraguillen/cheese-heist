# Midnight Kitchen: Rules

A cat hunts, a mouse goes after the cheese, and each game lasts 400 turns.

You write **one bot that plays both roles**. Every match is two legs on the same house:
your cat against their mouse, then their cat against your mouse. Your match score is
your cat points plus your mouse points.

Use whatever tools you like, AI included. Be ready to explain every line you submit
and to change it live in the interview.

This page tells you what the game is and exactly how to talk to it. It does not give
you every number. How far a cat sees, how fast scent fades, how far the bell carries:
that you find out by playing, and it is not the same in every house.

## The house

A grid, randomly generated for every match. Your bot gets the full floor plan at the start.

**No two houses are alike.** Some are small cottages, some are mansions with few mouse holes,
some are ranches full of them, some are pantries with tables everywhere. The size of the house
and the number of holes and tables change with it.

**The numbers change too**: how far each animal sees, how long scent lasts, how far the bell
carries, how much stamina the cat has and what a sprint costs, how heavy cheese is, how fast
tunnels are, how soon new cheese appears. Your bot is not told any of them. A number you read
off one replay will not hold in the next house, so a good bot works them out during the game,
from what it sees.

| Tile | Meaning |
|------|---------|
| `#` | Wall. Blocks movement and sight. |
| `.` | Floor. |
| `T` | Table. Walkable. A mouse under a table is hard to spot. |
| `H` | Mouse hole. Mouse only. The mouse is safe inside. Holes are numbered (`map.holes[i]`). |

## Turns

Both bots act at the same time, every turn. Each `act` call has **50 ms**, `createBot` has 500 ms.
A timeout or an exception means you `STAY` that turn.

Your bot also has **5 seconds for all its turns in one game** (`setup.rules.gameTimeMs`). That is plenty: a good bot needs
a few milliseconds a turn. If it runs out, it stays put for the rest of that game and your replay tells you so.

### Cat
- Moves 1 tile (`N`, `S`, `E`, `W`) or `STAY`.
- **Sprint**: `{ move: 'E', sprint: true }` moves 2 tiles in a straight line and costs stamina.
  Stamina comes back slowly when you are not sprinting.
- **Vision**: sees in front of itself (the direction of its last move) and right around itself.
  Walls and holes block sight. `{ move: 'STAY', look: 'W' }` turns without moving.
- **Smell**: the mouse leaves scent where it walks. Scent fades over time. The cat smells nearby tiles.
- Cannot enter holes.

### Mouse
- Moves 1 tile or `STAY`. Sees all around, not very far.
- Hears the cat's collar **bell**: a rough distance to the cat when it is close enough.
  A sprinting cat jingles louder.
- Picks up cheese by stepping on it (carries one). Delivers it by entering any hole.
- **Cheese is heavy**: while carrying, some turns the mouse cannot move (`you.heavy` tells you).
- **Drop it**: `{ move: 'STAY', drop: true }` puts the cheese down on your tile, and you are light again.
  It takes your whole turn, and the cat hears it. The cheese stays there for anyone to see. To pick it up
  again you have to step off the tile and back on. You cannot drop it inside a hole.
- **Tunnels**: from inside a hole, `{ move: 'STAY', tunnel: 2 }` travels inside the walls to
  hole 2. The trip takes a few turns, longer for farther holes. Nobody can see or touch you meanwhile.

### Catching
The cat catches the mouse if, during the turn, they end on the same tile or swap tiles.
A sprint checks both tiles it crosses. Then the carried cheese is lost and the mouse
respawns in a hole.

## Scoring

| Event | Points |
|-------|--------|
| Cat catches the mouse | cat +3 |
| Mouse delivers cheese | mouse +3 |
| Every 15 turns the mouse spends in holes or tunnels (total) | cat +1 |

Every house has its own number of cheeses, and it stays the same for the whole game: new cheese appears a few turns after one is delivered or lost.

## Your bot

One `.js` file, no imports, no network, no file system. Define `createBot`:

```js
function createBot(setup) {
  let memory = {}; // survives between turns of this leg

  return function act(obs) {
    return { move: 'N' }; // or just 'N'
  };
}
```

`createBot` is called once per leg with the setup. The `act` it returns is called every turn with
the cat or mouse observation, depending on your role, and returns an action. All of them are under Types.

`Math.random()` is seeded, so a replay always reproduces. `console.log` output shows in
your replays (20 lines per turn).

**Let your bot think out loud.** The replay always shows what your bot did. Only you can make it
show why. Return a `debug` note with your action ("going for the cheese at 12,4") and it appears next
to that turn. Return `debugTiles` and those squares light up on the board: where you think the
other animal is, the route you picked, anything. It's optional, it never changes the game, and only
you see it.

## Types

Every shape below is written out in full. `x?: number` means `x` may be missing.
`A | B` means one or the other. A field that can be `null` is always there, but can be empty.
`starter.js` has the same types as JSDoc, so your editor can autocomplete them.

### Coordinates and directions

```
x is the column, y is the row. (0, 0) is the top-left corner.
N is y - 1, S is y + 1, E is x + 1, W is x - 1.

Dir  = 'N' | 'S' | 'E' | 'W'
Tile = [x, y]                  // an array of two numbers, e.g. [4, 7]
```

### Setup (what `createBot` receives)

```
{
  role: 'cat' | 'mouse',
  map: {
    width:  number,
    height: number,
    rows:   string[],          // '#' wall, '.' floor, 'T' table, 'H' mouse hole. The tile at (x, y) is rows[y][x].
    holes: [                   // the position in this array is the hole number used by `tunnel` and `inHole`
      {
        x: number,
        y: number,
        entrance: { x: number, y: number },   // the one floor tile next to the hole, the only way in or out
      },
    ],
  },
  rules: {                     // the only numbers your bot is told
    maxTurns:       number,    // turns in a game
    catchPoints:    number,    // points for a catch
    cheesePoints:   number,    // points for a delivery
    hidingTaxEvery: number,    // turns in holes or tunnels per point for the cat
    botTimeMs:      number,    // per act call
    gameTimeMs:     number,    // all act calls of one game together
    initTimeMs:     number,    // for createBot
    debugMaxChars:  number,
    debugMaxTiles:  number,
  },
}
```

### Cat observation (what `act` receives when you are the cat)

```
{
  turn:     number,            // 1 on the first turn, maxTurns on the last
  maxTurns: number,
  role:     'cat',
  score:    { cat: number, mouse: number },
  you: {
    x: number,
    y: number,
    facing:  Dir,              // you start facing N
    stamina: number,           // you start full
  },
  mouse: {                     // null unless you can see it
    x: number,
    y: number,
    carrying: boolean,
  } | null,
  visible: Tile[],             // every tile you can see this turn
  scent:   [x, y, strength][], // nearby tiles that smell of mouse; strength 0..1, 1 = the mouse was just here
  cheese:  Tile[],             // every cheese on the floor, seen or not
  events:  Event[],            // what happened on the previous turn (see Events)
}
```

### Mouse observation (what `act` receives when you are the mouse)

```
{
  turn:     number,
  maxTurns: number,
  role:     'mouse',
  score:    { cat: number, mouse: number },
  you: {
    x: number,
    y: number,
    carrying:  boolean,
    inHole:    number | null,                        // hole number, or null when you are not in a hole
    tunneling: { to: number, turnsLeft: number } | null,
    heavy:     boolean,        // true = a move this turn does nothing (only when carrying)
  },
  cat: {                       // null unless you can see it
    x: number,
    y: number,
    facing:  Dir,
    stamina: number,
  } | null,
  bell:     number | null,     // rough straight-line distance to the cat in tiles, one decimal;
                               // null when it is too far to hear or you are in a tunnel
  bellLoud: boolean,           // true when the cat sprinted last turn and you heard it
  visible:  Tile[],            // empty while you are in a tunnel
  cheese:   Tile[],            // every cheese on the floor, seen or not
  events:   Event[],           // what happened on the previous turn (see Events)
}
```

### Events

Every event is an object with a `type`. Both bots get the same events.

```
Event =
  | { type: 'caught',    x: number, y: number, respawnHole: number }
  | { type: 'pickup',    x: number, y: number }
  | { type: 'dropped',   x: number, y: number }
  | { type: 'delivered', hole: number }
  | { type: 'cheeseSpawned' }
  | { type: 'hidingTax' }
```

### Action (what `act` returns)

Either a plain string:

```
'N' | 'S' | 'E' | 'W' | 'STAY'
```

or an object:

```
{
  move:        'N' | 'S' | 'E' | 'W' | 'STAY',
  sprint?:     boolean,        // cat: move 2 tiles; without enough stamina you move 1
  look?:       Dir,            // cat: face this way (works with any move)
  tunnel?:     number,         // mouse, inside a hole: travel to this hole number
  drop?:       boolean,        // mouse, carrying, not in a hole: put the cheese down (uses your turn)
  debug?:      string,         // shown in your replay next to this turn (up to debugMaxChars)
  debugTiles?: [x, y, weight][],   // drawn on the board (up to debugMaxTiles)
}
```

Anything else counts as `STAY`.

## Playing

- **Submit** your bot on the site as one `.js` file, with a one-line changelog (what you changed and why) and the AI model
  you used, if any. The model is shown next to your name on the leaderboard.
  Upload as often as you like. We keep every file you send, including the ones that fail the check.
  Before your first upload we ask for your name, email and LinkedIn profile. Only the Meowtel team sees them.
- **The last upload is on November 30 at 23:59:59, Argentina time (UTC−3).** Anything sent after that is refused.
  Right after, one final round plays with everyone's latest bot, and that leaderboard is final.
- **We run a quick check** when you submit: a few turns in each role. If your bot crashes or times out, you see the error
  straight away. If it passes, it plays from the next round.
- **We read the bots that do well**, and we can read any bot at any time. One that breaks the rules is removed.
- There are no practice matches. Every match counts, against the house bot **Timothy** and everyone else.
  Every 5 minutes there is a round: your latest bot plays each other bot once. Beat Timothy.
- **The leaderboard is ranked by Elo**, and shows your wins, draws and losses in the last round. Everyone starts at 1200. After each match, beating a stronger bot gains you more,
  and losing to a weaker one costs you more. A new version of your bot keeps your Elo and replaces your old one on the leaderboard.
- **Sign in with GitHub** to watch your replays: always your latest match against every other bot, and never fewer than your latest 50. Older replays are removed as new matches come in. You see your own debug output, not your opponent's.
- **Download the turn log** from any replay: one line per turn with positions, both bots' moves, events, and everything your bot printed (`debug`, `console.log`, errors). Read it, or hand it to your AI.
