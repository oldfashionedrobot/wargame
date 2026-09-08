import { describe, expect, it } from 'bun:test';
import { getMap } from './maps';
import type { GameMap } from './maps';
import { createMatchState } from './matchState';

const classic = getMap('classic');

const mapOf = (units: GameMap['units']): GameMap => ({
  id: 'fixture',
  name: 'Fixture',
  rows: ['....', '....', '....', '....'],
  units,
});

describe('createMatchState', () => {
  it('instantiates the map into a board', () => {
    const state = createMatchState(classic);
    expect(state.grid).toHaveLength(classic.rows.length);
    expect(state.grid[0]).toHaveLength(classic.rows[0].length);
    expect(state.units).toHaveLength(classic.units.length);
    expect(state.currentTurn).toBe('player-blue');
    expect(state.units.every((unit) => !unit.hasActed)).toBe(true);
  });

  it('resolves each owner index to a player', () => {
    const state = createMatchState(classic);
    const owners = new Set(state.units.map((unit) => unit.owner));
    expect(owners).toEqual(new Set(['player-blue', 'player-red']));
  });

  // Ids have to be reproducible: initial_state plus the log must replay to the
  // same board, and a generated or random id breaks that. Numbering is per
  // owner, in the order the map lists them.
  it('numbers units per owner in map order', () => {
    const state = createMatchState(
      mapOf([
        { at: { col: 0, row: 0 }, type: 'infantry', owner: 0 },
        { at: { col: 3, row: 3 }, type: 'cavalry', owner: 1 },
        { at: { col: 1, row: 0 }, type: 'artillery', owner: 0 },
      ]),
    );
    expect(state.units.map((unit) => unit.id)).toEqual(['blue-1', 'red-1', 'blue-2']);
  });

  it('gives the same ids every time it runs', () => {
    const ids = () => createMatchState(classic).units.map((unit) => unit.id);
    expect(ids()).toEqual(ids());
  });

  it('keeps the unit type the map asked for', () => {
    const state = createMatchState(
      mapOf([{ at: { col: 0, row: 0 }, type: 'artillery', owner: 0 }]),
    );
    expect(state.units[0].unitTypeId).toBe('artillery');
  });

  it('refuses a map that places a unit for a player who does not exist', () => {
    const rogue = mapOf([{ at: { col: 0, row: 0 }, type: 'infantry', owner: 7 }]);
    expect(() => createMatchState(rogue)).toThrow(/unknown player 7/);
  });
});
