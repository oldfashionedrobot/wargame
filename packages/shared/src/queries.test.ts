import { describe, expect, it } from 'bun:test';
import { getTileAt, getUnitAt } from './queries';
import { makeState } from './testing';

const at = (col: number, row: number) => ({ col, row });

describe('getTileAt', () => {
  it('reads the terrain under a coordinate', () => {
    const state = makeState(3, []);
    expect(getTileAt(state, at(1, 2))).toBe('plains');
  });

  // The search asks about neighbours before it knows they are on the board,
  // so off-grid has to answer rather than throw -- and it answers the same
  // way getUnitAt does about an empty tile.
  it('is undefined off the board, in both axes and both directions', () => {
    const state = makeState(3, []);
    expect(getTileAt(state, at(3, 0))).toBeUndefined();
    expect(getTileAt(state, at(0, 3))).toBeUndefined();
    expect(getTileAt(state, at(-1, 0))).toBeUndefined();
    expect(getTileAt(state, at(0, -1))).toBeUndefined();
  });

  // The grid is indexed [row][col], and a square board hides a transposition.
  it('indexes rows before columns', () => {
    const state = makeState({ cols: 4, rows: 2 }, []);
    expect(getTileAt(state, at(3, 1))).toBe('plains'); // the far corner
    expect(getTileAt(state, at(1, 3))).toBeUndefined(); // transposed: off the board
  });
});

describe('getUnitAt', () => {
  it('finds a unit by its position, and nothing on an empty tile', () => {
    const state = makeState(3, [{ id: 'b1', col: 1, row: 1 }]);
    expect(getUnitAt(state, at(1, 1))?.id).toBe('b1');
    expect(getUnitAt(state, at(0, 0))).toBeUndefined();
  });
});
