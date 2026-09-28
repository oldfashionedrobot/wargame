import { describe, expect, it } from 'bun:test';
import { getMap } from './maps';
import type { GameMap } from './maps';
import { createMatchState, PLAYERS } from './matchState';
import type { Deployment, DeploymentZone } from './matchState';

const classic = getMap('classic');

const board = (rows: string[]): GameMap => ({ id: 'fixture', name: 'Fixture', rows });

// ⚠️ **Every test that pins a *position* supplies its own armies and zone.**
// Both are tuning dials -- the formation has been rewritten twice mid-playtest,
// and the zone becomes map data -- so a suite that reads either is a suite that
// breaks every time the game is tuned. Only the agnostic properties use the
// defaults.
const versus = (blue: string[], red: string[] = blue): Deployment[] => [
  { player: PLAYERS[0], army: blue },
  { player: PLAYERS[1], army: red },
];
const zone = (width: number, depth: number): DeploymentZone => ({ width, depth });

const EIGHT_WIDE = ['iiiiiiii'];
/** Two units, different types, so a rotation shows up as a mirror. */
const ASYMMETRIC = ['ac'];
const TEN_BY_SIX = () => board(Array.from({ length: 6 }, () => '..........'));

describe('createMatchState', () => {
  it('instantiates the map into a board', () => {
    const state = createMatchState(classic);
    expect(state.grid).toHaveLength(classic.rows.length);
    expect(state.grid[0]).toHaveLength(classic.rows[0].length);
    expect(state.currentTurn).toBe('player-blue');
    expect(state.units.every((unit) => !unit.hasActed)).toBe(true);
  });

  it('gives both players a roster under the default deployment', () => {
    const state = createMatchState(classic);
    const perOwner = new Map<string, number>();
    for (const unit of state.units) perOwner.set(unit.owner, (perOwner.get(unit.owner) ?? 0) + 1);

    expect([...perOwner.keys()].sort()).toEqual(['player-blue', 'player-red']);
    // The default happens to be symmetric; that it *may* not be is below.
    expect(new Set(perOwner.values()).size).toBe(1);
  });

  // ⚠️ The point of the whole change: the two sides no longer mirror. Different
  // compositions *and* different counts, because a budget buys unequal numbers
  // of unequal things.
  it('deploys each player their own army', () => {
    const state = createMatchState(TEN_BY_SIX(), versus(['cccc'], ['aaii']), zone(4, 1));
    const typesOf = (owner: string) =>
      state.units
        .filter((unit) => unit.owner === owner)
        .map((unit) => unit.unitTypeId)
        .sort();

    expect(typesOf('player-blue')).toEqual(['cavalry', 'cavalry', 'cavalry', 'cavalry']);
    expect(typesOf('player-red')).toEqual(['artillery', 'artillery', 'infantry', 'infantry']);
  });

  it('lets the two sides field different numbers of units', () => {
    const state = createMatchState(TEN_BY_SIX(), versus(['cc..'], ['aaii']), zone(4, 1));
    const count = (owner: string) => state.units.filter((unit) => unit.owner === owner).length;

    expect(count('player-blue')).toBe(2);
    expect(count('player-red')).toBe(4);
  });

  it('centres the zone and puts each army on its own edge', () => {
    // Ten wide, an eight-wide zone: a column spare each side.
    const state = createMatchState(TEN_BY_SIX(), versus(EIGHT_WIDE), zone(8, 1));
    const blue = state.units.filter((unit) => unit.owner === 'player-blue');
    const red = state.units.filter((unit) => unit.owner === 'player-red');

    expect(blue.map((unit) => unit.position.col).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(blue.map((unit) => unit.position.row))).toEqual(new Set([0]));
    expect(new Set(red.map((unit) => unit.position.row))).toEqual(new Set([5]));
  });

  // ⚠️ **The zone is centred, not the units** -- which is the whole reason an
  // army grid is padded rather than trimmed. Under auto-centring these three
  // deployments were the same four units in the middle of the board.
  it('lets empty squares offset an army within the zone', () => {
    const colsFor = (army: string[]) =>
      createMatchState(TEN_BY_SIX(), versus(army), zone(10, 1))
        .units.filter((unit) => unit.owner === 'player-blue')
        .map((unit) => unit.position.col)
        .sort((a, b) => a - b);

    expect(colsFor(['iiii......'])).toEqual([0, 1, 2, 3]);
    expect(colsFor(['...iiii...'])).toEqual([3, 4, 5, 6]);
    expect(colsFor(['......iiii'])).toEqual([6, 7, 8, 9]);
  });

  // ⚠️ A rotation, not a translation. Copy the zone across and both lines run
  // the same way down the board; turn it, and each player's line is drawn from
  // its own left -- so the two armies mirror through the centre. A two-unit
  // formation of *different* types is the smallest thing that can tell those
  // two apart; a symmetric one passes either way.
  it('rotates the second army rather than copying it', () => {
    const state = createMatchState(TEN_BY_SIX(), versus(ASYMMETRIC), zone(2, 1));
    const typeAt = (col: number, row: number) =>
      state.units.find((unit) => unit.position.col === col && unit.position.row === row)
        ?.unitTypeId;

    // Blue lays 'ac' down from its own left; red's is mirrored through centre.
    expect(typeAt(4, 0)).toBe('artillery');
    expect(typeAt(5, 0)).toBe('cavalry');
    expect(typeAt(5, 5)).toBe('artillery');
    expect(typeAt(4, 5)).toBe('cavalry');
  });

  it('faces each army at the other', () => {
    const state = createMatchState(classic);
    for (const unit of state.units) {
      expect(unit.facing).toBe(unit.owner === 'player-blue' ? 'north' : 'south');
    }
  });

  // Ids have to be reproducible: initial_state plus the log must replay to the
  // same board, and a generated or random id breaks that.
  it('numbers units per owner in army scan order', () => {
    const state = createMatchState(TEN_BY_SIX(), versus(EIGHT_WIDE), zone(8, 1));
    const blue = state.units.filter((unit) => unit.owner === 'player-blue');

    expect(blue.map((unit) => unit.id)).toEqual([
      'blue-1',
      'blue-2',
      'blue-3',
      'blue-4',
      'blue-5',
      'blue-6',
      'blue-7',
      'blue-8',
    ]);
    // Scan order is left to right, so blue-1 is the leftmost of blue's rank.
    expect(blue[0].position.col).toBe(1);
  });

  // ⚠️ Numbering is per player, so an army half the size of its opponent's still
  // starts at 1 -- the ids are not positions in a combined roster.
  it('numbers each player from one, whatever the other fields', () => {
    const state = createMatchState(TEN_BY_SIX(), versus(['cc..'], ['aaii']), zone(4, 1));
    const idsOf = (colour: string) =>
      state.units.filter((unit) => unit.id.startsWith(colour)).map((unit) => unit.id);

    expect(idsOf('blue')).toEqual(['blue-1', 'blue-2']);
    expect(idsOf('red')).toEqual(['red-1', 'red-2', 'red-3', 'red-4']);
  });

  it('gives the same ids every time it runs', () => {
    const ids = () => createMatchState(classic).units.map((unit) => unit.id);
    expect(ids()).toEqual(ids());
  });

  it('refuses a board too small to deploy onto', () => {
    // ⚠️ Refused rather than clamped: a negative margin deploys units at
    // negative columns, which parses, stores and replays perfectly while being
    // wrong from the first frame.
    expect(() =>
      createMatchState(board(['....', '....', '....', '....']), versus(EIGHT_WIDE), zone(8, 1)),
    ).toThrow(/too small for 2 deployment zones/);
  });

  // ⚠️ The error the fixed zone exists to produce. Under auto-centring this was
  // a four-wide rank quietly centred on the board, which is exactly the silent
  // behaviour an explicit offset replaces.
  it('refuses an army that is not the size of the zone', () => {
    expect(() => createMatchState(TEN_BY_SIX(), versus(['iiii']), zone(10, 1))).toThrow(
      /fields an army 4x1, not the 10x1 deployment zone/,
    );
    expect(() => createMatchState(TEN_BY_SIX(), versus(['iiii......']), zone(10, 2))).toThrow(
      /fields an army 10x1, not the 10x2 deployment zone/,
    );
  });

  it('names the player whose army does not fit', () => {
    expect(() =>
      createMatchState(TEN_BY_SIX(), versus(['iiii......'], ['ii']), zone(10, 1)),
    ).toThrow(/player-red fields an army 2x1/);
  });
});
