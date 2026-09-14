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
 * It will grow some: phase 9j wants every command refused once a game has a
 * terminal marker, and that rule lands here and in validateMove alike.
 */
export function validateEndTurn(): string | null {
  return null;
}

export function resolveEndTurn(state: GameState): GameEvent[] {
  return [{ type: 'turnEnded', nextPlayer: nextPlayer(state) }];
}
