import { beforeEach, describe, expect, it } from 'bun:test';
import { route } from '@wargame/shared/testing';
import type { Command, Coordinate } from '@wargame/shared';
import { exploreMovement, facingToward, getUnitType, LUCK_MAX } from '@wargame/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';
import type { MatchStore } from './match';
import { getMap } from './maps';
import { createMatchState, PLAYERS } from './matchState';

// Each test gets its own in-memory database: real queries, real migrations, no
// files to clean up, and no way for one test to see another's rows.
let store: MatchStore;
// The raw driver, for assertions that deliberately bypass the store and read
// what actually landed in the tables.
let sql: Awaited<ReturnType<typeof createDb>>['db']['$client'];

beforeEach(async () => {
  const database = await createDb(':memory:');
  await migrate(database);
  store = createMatchStore(database);
  sql = database.db.$client;
});

// A walkable route, not two endpoints -- validatePath walks every step in 6c,
// so an endpoint pair describes a move no client can make.
const move = (unitId: string, to: [number, number], from: [number, number]): Command => ({
  type: 'move',
  facing: 'north',
  unitId,
  path: route({ col: from[0], row: from[1] }, { col: to[0], row: to[1] }),
});

/**
/**
 * A unit that can legally step one tile toward the enemy, and where that step
 * lands -- asked of the rulebook rather than assumed.
 *
 * ⚠️ **Hardcoding this has now broken three times**: once when the army left
 * the maps, once when the boards were resized, and once when a formation grew
 * a second rank and put a friend on the square the back rank would have walked
 * into. Which unit sits on the end, and whether anything stands behind it, are
 * both properties of a dial that becomes a player's choice -- so the only
 * durable question is *who can move one tile forward*, and `exploreMovement` is
 * what answers it.
 *
 * ⚠️ One tile rather than a unit's whole range, deliberately: these are tests
 * about the store, and a route costing more than a gun carriage has would be a
 * movement test failing in the wrong file.
 */
const stepper = (owner: string, forward: 1 | -1) => {
  const state = createMatchState(getMap('classic'));
  for (const unit of state.units) {
    if (unit.owner !== owner) continue;
    const { movementRange, movementType } = getUnitType(unit.unitTypeId);
    const { reachable } = exploreMovement(state, unit, movementRange, movementType);
    const to: Coordinate = { col: unit.position.col, row: unit.position.row + forward };
    if (!reachable.some((tile) => tile.col === to.col && tile.row === to.row)) continue;
    return {
      id: unit.id,
      from: [unit.position.col, unit.position.row] as [number, number],
      to: [to.col, to.row] as [number, number],
    };
  }
  throw new Error(`no ${owner} unit can step one tile forward on the starting board`);
};

const BLUE_MOVER = stepper('player-blue', 1);
const RED_MOVER = stepper('player-red', -1);
const BLUE = 'player-blue';
const RED = 'player-red';

describe('create', () => {
  it('returns a summary at seq 0 with the starting player', async () => {
    const match = await store.create();
    expect(match.seq).toBe(0);
    expect(match.currentTurn).toBe(BLUE);
    expect(match.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(match.createdAt).toBeGreaterThan(0);
  });

  it('starts with no winner, in the summary and in the column', async () => {
    const match = await store.create();
    expect(match.winner).toBeNull();
    const { rows } = await sql.execute({
      sql: 'SELECT winner FROM matches WHERE id = ?',
      args: [match.id],
    });
    expect(rows[0].winner).toBeNull();
  });

  it('gives each match its own id', async () => {
    const [a, b] = [await store.create(), await store.create()];
    expect(a.id).not.toBe(b.id);
  });

  it('writes initial_state and current_state identically to begin with', async () => {
    const { id } = await store.create();
    const { rows } = await sql.execute({
      sql: 'SELECT initial_state, current_state FROM matches WHERE id = ?',
      args: [id],
    });
    expect(rows[0].initial_state).toEqual(rows[0].current_state);
  });
});

describe('list', () => {
  it('is empty to begin with', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('returns newest first', async () => {
    const a = await store.create();
    // Two creates land in the same millisecond, and `created_at` is the only
    // thing the order is defined on -- so without this the timestamps are
    // equal, ties break arbitrarily, and asserting an order asserts nothing.
    // Ordering among matches created in the same millisecond is unspecified
    // and does not matter; ordering between different ones does.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const b = await store.create();

    expect(b.createdAt).toBeGreaterThan(a.createdAt);
    expect((await store.list()).map((match) => match.id)).toEqual([b.id, a.id]);
  });

  // current_turn is denormalised precisely so this does not parse a board.
  it('reflects whose turn it is without loading the game', async () => {
    const { id } = await store.create();
    await store.submit(id, { type: 'endTurn' }, BLUE);
    const [summary] = await store.list();
    expect(summary.currentTurn).toBe(RED);
    expect(summary.seq).toBe(1);
  });
});

describe('snapshot', () => {
  it('returns the state and its seq', async () => {
    const { id } = await store.create();
    const snap = await store.snapshot(id);
    expect(snap?.seq).toBe(0);
    expect(snap?.state.currentTurn).toBe(BLUE);
    // Not a unit count -- that changes whenever the starting roster is tuned,
    // and says nothing about whether snapshot returns the board.
    expect(snap?.state.units.some((unit) => unit.owner === BLUE)).toBe(true);
    expect(snap?.state.units.some((unit) => unit.owner === RED)).toBe(true);
  });

  it('is null for a match that does not exist', async () => {
    expect(await store.snapshot('nope')).toBeNull();
  });
});

describe('since', () => {
  // ⚠️ **Whose turn it is after the move is `ACTIONS_PER_TURN`'s business, not
  // this test's** -- at a budget of one the move ends the turn by itself, and at
  // no cap it does not. So the second command is addressed to whoever is
  // actually up. This test is about the cursor and the state riding along with
  // the events; asserting a turn rule here would only make it break when the
  // game is tuned.
  it('returns everything after the cursor, with the current state', async () => {
    const { id } = await store.create();
    await store.submit(id, move(BLUE_MOVER.id, BLUE_MOVER.to, BLUE_MOVER.from), BLUE);
    const mid = await store.snapshot(id);
    await store.submit(id, { type: 'endTurn' }, mid!.state.currentTurn);

    const all = await store.since(id, 0);
    expect(all?.seq).toBe(2);
    expect(all?.events[0].type).toBe('unitMoved');
    expect(all?.events.at(-1)?.type).toBe('turnEnded');
    // The state travels with the events and is the one they produced: an
    // explicit endTurn always hands play to somebody else.
    expect(all?.state?.currentTurn).not.toBe(mid!.state.currentTurn);
  });

  it('returns nothing new when the caller is already current', async () => {
    const { id } = await store.create();
    await store.submit(id, { type: 'endTurn' }, BLUE);
    const caught = await store.since(id, 1);
    expect(caught?.seq).toBe(1);
    expect(caught?.events).toEqual([]);
    // And no board: the caller already holds this state, so sending it again
    // is a full grid parsed and thrown away on every idle poll.
    expect(caught?.state).toBeUndefined();
  });

  it('is null for a match that does not exist', async () => {
    expect(await store.since('nope', 0)).toBeNull();
  });
});

describe('submit', () => {
  it('advances seq and returns the resulting state', async () => {
    const { id } = await store.create();
    const result = await store.submit(
      id,
      move(BLUE_MOVER.id, BLUE_MOVER.to, BLUE_MOVER.from),
      BLUE,
    );
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.seq).toBe(1);
    // The move landed. Whether a `turnEnded` follows it is the turn budget's
    // business -- see `ACTIONS_PER_TURN` -- and not what this test is about.
    expect(result.events[0].type).toBe('unitMoved');
    expect(result.state.units.find((u) => u.id === BLUE_MOVER.id)?.position).toEqual({
      col: BLUE_MOVER.to[0],
      row: BLUE_MOVER.to[1],
    });
  });

  it('refuses a command the rulebook rejects, and writes nothing', async () => {
    const { id } = await store.create();
    const result = await store.submit(
      id,
      move(BLUE_MOVER.id, RED_MOVER.from, BLUE_MOVER.from),
      BLUE,
    );
    // The refusal, not its wording: the reason belongs to shared/'s rulebook
    // and changes when the rules get more specific, which says nothing about
    // whether the store wrote anything.
    expect(result?.ok).toBe(false);
    // seq did not move, and no row was logged
    expect((await store.snapshot(id))?.seq).toBe(0);
    expect((await store.since(id, 0))?.events).toEqual([]);
  });

  // null, not a rejection: `ok: false` is reserved for a well-formed command
  // the rules refused, which is what lets http.ts map the two to 404 and 422.
  it('returns null for a match that does not exist', async () => {
    expect(await store.submit('nope', { type: 'endTurn' }, BLUE)).toBeNull();
  });

  // Stored on the row; never sent to either player.
  describe('the rolls', () => {
    const attack = async (attackKind: 'fire' | 'charge') => {
      const { id } = await store.create();
      const base = createMatchState(
        getMap('classic'),
        [
          { player: PLAYERS[0], army: ['c'] },
          { player: PLAYERS[1], army: ['i'] },
        ],
        { width: 1, depth: 1 },
      );
      const blue = { ...base.units.find((u) => u.owner === BLUE)!, position: { col: 5, row: 0 } };
      const red = { ...base.units.find((u) => u.owner === RED)!, position: { col: 5, row: 1 } };
      const fight = { ...base, units: [blue, red] };
      await sql.execute({
        sql: 'UPDATE matches SET initial_state = ?, current_state = ? WHERE id = ?',
        args: [JSON.stringify(fight), JSON.stringify(fight), id],
      });
      const command: Command = {
        type: 'move',
        unitId: blue.id,
        path: [blue.position],
        facing: facingToward(blue.position, red.position, blue.facing),
        targetUnitId: red.id,
        attackKind,
      };
      const result = await store.submit(id, command, BLUE);
      expect(result?.ok).toBe(true);
      expect(result?.ok && result.events.map((e) => e.type)).toContain('battleResolved');
      const { rows } = await sql.execute({
        sql: 'SELECT rolls FROM resolutions WHERE match_id = ?',
        args: [id],
      });
      const sent = JSON.stringify([result, await store.since(id, 0)]);
      return { rolls: JSON.parse(rows[0].rolls as string), sent };
    };
    const leaked = /"(attack|counter|charge|rolls)":/;

    it('keeps both of a shot’s', async () => {
      const { rolls, sent } = await attack('fire');
      expect(Object.keys(rolls).sort()).toEqual(['attack', 'counter']);
      for (const roll of [rolls.attack, rolls.counter]) {
        expect(roll).toBeGreaterThanOrEqual(0);
        expect(roll).toBeLessThanOrEqual(LUCK_MAX);
      }
      expect(sent).not.toMatch(leaked);
    });

    it('keeps a charge’s one', async () => {
      const { rolls, sent } = await attack('charge');
      expect(Object.keys(rolls)).toEqual(['charge']);
      expect(rolls.charge).toBeGreaterThanOrEqual(0);
      expect(rolls.charge).toBeLessThanOrEqual(99);
      expect(sent).not.toMatch(leaked);
    });
  });

  it('stamps the actor it was given, ignoring any the client supplied', async () => {
    const { id } = await store.create();
    // Deliberately malformed: a client cannot construct this, which is the
    // point -- `actor` exists only on Action. Cast through unknown to build it.
    const smuggled = {
      ...move(BLUE_MOVER.id, BLUE_MOVER.to, BLUE_MOVER.from),
      actor: RED,
    } as unknown as Command;
    expect((await store.submit(id, smuggled, BLUE))?.ok).toBe(true);
    const { rows } = await sql.execute({
      sql: 'SELECT actor, action FROM resolutions WHERE match_id = ?',
      args: [id],
    });
    expect(rows[0].actor).toBe(BLUE);
    expect(JSON.parse(rows[0].action as string).actor).toBe(BLUE);
  });
});

describe('storage guarantees', () => {
  // An impossible-today condition -- the client's in-flight guard prevents it --
  // and impossible conditions should be loud rather than silently overwrite.
  it('refuses two resolutions claiming the same seq', async () => {
    const { id } = await store.create();
    await store.submit(id, move(BLUE_MOVER.id, BLUE_MOVER.to, BLUE_MOVER.from), BLUE);
    const duplicate = sql.execute({
      sql: `INSERT INTO resolutions (match_id, seq, actor, action, events, created_at)
            VALUES (?, 1, ?, '{}', '[]', 0)`,
      args: [id, BLUE],
    });
    await expect(duplicate).rejects.toThrow(/UNIQUE|PRIMARY|constraint/i);
  });

  it('cascades resolutions away when a match is deleted', async () => {
    const { id } = await store.create();
    await store.submit(id, { type: 'endTurn' }, BLUE);
    await sql.execute({ sql: 'DELETE FROM matches WHERE id = ?', args: [id] });
    const { rows } = await sql.execute('SELECT COUNT(*) c FROM resolutions');
    expect(Number(rows[0].c)).toBe(0);
  });

  /**
   * submit guards its UPDATE with `WHERE current_seq = <the seq it read>`, and
   * throws if that matched nothing. The throw itself cannot be reached from
   * the public API -- verified by trying: twenty interleave attempts, moving
   * the row between submit's read and its write, fired it zero times, because
   * libSQL serialises on one connection so the update always queues behind the
   * batch. The log's primary key would violate first in any case.
   *
   * So this covers the mechanism the guard rests on rather than the branch:
   * that a stale `current_seq` in the WHERE really does match nothing. Without
   * it the guard would be three lines nothing has ever exercised.
   */
  it('refuses to overwrite a match row whose seq has moved', async () => {
    const { id } = await store.create();
    await store.submit(id, { type: 'endTurn' }, BLUE);

    const stale = await sql.execute({
      sql: 'UPDATE matches SET current_seq = 99 WHERE id = ? AND current_seq = ?',
      args: [id, 0], // 0 was the seq before that submit -- now out of date
    });
    expect(stale.rowsAffected).toBe(0);

    const current = await sql.execute({
      sql: 'UPDATE matches SET current_seq = 99 WHERE id = ? AND current_seq = ?',
      args: [id, 1],
    });
    expect(current.rowsAffected).toBe(1);
  });

  it('keeps current_state equal to folding the log from initial_state', async () => {
    const { id } = await store.create();
    await store.submit(id, move(BLUE_MOVER.id, BLUE_MOVER.to, BLUE_MOVER.from), BLUE);
    await store.submit(id, { type: 'endTurn' }, BLUE);
    await store.submit(id, move(RED_MOVER.id, RED_MOVER.to, RED_MOVER.from), RED);

    const { applyEvents } = await import('@wargame/shared');
    const { rows } = await sql.execute({
      sql: 'SELECT initial_state, current_state FROM matches WHERE id = ?',
      args: [id],
    });
    const log = await store.since(id, 0);
    const folded = applyEvents(JSON.parse(rows[0].initial_state as string), log!.events);
    expect(folded).toEqual(JSON.parse(rows[0].current_state as string));
  });

  // ⚠️ The same invariant across the event type that is hardest to reach. Three
  // ordinary moves above never produce a `gameEnded`, so the newest member of
  // the union was in no log this claim folded -- and this claim is the one the
  // whole event design rests on.
  //
  // ⚠️ **Both states are rewritten, not just `current_state`.** Surgery on the
  // checkpoint alone desyncs it from the anchor, and folding from an anchor that
  // never held this position would fail for that reason rather than for
  // anything about `gameEnded`. Rewriting the pair keeps them a matched
  // beginning, which is what makes the fold meaningful.
  it('still holds when the log ends in a gameEnded', async () => {
    const { id } = await store.create();
    // ⚠️ A formation of one gun, so this test owns the unit it is about. It
    // needs blue-1 to be artillery -- range 3..5 -- and the default formation
    // is a tuning dial that has already moved the guns once.
    const base = createMatchState(
      getMap('classic'),
      PLAYERS.map((player) => ({ player, army: ['a'] })),
      { width: 1, depth: 1 },
    );
    const lastStand = {
      ...base,
      units: [
        { ...base.units.find((unit) => unit.id === 'blue-1')!, position: { col: 5, row: 0 } },
        {
          ...base.units.find((unit) => unit.id === 'red-1')!,
          position: { col: 5, row: 3 },
          health: 1,
        },
      ],
    };
    await sql.execute({
      sql: 'UPDATE matches SET initial_state = ?, current_state = ? WHERE id = ?',
      args: [JSON.stringify(lastStand), JSON.stringify(lastStand), id],
    });

    // blue-1 is artillery: range 3..5, so it kills from three tiles off without
    // moving, and a one-health defender does not survive it.
    const result = await store.submit(
      id,
      {
        type: 'move',
        unitId: 'blue-1',
        path: [{ col: 5, row: 0 }],
        facing: 'north',
        targetUnitId: 'red-1',
      },
      BLUE,
    );
    expect(result?.ok).toBe(true);

    const log = await store.since(id, 0);
    expect(log!.events.map((event) => event.type)).toEqual([
      'unitMoved',
      'battleResolved',
      'gameEnded',
    ]);

    const { applyEvents } = await import('@wargame/shared');
    const { rows } = await sql.execute({
      sql: 'SELECT initial_state, current_state FROM matches WHERE id = ?',
      args: [id],
    });
    const folded = applyEvents(JSON.parse(rows[0].initial_state as string), log!.events);
    expect(folded).toEqual(JSON.parse(rows[0].current_state as string));
    // And the thing the fold had to carry across: the marker, not just the board.
    expect(folded.winner).toBe(BLUE);
  });
});

// ⚠️ Reaching a real victory here would mean playing sixteen units to death, so
// the terminal state is written straight into the row instead. That is a
// deliberate trade: `resolveAction` emitting `gameEnded` is covered in the
// rulebook's own suite, and what is left for this layer is the plumbing --
// whether a finished match survives the column, the summary and the refusal.
describe('a finished match', () => {
  const finish = async (winner: string) => {
    const { id } = await store.create();
    const state = { ...createMatchState(getMap('classic')), winner };
    await sql.execute({
      sql: 'UPDATE matches SET current_state = ?, winner = ? WHERE id = ?',
      args: [JSON.stringify(state), winner, id],
    });
    return id;
  };

  it('reports the winner in the listing without loading the game', async () => {
    await finish(RED);
    const [summary] = await store.list();
    expect(summary.winner).toBe(RED);
    // ⚠️ And `current_turn` is untouched beside it, which is what the lobby's
    // "winner displaces the turn" rendering rests on -- the column still holds
    // a live-looking value, so a row that read it alone would look unfinished.
    expect(summary.currentTurn).toBe(BLUE);
  });

  it('refuses a command that would otherwise be legal', async () => {
    const id = await finish(BLUE);
    const result = await store.submit(id, { type: 'endTurn' }, BLUE);
    expect(result).toEqual({ ok: false, reason: 'the game is over' });
  });

  it('writes nothing when it refuses', async () => {
    const id = await finish(BLUE);
    await store.submit(id, { type: 'endTurn' }, BLUE);
    const { rows } = await sql.execute({
      sql: 'SELECT COUNT(*) c FROM resolutions WHERE match_id = ?',
      args: [id],
    });
    expect(rows[0].c).toBe(0);
  });
});
