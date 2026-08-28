import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Command, EventsResponse, MatchSummary, StateResponse } from '@vod/shared';
import { createServer } from './http';

// Black box on purpose. Nothing below knows how a URL is dispatched, so the
// suite is unchanged by rewriting the routing underneath it -- which it has
// already survived once.
//
// One server for the file, one in-memory database inside it. Isolation is per
// *match*, not per test: every test that mutates creates its own, and the list
// assertions are written to tolerate the others' rows.

// Inferred rather than annotated as Bun's `Server`, which is generic over its
// websocket data -- this stays right whatever createServer returns.
let server: Awaited<ReturnType<typeof createServer>>;
let base: string;

beforeAll(async () => {
  // Port 0 lets the OS pick, so a running dev server cannot collide with this
  // one, and `:memory:` keeps the real development database out of reach.
  // Both are arguments rather than process.env, which is what lets this be a
  // plain static import with no ordering to get wrong.
  server = await createServer({ port: 0, databaseUrl: ':memory:' });
  base = server.url.origin;
});

afterAll(async () => {
  await server.stop(true);
});

const get = (path: string, init?: RequestInit): Promise<Response> => fetch(`${base}${path}`, init);

const postJson = (path: string, body?: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

async function newMatch(): Promise<MatchSummary> {
  return (await postJson('/api/matches')).json() as Promise<MatchSummary>;
}

// blue-1 starts at (0,0) with movementRange 3, and blue moves first.
const legalMove: Command = {
  type: 'move',
  unitId: 'blue-1',
  path: [
    { col: 0, row: 0 },
    { col: 0, row: 2 },
  ],
};

describe('GET /api/matches', () => {
  it('lists matches', async () => {
    const response = await get('/api/matches');
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it('includes a match that was just created', async () => {
    const { id } = await newMatch();
    const listed = (await (await get('/api/matches')).json()) as MatchSummary[];
    expect(listed.map((match) => match.id)).toContain(id);
  });
});

describe('POST /api/matches', () => {
  it('creates one and answers 201 with its summary', async () => {
    const response = await postJson('/api/matches');
    expect(response.status).toBe(201);

    const match = (await response.json()) as MatchSummary;
    expect(match.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(match.seq).toBe(0);
    expect(match.currentTurn).toBe('player-blue');
    expect(match.createdAt).toBeGreaterThan(0);
  });
});

describe('GET /api/matches/:id/state', () => {
  it('returns the starting board at seq 0', async () => {
    const { id } = await newMatch();
    const response = await get(`/api/matches/${id}/state`);
    expect(response.status).toBe(200);

    const { seq, state } = (await response.json()) as StateResponse;
    expect(seq).toBe(0);
    expect(state.grid).toHaveLength(8);
    expect(state.units).toHaveLength(4);
    expect(state.currentTurn).toBe('player-blue');
  });

  it('404s an unknown match', async () => {
    expect((await get('/api/matches/nope/state')).status).toBe(404);
  });
});

describe('GET /api/matches/:id/events', () => {
  it('returns nothing to replay on a fresh match', async () => {
    const { id } = await newMatch();
    const response = await get(`/api/matches/${id}/events?since=0`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as EventsResponse;
    expect(body.seq).toBe(0);
    expect(body.events).toEqual([]);
  });

  it('returns everything after the given seq', async () => {
    const { id } = await newMatch();
    await postJson(`/api/matches/${id}/commands`, legalMove);

    const body = (await (await get(`/api/matches/${id}/events?since=0`)).json()) as EventsResponse;
    expect(body.seq).toBe(1);
    expect(body.events).toHaveLength(1);

    // Asking from the current seq is the steady-state poll: nothing new.
    const caughtUp = (await (
      await get(`/api/matches/${id}/events?since=1`)
    ).json()) as EventsResponse;
    expect(caughtUp.events).toEqual([]);
  });

  it('400s a negative or non-integer since', async () => {
    const { id } = await newMatch();
    expect((await get(`/api/matches/${id}/events?since=-1`)).status).toBe(400);
    expect((await get(`/api/matches/${id}/events?since=abc`)).status).toBe(400);
    expect((await get(`/api/matches/${id}/events?since=1.5`)).status).toBe(400);
  });

  it('404s an unknown match', async () => {
    expect((await get('/api/matches/nope/events?since=0')).status).toBe(404);
  });
});

describe('POST /api/matches/:id/commands', () => {
  it('accepts a legal command and answers 200 with events and state', async () => {
    const { id } = await newMatch();
    const response = await postJson(`/api/matches/${id}/commands`, legalMove);
    expect(response.status).toBe(200);

    const result = (await response.json()) as { ok: boolean; seq: number; events: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.seq).toBe(1);
    expect(result.events).toHaveLength(1);
  });

  // ⚠️ Locks in current behaviour, which is documented and deliberate: a
  // rejection is an answer, not a transport failure. See the parked decision
  // in .plan/phase-5a-decisions.md -- when that changes, this test is the one
  // that should fail, and it should be updated rather than deleted.
  it('answers 200 with ok:false when the rulebook refuses', async () => {
    const { id } = await newMatch();
    const outOfRange: Command = {
      type: 'move',
      unitId: 'blue-1',
      path: [
        { col: 0, row: 0 },
        { col: 7, row: 7 },
      ],
    };

    const response = await postJson(`/api/matches/${id}/commands`, outOfRange);
    expect(response.status).toBe(200);

    // The wording belongs to shared/, so assert the envelope, not the reason.
    const result = (await response.json()) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('400s a malformed body before the authority sees it', async () => {
    const { id } = await newMatch();
    const response = await fetch(`${base}/api/matches/${id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
  });

  it('400s well-formed JSON that is not a command', async () => {
    const { id } = await newMatch();
    expect((await postJson(`/api/matches/${id}/commands`, { type: 'nope' })).status).toBe(400);
    expect((await postJson(`/api/matches/${id}/commands`, { type: 'move' })).status).toBe(400);
    expect((await postJson(`/api/matches/${id}/commands`, 'a string')).status).toBe(400);
  });

  it('404s an unknown match', async () => {
    expect((await postJson('/api/matches/nope/commands', legalMove)).status).toBe(404);
  });
});

describe('routing', () => {
  it('404s an unrecognised /api path', async () => {
    expect((await get('/api/garbage')).status).toBe(404);
    expect((await get('/api/matches/some-id/garbage')).status).toBe(404);
    expect((await get('/api/matches/some-id/state/extra')).status).toBe(404);
  });

  // Currently 404 rather than 405. Recorded so a router that answers 405
  // instead is a visible decision rather than a silent change.
  it('404s a method the endpoint does not serve', async () => {
    expect((await get('/api/matches', { method: 'DELETE' })).status).toBe(404);
    expect((await get('/api/matches/some-id/state', { method: 'POST' })).status).toBe(404);
  });

  it('hands non-api paths to the client, not the api 404', async () => {
    // Either index.html or the "client not built" notice, depending on whether
    // dist has been built -- both are the client path. Discriminated by body
    // rather than content type, since every non-2xx is JSON including that one.
    const response = await get('/some/client/route');
    expect(await response.text()).not.toContain('"error":"not found"');
  });

  it('does not serve files outside the client build', async () => {
    const response = await get('/%2e%2e/%2e%2e/%2e%2e/etc/passwd');
    expect(await response.text()).not.toContain('root:');
  });
});

// Hardcoded rather than imported: this is the wire contract, and a test that
// read the constant from http.ts would pass no matter what it was renamed to.
const SESSION_COOKIE = 'vod_session';

describe('session cookie', () => {
  it('issues one on first contact', async () => {
    const cookie = (await get('/api/matches')).headers.get('set-cookie');
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // Dev runs over plain http://localhost, so Secure would make it unusable.
    expect(cookie).not.toContain('Secure');
  });

  // An empty value is trivially sendable and useless as an id. Treating it as
  // "present" would hand the handler an empty session and echo `vod_session=`
  // back forever -- which is exactly what `??` instead of `||` produced.
  it('mints a real one when the cookie is present but empty', async () => {
    const response = await get('/api/matches', {
      headers: { cookie: `${SESSION_COOKIE}=` },
    });
    expect(response.headers.get('set-cookie')).toMatch(
      new RegExp(`${SESSION_COOKIE}=[0-9a-f]{8}-[0-9a-f-]{27}`),
    );
  });

  it('does not reissue one that was presented', async () => {
    const response = await get('/api/matches', {
      headers: { cookie: `${SESSION_COOKIE}=already-have-one` },
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
