import { armyWidth, MAX_HEALTH, parseArmyGrid, parseTerrainGrid } from '@wargame/shared';
import type { GameState, Player, Unit } from '@wargame/shared';
import type { GameMap } from './maps';

// The two players every match is between. Hardcoded until there is a lobby to
// choose them in. ⚠️ Exported for the suite, which pairs these with armies of
// its own -- the default list below is the only thing production reads.
export const PLAYERS: Player[] = [
  { id: 'player-blue', name: 'Blue Army', color: 'blue' },
  { id: 'player-red', name: 'Red Army', color: 'red' },
];

/**
 * Where a player's units may be placed: a rectangle on their own edge of the
 * board, centred on its width.
 *
 * ⚠️ **An army grid is exactly this size, not merely bounded by it.** Padding
 * with empties is what makes an *offset* deployment expressible: under
 * auto-centring `['iiii......']` and `['...iiii...']` are the same four units
 * in the middle, and against a zone they are a left flank and a centre. The
 * price is that a short grid is an error rather than a centred rank, which is
 * the trade wanted -- a deployment that does not say where it stands is the
 * thing being removed.
 *
 * ⚠️ **The margin is therefore a property of the zone and not of the army.**
 * Nothing about centring varies with what is fielded any more, which is why
 * `armyWidth` is read here as a *check* rather than as an input to the sum.
 */
export interface DeploymentZone {
  width: number;
  depth: number;
}

/**
 * ⚠️ **Assumed, not declared by the map -- for now.** Every board is 12x12 and
 * `maps.test.ts` asserts it, so the two rows nearest each edge can simply be
 * taken. The day a map carries its own zone, this constant is what it replaces,
 * and an existing convention becomes checkable with it: *a river may only leave
 * the board where the army does not stand* is kept by hand today.
 *
 * ⚠️ **Reachable as an argument**, the same shape `ACTIONS_PER_TURN` has and for
 * the same reason: the suite deploys onto boards this game never ships, so
 * moving this line must not move the suite.
 */
export const DEPLOYMENT_ZONE: DeploymentZone = { width: 10, depth: 2 };

/**
 * The default army both sides field, hardcoded beside `PLAYERS` and for the
 * same reason: nothing *chooses* an army yet. It is a default rather than a
 * constant -- `createMatchState` takes the deployments as an argument, which is
 * the seam player-chosen composition arrives through, and which keeps the suite
 * from pinning whatever this happens to say today.
 *
 * Cavalry on the ends, infantry behind, the two guns together in the centre.
 * ⚠️ **A tuning dial rather than a doctrine** -- it has already been rewritten
 * twice mid-playtest, and it is the thing most likely to move again.
 *
 * ⚠️ **A map may not put water or rock under the zone.** `wheels` cannot enter
 * river or mountain at any price, so a board that draws either into a
 * deployment square strands a gun wherever a player puts one. `maps.test.ts` is
 * what catches it, and it now checks the *zone* rather than this army -- which
 * is the stronger property, because the zone is what a player may fill.
 */
const ARMY: string[] = ['caac......', 'iiii......'];

/** One player, and the army they field. */
export interface Deployment {
  player: Player;
  army: string[];
}

const DEFAULT_DEPLOYMENTS: Deployment[] = PLAYERS.map((player) => ({ player, army: ARMY }));

/**
 * Instantiates a map into the state a match starts from.
 *
 * ⚠️ **The army binds to the player; the seat stays positional.** Pairing the
 * two is what stops a second array having to agree with `PLAYERS` by index --
 * but the *edge* is still read off the order: first deploys on the near edge
 * looking north, second on the far edge looking south. List order is seating
 * order, which is worth stating rather than leaving to be inferred.
 *
 * ⚠️ Unit ids are `${colour}-${n}`, numbered in **army scan order** -- row,
 * then column, within that player's own army. Deterministic on purpose:
 * `initial_state` plus the log has to replay identically, which a generated or
 * random id would break.
 */
export function createMatchState(
  map: GameMap,
  deployments: Deployment[] = DEFAULT_DEPLOYMENTS,
  zone: DeploymentZone = DEPLOYMENT_ZONE,
): GameState {
  const grid = parseTerrainGrid(map.rows);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  const margin = Math.floor((width - zone.width) / 2);

  // ⚠️ Refused rather than clamped. A board narrower than the zone gives a
  // negative margin, which silently deploys units at negative columns -- a
  // state that parses, stores and replays, and is wrong from the first frame.
  // The depth check sums the zones rather than doubling one, so it still says
  // the right thing if a third seat is ever dealt in.
  if (margin < 0 || zone.depth * deployments.length > height) {
    throw new Error(
      `map ${map.id} is ${width}x${height}, too small for ${deployments.length} deployment ` +
        `zones ${zone.width} wide and ${zone.depth} deep`,
    );
  }

  // ⚠️ Checked before parsing, because `parseArmyGrid` speaks about *rows*
  // agreeing with each other and this is about them agreeing with the zone. A
  // grid narrower than the zone is the case that used to be silently centred.
  for (const { player, army } of deployments) {
    if (army.length !== zone.depth || armyWidth(army) !== zone.width) {
      throw new Error(
        `${player.id} fields an army ${armyWidth(army)}x${army.length}, ` +
          `not the ${zone.width}x${zone.depth} deployment zone`,
      );
    }
  }

  const units = deployments.flatMap(({ player, army }, seat) =>
    parseArmyGrid(army).map((placement, index): Unit => {
      const col = margin + placement.at.col;
      const row = placement.at.row;

      return {
        id: `${player.color}-${index + 1}`,
        // ⚠️ A **rotation** about the board's centre, not a translation. Copy
        // the zone to the far side and both armies face the same way down the
        // board with one of them looking at the back of its own guns; turn it,
        // and each player's line is drawn from its own left.
        position: seat === 0 ? { col, row } : { col: width - 1 - col, row: height - 1 - row },
        // ⚠️ Toward the enemy, which is the opposite of what this used to say.
        // Row index increases north and seat 0 starts at row 0, so giving it
        // `south` pointed both armies off their own edge. A rule reads this: a
        // shot from directly behind goes unanswered, so the sign being wrong
        // would hand every opening counter to whoever moved second.
        facing: seat === 0 ? 'north' : 'south',
        unitTypeId: placement.unitTypeId,
        owner: player.id,
        health: MAX_HEALTH,
        hasActed: false,
      };
    }),
  );

  const players = deployments.map(({ player }) => player);
  return { grid, units, players, currentTurn: players[0].id, winner: null };
}
