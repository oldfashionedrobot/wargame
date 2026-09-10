import { beforeEach, describe, expect, it } from 'bun:test';
import { route } from '@vod/shared/testing';
import type { Command } from '@vod/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';
import type { MatchStore } from './match';

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

// The starting board, from the `classic` map. Only blue-1 at (0,0) and red-1
// at (7,7) are relied on below; the rest of the roster is free to change.
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
  it('returns everything after the cursor, with the current state', async () => {
    const { id } = await store.create();
    await store.submit(id, move('blue-1', [1, 2], [0, 0]), BLUE);
    await store.submit(id, { type: 'endTurn' }, BLUE);

    const all = await store.since(id, 0);
    expect(all?.seq).toBe(2);
    expect(all?.events.map((e) => e.type)).toEqual(['unitMoved', 'turnEnded']);
    expect(all?.state?.currentTurn).toBe(RED);
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
    const result = await store.submit(id, move('blue-1', [1, 2], [0, 0]), BLUE);
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.seq).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.state.units.find((u) => u.id === 'blue-1')?.position).toEqual({ col: 1, row: 2 });
  });

  it('refuses a command the rulebook rejects, and writes nothing', async () => {
    const { id } = await store.create();
    const result = await store.submit(id, move('blue-1', [7, 7], [0, 0]), BLUE);
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

  it('stamps the actor it was given, ignoring any the client supplied', async () => {
    const { id } = await store.create();
    // Deliberately malformed: a client cannot construct this, which is the
    // point -- `actor` exists only on Action. Cast through unknown to build it.
    const smuggled = { ...move('blue-1', [1, 2], [0, 0]), actor: RED } as unknown as Command;
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
    await store.submit(id, move('blue-1', [1, 2], [0, 0]), BLUE);
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
    await store.submit(id, move('blue-1', [1, 2], [0, 0]), BLUE);
    await store.submit(id, { type: 'endTurn' }, BLUE);
    await store.submit(id, move('red-1', [6, 5], [7, 7]), RED);

    const { applyEvents } = await import('@vod/shared');
    const { rows } = await sql.execute({
      sql: 'SELECT initial_state, current_state FROM matches WHERE id = ?',
      args: [id],
    });
    const log = await store.since(id, 0);
    const folded = applyEvents(JSON.parse(rows[0].initial_state as string), log!.events);
    expect(folded).toEqual(JSON.parse(rows[0].current_state as string));
  });
});
