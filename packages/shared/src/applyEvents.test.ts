import { describe, expect, it } from 'bun:test';
import { resolveAction, validateCommand } from './action';
import { applyEvents } from './applyEvents';
import { makeState, route, unitAt } from './testing';
import type { Command, Coordinate, GameEvent, GameState, PlayerId } from './types';

const pos = (col: number, row: number) => ({ col, row });

const moved = (unitId: string, from: [number, number], to: [number, number]): GameEvent => ({
  type: 'unitMoved',
  unitId,
  path: route(pos(from[0], from[1]), pos(to[0], to[1])),
});

/** A move command whose path is a walkable route rather than two endpoints. */
const move = (unitId: string, from: Coordinate, to: Coordinate): Command => ({
  type: 'move',
  unitId,
  path: route(from, to),
});

describe('applyEvents', () => {
  const state = makeState(8, [
    { id: 'b1', col: 0, row: 0 },
    { id: 'r1', col: 7, row: 7, owner: 'red', hasActed: true },
  ]);

  it('applies unitMoved: the last tile of the path, and the unit is spent', () => {
    const next = applyEvents(state, [moved('b1', [0, 0], [2, 0])]);
    expect(unitAt(next, 'b1').position).toEqual({ col: 2, row: 0 });
    expect(unitAt(next, 'b1').hasActed).toBe(true);
  });

  // Facing is derived from the path rather than carried on the event, so what
  // matters is that the *last* step decides it -- a route that turns a corner
  // is the case a first-step implementation gets wrong.
  it('turns a unit to face the way its last step went', () => {
    const east = applyEvents(state, [moved('b1', [0, 0], [2, 0])]);
    expect(unitAt(east, 'b1').facing).toBe('east');

    // route() walks columns before rows, so this one ends heading up the board.
    const north = applyEvents(state, [moved('b1', [0, 0], [2, 2])]);
    expect(unitAt(north, 'b1').facing).toBe('north');
  });

  it('leaves facing alone when the unit did not go anywhere', () => {
    const before = unitAt(state, 'b1').facing;
    const next = applyEvents(state, [{ type: 'unitMoved', unitId: 'b1', path: [pos(0, 0)] }]);
    expect(unitAt(next, 'b1').facing).toBe(before);
    expect(unitAt(next, 'b1').hasActed).toBe(true); // still spent, though
  });

  it('applies turnEnded: rotates, and refreshes the incoming player only', () => {
    const spent = applyEvents(state, [moved('b1', [0, 0], [2, 0])]);
    const next = applyEvents(spent, [{ type: 'turnEnded', nextPlayer: 'red' }]);
    expect(next.currentTurn).toBe('red');
    expect(unitAt(next, 'r1').hasActed).toBe(false);
    expect(unitAt(next, 'b1').hasActed).toBe(true);
  });

  it('does not mutate the state it was given', () => {
    const before = JSON.stringify(state);
    applyEvents(state, [moved('b1', [0, 0], [2, 0])]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('refuses an unknown event rather than silently desyncing a replay', () => {
    const bogus = { type: 'unitVanished', unitId: 'b1' } as unknown as GameEvent;
    expect(() => applyEvents(state, [bogus])).toThrow('unknown event type: unitVanished');
  });
});

// Rule 2: events carry absolute values, not deltas. This is the property that
// makes at-least-once delivery safe, so a replaying client needs no exact-once
// bookkeeping. Any future event that fails this test is a delta in disguise.
describe('every event is idempotent', () => {
  const state = makeState(8, [
    { id: 'b1', col: 0, row: 0 },
    { id: 'r1', col: 7, row: 7, owner: 'red', hasActed: true },
  ]);

  const cases: [string, GameEvent][] = [
    ['unitMoved', moved('b1', [0, 0], [2, 0])],
    ['turnEnded', { type: 'turnEnded', nextPlayer: 'red' }],
  ];

  for (const [name, event] of cases) {
    it(`${name} applied twice equals once`, () => {
      const once = applyEvents(state, [event]);
      const twice = applyEvents(once, [event]);
      expect(twice).toEqual(once);
    });
  }
});

// Idempotent is not commutative. Ordering comes from (seq, index) and is not
// negotiable -- this test exists so nobody concludes otherwise from the above.
describe('order still matters', () => {
  it('two moves of the same unit do not commute', () => {
    const state = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    const a = moved('b1', [0, 0], [1, 0]);
    const b = moved('b1', [1, 0], [2, 0]);
    expect(unitAt(applyEvents(state, [a, b]), 'b1').position).toEqual({ col: 2, row: 0 });
    expect(unitAt(applyEvents(state, [b, a]), 'b1').position).toEqual({ col: 1, row: 0 });
  });
});

/**
 * A multi-turn script driven exactly as the server drives it: validate,
 * resolve, fold.
 *
 * ⚠️ It does **not** prove `initial + log === current`. `live` is built by
 * folding the same events in the same order, so that comparison holds for any
 * reducer, including one that ignores its events entirely. The real property
 * -- the *persisted* checkpoint equalling a fold of the *persisted* log, two
 * independently-written things -- is `match.test.ts`'s, because only the
 * server has two paths to compare.
 *
 * What this does catch is a script that stops validating or resolving part
 * way through, which is why every step asserts acceptance.
 */
describe('a full turn cycle validates, resolves and folds', () => {
  it('over a multi-turn script', () => {
    const initial = makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'b2', col: 1, row: 0 },
      { id: 'r1', col: 7, row: 7, owner: 'red' },
      { id: 'r2', col: 6, row: 7, owner: 'red' },
    ]);

    // Commands plus the actor the server would stamp. Tests cannot build an
    // Action directly -- that is the brand doing its job.
    const script: [Command, PlayerId][] = [
      [move('b1', pos(0, 0), pos(1, 2)), 'blue'],
      [move('b2', pos(1, 0), pos(2, 2)), 'blue'],
      [{ type: 'endTurn' }, 'blue'],
      [move('r1', pos(7, 7), pos(6, 5)), 'red'],
      [{ type: 'endTurn' }, 'red'],
      [move('b1', pos(1, 2), pos(2, 4)), 'blue'],
      [{ type: 'endTurn' }, 'blue'],
    ];

    // Play it exactly the way the server does: validate, resolve, fold.
    let live: GameState = initial;
    const log: GameEvent[] = [];
    for (const [command, actor] of script) {
      const validation = validateCommand(live, command, actor);
      expect(validation.ok).toBe(true);
      if (!validation.ok) return;
      const events = resolveAction(live, validation.action);
      log.push(...events);
      live = applyEvents(live, events);
    }

    expect(log).toHaveLength(script.length);
    expect(applyEvents(initial, log)).toEqual(live);
  });

  // Replaying a prefix of the log lands on the state that prefix describes.
  // Asserting against a stepwise fold would be circular -- both are the same
  // reduce -- so the expectations are written out independently.
  it('replays to any point along the way, not just the end', () => {
    const initial = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    const log: GameEvent[] = [
      moved('b1', [0, 0], [1, 0]),
      { type: 'turnEnded', nextPlayer: 'red' },
      { type: 'turnEnded', nextPlayer: 'blue' },
      moved('b1', [1, 0], [3, 0]),
    ];

    const expected = [
      { col: 1, row: 0, turn: 'blue', spent: true },
      { col: 1, row: 0, turn: 'red', spent: true },
      { col: 1, row: 0, turn: 'blue', spent: false }, // blue's units refreshed
      { col: 3, row: 0, turn: 'blue', spent: true },
    ];

    for (const [i, want] of expected.entries()) {
      const at = applyEvents(initial, log.slice(0, i + 1));
      expect(unitAt(at, 'b1').position).toEqual({ col: want.col, row: want.row });
      expect(at.currentTurn).toBe(want.turn);
      expect(unitAt(at, 'b1').hasActed).toBe(want.spent);
    }
  });
});
