// Midnight Kitchen starter bot.
//
// One file, plain JavaScript, no imports. createBot(setup) is called once per
// leg with your role ('cat' or 'mouse') and must return act(obs), which is
// called every turn and returns your action. Anything kept in the closure
// survives between turns of the same leg.
//
// This bot does nothing: it stays put. It passes the upload check, and that is
// all. Everything else is up to you. The full rules are on the Rules page.

// ------------------------------------------------------------------ types
// JSDoc, so your editor can autocomplete. The Rules page has the same shapes
// written out in full, which is easier to read. Each type is defined before
// anything uses it, so you can read this from top to bottom.

/** x is the column, y is the row. (0, 0) is the top-left corner. N is y - 1, S is y + 1, E is x + 1, W is x - 1. */
/** @typedef {'N' | 'S' | 'E' | 'W'} Dir */
/** @typedef {[x: number, y: number]} Tile */

// ---- setup: what createBot receives

/**
 * A mouse hole. Its position in map.holes is the hole number used by `tunnel` and `inHole`.
 * @typedef {Object} Hole
 * @property {number} x
 * @property {number} y
 * @property {{ x: number, y: number }} entrance   the one floor tile next to the hole, the only way in or out
 */

/**
 * @typedef {Object} GameMap
 * @property {number} width
 * @property {number} height
 * @property {string[]} rows    '#' wall, '.' floor, 'T' table, 'H' mouse hole. The tile at (x, y) is rows[y][x].
 * @property {Hole[]} holes
 */

/**
 * The only numbers your bot is told.
 * @typedef {Object} PublicRules
 * @property {number} maxTurns         turns in a game
 * @property {number} catchPoints      points for a catch
 * @property {number} cheesePoints     points for a delivery
 * @property {number} hidingTaxEvery   turns in holes or tunnels per point for the cat
 * @property {number} botTimeMs        per act call
 * @property {number} gameTimeMs       all act calls of one game together
 * @property {number} initTimeMs       for createBot
 * @property {number} debugMaxChars
 * @property {number} debugMaxTiles
 */

/**
 * @typedef {Object} Setup
 * @property {'cat' | 'mouse'} role
 * @property {GameMap} map
 * @property {PublicRules} rules
 */

// ---- events: what happened on the previous turn

/**
 * Every event has a `type`. Both bots get the same events.
 * @typedef {{ type: 'caught', x: number, y: number, respawnHole: number }
 *         | { type: 'pickup', x: number, y: number }
 *         | { type: 'dropped', x: number, y: number }
 *         | { type: 'delivered', hole: number }
 *         | { type: 'cheeseSpawned' }
 *         | { type: 'hidingTax' }} GameEvent
 */

// ---- cat observation: what act receives when you are the cat

/** @typedef {[x: number, y: number, strength: number]} ScentTile   strength 0..1, 1 = the mouse was just here */

/**
 * @typedef {Object} CatObservation
 * @property {number} turn                  1 on the first turn, maxTurns on the last
 * @property {number} maxTurns
 * @property {'cat'} role
 * @property {{ cat: number, mouse: number }} score
 * @property {{ x: number, y: number, facing: Dir, stamina: number }} you   you start facing N with full stamina
 * @property {{ x: number, y: number, carrying: boolean } | null} mouse      null unless you can see it
 * @property {Tile[]} visible               every tile you can see this turn
 * @property {ScentTile[]} scent            nearby tiles that smell of mouse
 * @property {Tile[]} cheese                every cheese on the floor, seen or not
 * @property {GameEvent[]} events
 */

// ---- mouse observation: what act receives when you are the mouse

/**
 * @typedef {Object} MouseSelf
 * @property {number} x
 * @property {number} y
 * @property {boolean} carrying
 * @property {number | null} inHole                          hole number, or null when you are not in a hole
 * @property {{ to: number, turnsLeft: number } | null} tunneling
 * @property {boolean} heavy                                 true = a move this turn does nothing (only when carrying)
 */

/**
 * @typedef {Object} MouseObservation
 * @property {number} turn
 * @property {number} maxTurns
 * @property {'mouse'} role
 * @property {{ cat: number, mouse: number }} score
 * @property {MouseSelf} you
 * @property {{ x: number, y: number, facing: Dir, stamina: number } | null} cat   null unless you can see it
 * @property {number | null} bell           rough straight-line distance to the cat in tiles, one decimal; null when it is too far to hear or you are in a tunnel
 * @property {boolean} bellLoud             true when the cat sprinted last turn and you heard it
 * @property {Tile[]} visible               empty while you are in a tunnel
 * @property {Tile[]} cheese                every cheese on the floor, seen or not
 * @property {GameEvent[]} events
 */

// ---- action: what act returns

/**
 * The object form of an action. Every field except `move` is optional.
 * @typedef {Object} ActionObject
 * @property {Dir | 'STAY'} move
 * @property {boolean} [sprint]      cat: move 2 tiles; without enough stamina you move 1
 * @property {Dir} [look]            cat: face this way (works with any move)
 * @property {number} [tunnel]       mouse, inside a hole: travel to this hole number
 * @property {boolean} [drop]        mouse, carrying, not in a hole: put the cheese down (uses your turn)
 * @property {string} [debug]        shown in your replay next to this turn (up to debugMaxChars)
 * @property {Array<[x: number, y: number, weight: number]>} [debugTiles]   drawn on the board (up to debugMaxTiles)
 */

/**
 * A plain string ('N', 'S', 'E', 'W' or 'STAY') or an ActionObject. Anything else counts as STAY.
 * @typedef {Dir | 'STAY' | ActionObject} Action
 */

// -------------------------------------------------------------------- bot

/**
 * @param {Setup} setup
 * @returns {(obs: CatObservation | MouseObservation) => Action}
 */
function createBot(setup) {
  const { role, map } = setup;

  if (role === 'cat') {
    // Memory for this leg goes here.

    /** @param {CatObservation} obs @returns {Action} */
    return function act(obs) {
      return { move: 'STAY', debug: `turn ${obs.turn}: the cat waits` };
    };
  }

  // Memory for this leg goes here.

  /** @param {MouseObservation} obs @returns {Action} */
  return function act(obs) {
    return { move: 'STAY', debug: `turn ${obs.turn}: the mouse waits` };
  };
}
