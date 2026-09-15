import type { GameState, PlayerId } from './types';

/**
 * Who has won, or `null` while more than one player is still standing.
 *
 * Elimination is the only condition so far: a player with no units has lost.
 *
 * ⚠️ **Sole survivor, never "the one who isn't the loser".** With two players
 * those are the same answer and `players.find(p => p.id !== loser)` is the
 * shorter way to write it -- and it is two-player-only, so it would need
 * rewriting the day a third arrives. This predicate is already the N-player one,
 * which is what lets a future `playerEliminated` event be a *companion* to
 * `gameEnded` rather than a rework of it.
 *
 * ⚠️ **An empty board is unreachable, so it answers `null` rather than
 * guessing.** At most one player can be eliminated per resolution, and that
 * falls out of code elsewhere: `wouldCounter` is false at zero health, so a
 * defender that dies never ripostes, so a single battle kills exactly one unit.
 * If that ever stops being true this returns "nobody has won yet", which is the
 * safe wrong answer -- the game continues and the next resolution asks again --
 * rather than crowning whoever `players[0]` happens to be.
 */
export function soleSurvivor(state: GameState): PlayerId | null {
  const standing = state.players.filter((player) =>
    state.units.some((unit) => unit.owner === player.id),
  );
  return standing.length === 1 ? standing[0].id : null;
}

/**
 * ⚠️ **The one question every command asks, so it is asked once.** Both the
 * refusal in `validateCommand` and the client's "can I still play" need it, and
 * two inlined `winner !== null` checks is two spellings of one rule -- the shape
 * this codebase has corrected repeatedly.
 */
export function isOver(state: GameState): boolean {
  return state.winner !== null;
}
