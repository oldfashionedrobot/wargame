import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type {
  Command,
  ErrorResponse,
  EventsResponse,
  MatchSummary,
  StateResponse,
} from '@vod/shared';
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
    expect(state.currentTurn).toBe('player-blue');
    // Both sides start with something to move. Asserting a count instead would
    // fail every time the starting roster is tuned, which says nothing about
    // whether the endpoint works.
    for (const player of state.players) {
      expect(state.units.some((unit) => unit.owner === player.id)).toBe(true);
    }
    expect(state.units.every((unit) => !unit.hasActed)).toBe(true);
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
    // No board on a caught-up poll: the client has this state already and
    // discards a second copy, so sending one is pure waste on every poll.
    expect(body.state).toBeUndefined();
  });

  it('returns everything after the given seq', async () => {
    const { id } = await newMatch();
    await postJson(`/api/matches/${id}/commands`, legalMove);

    const body = (await (await get(`/api/matches/${id}/events?since=0`)).json()) as EventsResponse;
    expect(body.seq).toBe(1);
    expect(body.events).toHaveLength(1);
    // Events never travel without the state they produced.
    expect(body.state?.currentTurn).toBe('player-blue');

    // Asking from the current seq is the steady-state poll: nothing new, and
    // therefore no board either.
    const caughtUp = (await (
      await get(`/api/matches/${id}/events?since=1`)
    ).json()) as EventsResponse;
    expect(caughtUp.events).toEqual([]);
    expect(caughtUp.state).toBeUndefined();
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

  // 422, not 200: well-formed, and refused on its merits. Distinct from the
  // 400s above, which mean the body was never a command at all.
  it('answers 422 when the rulebook refuses', async () => {
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
    expect(response.status).toBe(422);

    // The wording belongs to shared/, so assert the envelope, not the reason.
    const body = (await response.json()) as ErrorResponse;
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
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

// A fixture dist rather than the real build: these tests must not depend on
// whether `bun run build` has run, and distinct plaintext inside each variant
// is what proves *which* file was served -- bun's fetch decodes Content-
// Encoding transparently (keeping the header), so body text distinguishes
// the variants where byte counts could not.
describe('the client build', () => {
  let fixtureServer: Awaited<ReturnType<typeof createServer>>;
  let fixtureBase: string;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'vod-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><h1>fixture index</h1>');
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'const artifact = "raw";');
    writeFileSync(
      join(dist, 'assets', 'app-abc123.js.br'),
      brotliCompressSync('const artifact = "br";'),
    );
    writeFileSync(join(dist, 'assets', 'app-abc123.js.gz'), gzipSync('const artifact = "gz";'));
    writeFileSync(join(dist, 'assets', 'plain-def456.js'), 'const artifact = "plain";');

    fixtureServer = await createServer({ port: 0, databaseUrl: ':memory:', clientDist: dist });
    fixtureBase = fixtureServer.url.origin;
  });

  afterAll(async () => {
    await fixtureServer.stop(true);
    rmSync(dist, { recursive: true, force: true });
  });

  const getAsset = (path: string, accept: string): Promise<Response> =>
    fetch(`${fixtureBase}${path}`, { headers: { 'accept-encoding': accept } });

  it('serves the brotli variant to a client that accepts it', async () => {
    const response = await getAsset('/assets/app-abc123.js', 'gzip, br');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(await response.text()).toBe('const artifact = "br";');
  });

  it('serves gzip when brotli is not accepted', async () => {
    const response = await getAsset('/assets/app-abc123.js', 'gzip');
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(await response.text()).toBe('const artifact = "gz";');
  });

  it('serves the original when neither is accepted', async () => {
    const response = await getAsset('/assets/app-abc123.js', 'identity');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe('const artifact = "raw";');
  });

  it('falls through to the original when no variant exists', async () => {
    const response = await getAsset('/assets/plain-def456.js', 'gzip, br');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe('const artifact = "plain";');
  });

  it('marks hashed assets immutable and everything else no-cache', async () => {
    const asset = await getAsset('/assets/app-abc123.js', 'br');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('vary')).toBe('Accept-Encoding');

    // A client route falls back to index.html -- the one file whose name
    // never changes, so it must revalidate.
    const route = await getAsset('/some/client/route', 'br');
    expect(route.headers.get('cache-control')).toBe('no-cache');
    expect(await route.text()).toContain('fixture index');
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
