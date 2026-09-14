import type { GameState, PlayerId } from './types';

/**
 * How many of their units a player may command before the turn passes.
 *
 * ⚠️ **The dial this exists for.** At 1 the game is chess: one unit, one
 * command, over to you. At the size of a roster it is Advance Wars, where every
 * unit acts once and the player decides the order. Everything between is
 * reachable by editing this line, which is the point -- the right value is a
 * thing to find by playing rather than to argue about in advance.
 *
 * ⚠️ It is not a per-unit budget. A unit still acts at most once a turn, which
 * `hasActed` records; this caps how many of them may do so.
 *
 * ⚠️ Taken as a **default argument** below rather than read straight out of the
 * module, so the rules around it stay reachable from a test at any value. Baked
 * in, the only budget anything could exercise would be whichever one this line
 * happened to hold -- and the case that matters most, a roster shorter than the
 * budget, is invisible at 1.
 */
export const ACTIONS_PER_TURN = 1;

function ownUnits(state: GameState) {
  return state.units.filter((unit) => unit.owner === state.currentTurn);
}

/** How many of this turn's actions have been spent. */
export function actionsTaken(state: GameState): number {
  return ownUnits(state).filter((unit) => unit.hasActed).length;
}

/**
 * How many this player gets, which is the budget or their roster, whichever
 * runs out first.
 *
 * ⚠️ The `min` is the half that is easy to leave out and fatal to. A player
 * with fewer units than the budget could never reach it, so their turn would
 * never end on its own -- "everyone has acted" has to finish a turn as surely
 * as "the budget is gone", and both are this one line.
 */
export function actionsAllowed(state: GameState, budget = ACTIONS_PER_TURN): number {
  return Math.min(budget, ownUnits(state).length);
}

/**
 * Whether one more action finishes the current player's turn.
 *
 * ⚠️ **No fold is needed to answer this.** An action sets `hasActed` on exactly
 * one unit that did not have it, so the count afterwards is the count now plus
 * one -- resolution can decide without applying its own events to a copy of the
 * state first.
 */
export function actionEndsTurn(state: GameState, budget = ACTIONS_PER_TURN): boolean {
  return actionsTaken(state) + 1 >= actionsAllowed(state, budget);
}

/**
 * Array rotation over `GameState.players`, wrapping via modulo -- works for two
 * players or four, and is where a "skip eliminated players" rule would go.
 *
 * If `currentTurn` is somehow absent from `players`, `findIndex` gives -1 and
 * this returns `players[0]` rather than throwing -- unlike `getCurrentPlayer`,
 * which treats the same corruption as fatal. Unreachable today; noted because
 * the two disagree and the silent one is the wrong default.
 */
export function nextPlayer(state: GameState): PlayerId {
  const current = state.players.findIndex((player) => player.id === state.currentTurn);
  return state.players[(current + 1) % state.players.length].id;
}
