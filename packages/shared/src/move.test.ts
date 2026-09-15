import { describe, expect, it } from 'bun:test';
import { validateCommand } from './action';
import { resolveMove, validateMove } from './move';
import type { Rolls } from './combat';
import { LUCK_MAX } from './data/combat';
import { MAX_HEALTH } from './data/unitTypes';
import { makeState, route } from './testing';
import type { Command, MoveCommand } from './types';

// validateMove asks three separate questions -- does the unit exist, may it
// act, is the route walkable -- and only the third is validatePath's. These
// cover the first two and the handoff; validatePath has its own suite in
// movement.test.ts.

const at = (col: number, row: number) => ({ col, row });

const board = makeState(6, [
  { id: 'b1', col: 0, row: 0 },
  { id: 'spent', col: 3, row: 0, hasActed: true },
  { id: 'r1', col: 5, row: 5, owner: 'red' },
]);

// ⚠️ `facing` is required and was missing here until 9f -- which compiled only
// because `shared/`'s own test files are not typechecked. It flowed through as
// undefined and the assertions never looked.
const move = (
  unitId: string,
  from: ReturnType<typeof at>,
  to: ReturnType<typeof at>,
  targetUnitId?: string,
): MoveCommand => ({
  type: 'move',
  unitId,
  path: route(from, to),
  facing: 'north',
  ...(targetUnitId === undefined ? {} : { targetUnitId }),
});

describe('validateMove', () => {
  it('accepts a walkable route for a unit that can act', () => {
    expect(validateMove(board, move('b1', at(0, 0), at(2, 0)))).toBeNull();
  });

  it('refuses a unit id that is not on the board', () => {
    expect(validateMove(board, move('ghost', at(0, 0), at(1, 0)))).toBe('unit not found');
  });

  // Two reasons, one predicate: the gate is canSelectUnit, and the message is
  // derived from it rather than re-deciding what "may act" means.
  it('distinguishes a spent unit from one that is not yours', () => {
    expect(validateMove(board, move('spent', at(3, 0), at(4, 0)))).toBe(
      'that unit has already acted',
    );
    expect(validateMove(board, move('r1', at(5, 5), at(5, 4)))).toBe('that unit is not yours');
  });

  it('hands the route to validatePath, which refuses on its own terms', () => {
    // Out of infantry's range of 3, so the failure comes from the walk.
    expect(validateMove(board, move('b1', at(0, 0), at(5, 0)))).toBe('move exceeds movement range');
  });

  // Ownership is checked before the route, so an opponent's unit is refused as
  // theirs rather than for whatever is wrong with the path.
  it('checks who may act before it checks the route', () => {
    const nonsense: MoveCommand = {
      type: 'move',
      unitId: 'r1',
      path: [at(9, 9)],
      facing: 'north',
    };
    expect(validateMove(board, nonsense)).toBe('that unit is not yours');
  });
});

// Two units on a lane, so distances are easy to read off the column.
const lane = (enemyRow: number, unitTypeId: 'infantry' | 'artillery' = 'infantry') =>
  makeState(8, [
    { id: 'b1', col: 0, row: 0, unitTypeId },
    { id: 'friend', col: 7, row: 0 },
    { id: 'r1', col: 0, row: enemyRow, owner: 'red' },
  ]);

const resolved = (
  state: ReturnType<typeof lane>,
  command: MoveCommand,
  rolls: Rolls = { attack: 0, counter: 0 },
) => {
  const validation = validateCommand(state, command as Command, 'blue');
  if (!validation.ok) throw new Error(`expected a legal command, got: ${validation.reason}`);
  return resolveMove(state, validation.action as Parameters<typeof resolveMove>[1], rolls);
};

describe('validateMove, with a target', () => {
  // ⚠️ The pair that matters, and the reason `refuseAttack` takes the
  // destination rather than reading `unit.position`. Both enemies are two tiles
  // from *somewhere* the unit could be -- one from where it starts, one from
  // where it ends -- and only the second is a legal shot.
  it('measures range from the destination, not the origin', () => {
    // Enemy four away: out of infantry's 2 from the origin, in range after
    // walking two tiles toward it.
    const far = lane(4);
    expect(validateMove(far, move('b1', at(0, 0), at(0, 0), 'r1'))).toBe('target is out of range');
    expect(validateMove(far, move('b1', at(0, 0), at(0, 2), 'r1'))).toBeNull();
  });

  it('refuses a shot that was in range before the unit moved away', () => {
    const near = lane(2);
    expect(validateMove(near, move('b1', at(0, 0), at(0, 0), 'r1'))).toBeNull();
    expect(validateMove(near, move('b1', at(0, 0), at(3, 0), 'r1'))).toBe('target is out of range');
  });

  // `min: 2` is artillery's defining weakness, and it is this predicate rather
  // than any rule naming it.
  it('refuses a target standing too close for the attacker', () => {
    const adjacent = lane(1, 'artillery');
    expect(validateMove(adjacent, move('b1', at(0, 0), at(0, 0), 'r1'))).toBe(
      'target is too close',
    );
  });

  it('refuses a target that is not on the board', () => {
    expect(validateMove(lane(2), move('b1', at(0, 0), at(0, 0), 'ghost'))).toBe('target not found');
  });

  it('refuses attacking your own side, and yourself', () => {
    const state = lane(2);
    expect(validateMove(state, move('b1', at(0, 0), at(3, 0), 'friend'))).toBe(
      'that unit is yours',
    );
    expect(validateMove(state, move('b1', at(0, 0), at(0, 0), 'b1'))).toBe(
      'a unit cannot attack itself',
    );
  });

  // The route is checked first, so an illegal walk is reported as such rather
  // than as whatever the attack would have said from a tile it cannot reach.
  it('reports an unwalkable route before it looks at the target', () => {
    expect(validateMove(lane(2), move('b1', at(0, 0), at(0, 7), 'r1'))).not.toBe(
      'target is out of range',
    );
  });
});

describe('resolveMove', () => {
  it('emits one unitMoved carrying every step of the path', () => {
    expect(resolved(lane(6), move('b1', at(0, 0), at(2, 0)))).toEqual([
      { type: 'unitMoved', unitId: 'b1', path: [at(0, 0), at(1, 0), at(2, 0)], facing: 'north' },
    ]);
  });

  it('emits the move first, then the battle', () => {
    const events = resolved(lane(4), move('b1', at(0, 0), at(0, 2), 'r1'));
    expect(events.map((event) => event.type)).toEqual(['unitMoved', 'battleResolved']);
  });

  it('takes the damage off the defender and names both sides', () => {
    const state = lane(4);
    const [, battle] = resolved(state, move('b1', at(0, 0), at(0, 2), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');

    expect(battle.defender.unitId).toBe('r1');
    expect(battle.defender.health).toBeLessThan(MAX_HEALTH);
    expect(battle.attacker.unitId).toBe('b1');
    expect(battle.kind).toBe('volley');
  });

  // ⚠️ Clamped, because the event says what the defender *has* -- a negative
  // health is a number no rule could read, and `applyEvents` removes at zero.
  it('clamps a fatal hit to zero rather than going negative', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0, unitTypeId: 'artillery' },
      { id: 'r1', col: 0, row: 3, owner: 'red', health: 4 },
    ]);
    const [, battle] = resolved(state, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.defender.health).toBe(0);
  });

  // ⚠️ Infantry reaches two tiles, so closing to two is a mutual exchange: the
  // attacker is inside the defender's band and gets answered for it.
  it('is answered when the attacker is inside the defender’s range', () => {
    const [, battle] = resolved(lane(4), move('b1', at(0, 0), at(0, 2), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.answered).toBe(true);
    expect(battle.attacker.health).toBeLessThan(MAX_HEALTH);
  });

  // ⚠️ The whole point of outranging someone. Artillery reaches five and
  // infantry reaches two, so a gun firing from four is never answered -- one
  // predicate, and no rule anywhere naming "indirect".
  it('is unanswered when the attacker outranges the defender', () => {
    const state = lane(4, 'artillery');
    const [, battle] = resolved(state, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.answered).toBe(false);
    expect(battle.attacker.health).toBe(MAX_HEALTH);
  });

  it('is unanswered when the defender did not survive it', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0, unitTypeId: 'artillery' },
      { id: 'r1', col: 0, row: 2, owner: 'red', health: 3 },
    ]);
    const [, battle] = resolved(state, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.defender.health).toBe(0);
    expect(battle.answered).toBe(false);
  });

  // ⚠️ **Counter-battery: the one case we diverge from AW deliberately.** Two
  // guns within reach of each other answer each other, which AW forbids and
  // history does not -- and it falls out of the predicate rather than needing a
  // rule. A battery caught at *one* tile still cannot answer, because 1 is not
  // inside [2, 5], which is the property worth keeping.
  it('lets two guns answer each other, but not one that has been reached', () => {
    const duel = makeState(8, [
      { id: 'b1', col: 0, row: 0, unitTypeId: 'artillery' },
      { id: 'r1', col: 0, row: 3, owner: 'red', unitTypeId: 'artillery' },
    ]);
    const [, counterBattery] = resolved(duel, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (counterBattery.type !== 'battleResolved') throw new Error('expected a battle');
    expect(counterBattery.answered).toBe(true);

    const reached = makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'r1', col: 0, row: 1, owner: 'red', unitTypeId: 'artillery' },
    ]);
    const [, atContact] = resolved(reached, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (atContact.type !== 'battleResolved') throw new Error('expected a battle');
    expect(atContact.answered).toBe(false);
  });

  // `hasActed` stops a unit *acting* twice in its own turn; answering an attack
  // is not acting, and the predicate is purely geometric so it never asks.
  it('is answered by a defender that has already acted', () => {
    const spent = makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'r1', col: 0, row: 2, owner: 'red', hasActed: true },
    ]);
    const [, battle] = resolved(spent, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.answered).toBe(true);
  });

  // ⚠️ Most of AW's exchange calculus, and it falls out of the formula rather
  // than needing a rule: the counter is computed on the defender's *reduced*
  // health, so a harder first blow buys a softer reply. Same board, same
  // counter roll -- only the attack roll differs, which is enough to push the
  // defender down a band.
  it('counters on post-damage health, so striking first compounds', () => {
    const board = () =>
      makeState(8, [
        { id: 'b1', col: 0, row: 0 },
        { id: 'r1', col: 0, row: 2, owner: 'red' },
      ]);
    const command = move('b1', at(0, 0), at(0, 0), 'r1');

    const riposte = (attack: number) => {
      const [, battle] = resolved(board(), command, { attack, counter: 0 });
      if (battle.type !== 'battleResolved') throw new Error('expected a battle');
      return MAX_HEALTH - battle.attacker.health;
    };

    expect(riposte(LUCK_MAX)).toBeLessThan(riposte(0));
  });

  // ⚠️ The attacker struck first, so its blow lands even when the reply kills
  // it -- the mirror of a dead defender never answering.
  it('lands the attacker’s blow even when the counter kills it', () => {
    const doomed = makeState(8, [
      { id: 'b1', col: 0, row: 0, health: 4 },
      { id: 'r1', col: 0, row: 2, owner: 'red' },
    ]);
    const [, battle] = resolved(doomed, move('b1', at(0, 0), at(0, 0), 'r1'));
    if (battle.type !== 'battleResolved') throw new Error('expected a battle');
    expect(battle.attacker.health).toBe(0);
    expect(battle.answered).toBe(true);
    expect(battle.defender.health).toBeLessThan(MAX_HEALTH);
  });

  it('passes the roll through, so a better one hurts more', () => {
    const command = move('b1', at(0, 0), at(0, 2), 'r1');
    const unlucky = resolved(lane(4), command, { attack: 0, counter: 0 })[1];
    const lucky = resolved(lane(4), command, { attack: LUCK_MAX, counter: 0 })[1];
    if (unlucky.type !== 'battleResolved' || lucky.type !== 'battleResolved') throw new Error();
    expect(lucky.defender.health).toBeLessThan(unlucky.defender.health);
  });
});
