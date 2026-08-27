import { describe, expect, it } from 'bun:test';
import { resolveAction, validateCommand } from './action';
import { applyEvents } from './applyEvents';
import { makeState, unitAt } from './testing';
import type { Command, GameEvent, GameState, PlayerId } from './types';

const pos = (col: number, row: number) => ({ col, row });

const moved = (unitId: string, from: [number, number], to: [number, number]): GameEvent => ({
  type: 'unitMoved',
  unitId,
  path: [
    { col: from[0], row: from[1] },
    { col: to[0], row: to[1] },
  ],
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
 * The claim the architecture doc has always made and nothing has ever checked:
 * a match is its initial state plus an ordered log, and folding that log
 * reproduces the current state.
 *
 * It holds by construction now -- applyEvents is the only mutator, so live play
 * and replay run the same code. This test is what stops that becoming untrue.
 */
describe('the fold: initial state + events reproduces current state', () => {
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
      [{ type: 'move', unitId: 'b1', path: [pos(0, 0), pos(1, 2)] }, 'blue'],
      [{ type: 'move', unitId: 'b2', path: [pos(1, 0), pos(2, 2)] }, 'blue'],
      [{ type: 'endTurn' }, 'blue'],
      [{ type: 'move', unitId: 'r1', path: [pos(7, 7), pos(6, 5)] }, 'red'],
      [{ type: 'endTurn' }, 'red'],
      [{ type: 'move', unitId: 'b1', path: [pos(1, 2), pos(2, 4)] }, 'blue'],
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

  it('and reproduces the state at any point along the way, not just the end', () => {
    const initial = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    const log: GameEvent[] = [
      moved('b1', [0, 0], [1, 0]),
      { type: 'turnEnded', nextPlayer: 'red' },
      { type: 'turnEnded', nextPlayer: 'blue' },
      moved('b1', [1, 0], [3, 0]),
    ];

    let stepwise: GameState = initial;
    for (let i = 0; i < log.length; i++) {
      stepwise = applyEvents(stepwise, [log[i]]);
      expect(applyEvents(initial, log.slice(0, i + 1))).toEqual(stepwise);
    }
  });
});
