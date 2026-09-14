import { describe, expect, it } from 'bun:test';
import { getMap } from './maps';
import type { GameMap } from './maps';
import { createMatchState } from './matchState';

const classic = getMap('classic');

const board = (rows: string[]): GameMap => ({ id: 'fixture', name: 'Fixture', rows });

describe('createMatchState', () => {
  it('instantiates the map into a board', () => {
    const state = createMatchState(classic);
    expect(state.grid).toHaveLength(classic.rows.length);
    expect(state.grid[0]).toHaveLength(classic.rows[0].length);
    expect(state.currentTurn).toBe('player-blue');
    expect(state.units.every((unit) => !unit.hasActed)).toBe(true);
  });

  it('deploys the same army for both players', () => {
    const state = createMatchState(classic);
    const perOwner = new Map<string, number>();
    for (const unit of state.units) perOwner.set(unit.owner, (perOwner.get(unit.owner) ?? 0) + 1);

    expect([...perOwner.keys()].sort()).toEqual(['player-blue', 'player-red']);
    expect(new Set(perOwner.values()).size).toBe(1);
  });

  it('centres the rank and puts each army on its own edge', () => {
    // Ten wide, eight in the rank: a column spare each side.
    const state = createMatchState(board(Array.from({ length: 6 }, () => '..........')));
    const blue = state.units.filter((unit) => unit.owner === 'player-blue');
    const red = state.units.filter((unit) => unit.owner === 'player-red');

    expect(blue.map((unit) => unit.position.col).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(blue.map((unit) => unit.position.row))).toEqual(new Set([0]));
    expect(new Set(red.map((unit) => unit.position.row))).toEqual(new Set([5]));
  });

  it('rotates the second army rather than copying it', () => {
    // ⚠️ A rotation, not a translation. Copy the rank across and both lines run
    // the same way down the board; turn it, and each player's line is drawn
    // from its own left -- so the two armies mirror through the centre.
    const state = createMatchState(board(Array.from({ length: 6 }, () => '..........')));
    const typeAt = (col: number, row: number) =>
      state.units.find((unit) => unit.position.col === col && unit.position.row === row)
        ?.unitTypeId;

    expect(typeAt(1, 0)).toBe('artillery');
    expect(typeAt(8, 5)).toBe('artillery');
    expect(typeAt(2, 0)).toBe('cavalry');
    expect(typeAt(7, 5)).toBe('cavalry');
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
    const state = createMatchState(board(Array.from({ length: 6 }, () => '..........')));
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

  it('gives the same ids every time it runs', () => {
    const ids = () => createMatchState(classic).units.map((unit) => unit.id);
    expect(ids()).toEqual(ids());
  });

  it('refuses a board too small to deploy onto', () => {
    // ⚠️ Refused rather than clamped: a negative margin deploys units at
    // negative columns, which parses, stores and replays perfectly while being
    // wrong from the first frame.
    expect(() => createMatchState(board(['....', '....', '....', '....']))).toThrow(
      /too small for an army/,
    );
  });
});
