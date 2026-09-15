import { armyWidth, MAX_HEALTH, parseArmyGrid, parseTerrainGrid } from '@vod/shared';
import type { GameState, Player, Unit } from '@vod/shared';
import type { GameMap } from './maps';

// The two players every match is between. Hardcoded until there is a lobby to
// choose them in.
const PLAYERS: Player[] = [
  { id: 'player-blue', name: 'Blue Army', color: 'blue' },
  { id: 'player-red', name: 'Red Army', color: 'red' },
];

/**
 * The one army both sides field, hardcoded beside `PLAYERS` and for the same
 * reason -- nothing chooses between armies yet, and when something does this
 * becomes an argument rather than a rewrite.
 *
 * Artillery anchors both ends, cavalry takes the wings and four infantry hold
 * the centre. That is the period's own deployment, and it happens to put each
 * arm where its movement type wants to be: the guns on the open flanks they
 * need roads to leave, the horse where there is room to ride.
 *
 * ⚠️ **A map may not put water or rock under this.** `wheels` cannot enter
 * river or mountain at any price, so a board that draws either into a
 * deployment square strands a gun where it starts. `maps.test.ts` is what
 * catches it, and it checks every map against this army rather than against
 * placements of its own.
 */
const ARMY: string[] = ['aciiiica'];

/**
 * Instantiates a map into the state a match starts from.
 *
 * ⚠️ Unit ids are `${colour}-${n}`, numbered in **army scan order** -- row,
 * then column. Deterministic on purpose and worth stating rather than leaving
 * to the reader: `initial_state` plus the log has to replay identically, which
 * a generated or random id would break.
 */
export function createMatchState(map: GameMap): GameState {
  const grid = parseTerrainGrid(map.rows);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  // Centred, so an army of eight on a board of ten leaves a column each side.
  const margin = Math.floor((width - armyWidth(ARMY)) / 2);
  const placements = parseArmyGrid(ARMY);

  // ⚠️ Refused rather than clamped. A board narrower or shallower than the army
  // gives a negative margin, which silently deploys units off the edge at
  // negative coordinates -- a state that parses, stores and replays, and is
  // wrong from the first frame. Cheaper to refuse the board.
  if (margin < 0 || ARMY.length * 2 > height) {
    throw new Error(
      `map ${map.id} is ${width}x${height}, too small for an army ${armyWidth(ARMY)} wide ` +
        `and ${ARMY.length} deep on each side`,
    );
  }

  const units = PLAYERS.flatMap((player, owner) =>
    placements.map((placement, index): Unit => {
      const col = margin + placement.at.col;
      const row = placement.at.row;

      return {
        id: `${player.color}-${index + 1}`,
        // ⚠️ A **rotation** about the board's centre, not a translation. Copy
        // the rank to the far side and both armies face the same way down the
        // board with one of them looking at the back of its own guns; turn it,
        // and each player's line is drawn from its own left.
        position: owner === 0 ? { col, row } : { col: width - 1 - col, row: height - 1 - row },
        // ⚠️ Toward the enemy, which is the opposite of what this used to say.
        // Row index increases north and owner 0 starts at row 0, so giving it
        // `south` pointed both armies off their own edge. A rule reads this now:
        // a shot from directly behind goes unanswered, so the sign being wrong
        // would hand every opening counter to whoever moved second -- and it
        // becomes a damage factor as well when charge lands.
        facing: owner === 0 ? 'north' : 'south',
        unitTypeId: placement.unitTypeId,
        owner: player.id,
        health: MAX_HEALTH,
        hasActed: false,
      };
    }),
  );

  return { grid, units, players: PLAYERS, currentTurn: PLAYERS[0].id, winner: null };
}
