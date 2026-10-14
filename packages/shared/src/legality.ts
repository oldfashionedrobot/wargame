import { isOver } from './victory';
import type { GameState, Unit } from './types';

/**
 * May this unit act at all right now -- ownership and whether it is spent.
 *
 * Deliberately *not* "may it move there": that is `validatePath`'s question,
 * and keeping the two apart is what lets the client preview selection with
 * this same predicate while the server walks the route with the other.
 */
export function canSelectUnit(state: GameState, unit: Unit): boolean {
  return unit.owner === state.currentTurn && !unit.hasActed;
}

/**
 * Has this unit of the player to move already acted, while the game is on --
 * what the board greys. Read through `canSelectUnit`, so the mark and the
 * click cannot disagree.
 *
 * ⚠️ **`hasActed` alone is the wrong test.** `turnEnded` refreshes only the
 * incoming player's units, so through the opponent's turn every unit of the
 * player who just moved still reads `true`.
 */
export function isSpent(state: GameState, unit: Unit): boolean {
  return !isOver(state) && unit.owner === state.currentTurn && !canSelectUnit(state, unit);
}
