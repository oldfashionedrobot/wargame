import { nextPlayer } from './turns';
import type { GameEvent, GameState } from './types';

/**
 * Nothing beyond the actor check every command gets, which is why this takes
 * no arguments -- ending your own turn is always legal.
 *
 * ⚠️ It survives the action budget rather than being replaced by it. A turn
 * ends itself once its actions are spent, so this is the **early exit**: the
 * one thing Advance Wars' own End command does that an auto-end cannot, which
 * is letting a player stop before committing every unit they are allowed to.
 *
 * ⚠️ It stayed empty. This once predicted that refusing commands after a game
 * ends would land here and in `validateMove` alike; it landed in
 * `validateCommand` instead, once, above the dispatch that reaches both -- so
 * the rule covers commands that do not exist yet, and there is no second site to
 * forget.
 */
export function validateEndTurn(): string | null {
  return null;
}

export function resolveEndTurn(state: GameState): GameEvent[] {
  return [{ type: 'turnEnded', nextPlayer: nextPlayer(state) }];
}
