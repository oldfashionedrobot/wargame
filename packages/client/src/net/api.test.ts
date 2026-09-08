import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, HttpError, RejectedError } from './api';

// The stateless half of net/: the /api base, the JSON, and the one place a
// response becomes notFound, unreachable, or a rejection. gameServer.test.ts
// reaches this code incidentally through its fetch stub; these are about the
// classification itself, which is what the connect path's two-case UI and the
// rejection banner both key on.

let respond: (url: string, init?: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  respond = () => Promise.reject(new Error('no response scripted'));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary = { id: 'm1', createdAt: 1, seq: 0, currentTurn: 'player-blue' };

describe('api.matches', () => {
  it('lists from the /api base, same-origin and relative', async () => {
    const seen: string[] = [];
    respond = (url) => {
      seen.push(url);
      return Promise.resolve(json([summary]));
    };
    expect(await api.matches.list()).toEqual([summary]);
    expect(seen).toEqual(['/api/matches']);
  });

  it('creates with a POST', async () => {
    let method: string | undefined;
    respond = (_url, init) => {
      method = init?.method;
      return Promise.resolve(json(summary, 201));
    };
    expect(await api.matches.create()).toEqual(summary);
    expect(method).toBe('POST');
  });
});

describe('failure classification', () => {
  // The distinction MatchRoute's UI is built on: one offers a way back, the
  // other offers Retry, and a thrown error that conflated them would make the
  // caller guess.
  it('marks a 404 notFound and everything else unreachable', async () => {
    respond = () => Promise.resolve(json({ error: 'not found' }, 404));
    await expect(api.matches.list()).rejects.toMatchObject({ kind: 'notFound' });

    respond = () => Promise.resolve(json({ error: 'boom' }, 500));
    await expect(api.matches.list()).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('marks a dead network unreachable', async () => {
    respond = () => Promise.reject(new TypeError('fetch failed'));
    await expect(api.matches.list()).rejects.toMatchObject({ kind: 'unreachable' });
  });

  // A rejection is an answer, not a connection problem, so it must not be an
  // HttpError -- that is what keeps it out of the connect path's two-case UI.
  it('makes a 422 a RejectedError carrying the server reason', async () => {
    respond = () => Promise.resolve(json({ error: 'move exceeds movement range' }, 422));
    const failure = await api.matches.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RejectedError);
    expect(failure).not.toBeInstanceOf(HttpError);
    expect((failure as Error).message).toBe('move exceeds movement range');
  });

  it("reads the server's reason, falling back to the status when the body is not ours", async () => {
    respond = () => Promise.resolve(json({ error: 'client not built' }, 404));
    await expect(api.matches.list()).rejects.toThrow('client not built');

    // A proxy answered, not our server.
    respond = () => Promise.resolve(new Response('<html>502</html>', { status: 502 }));
    await expect(api.matches.list()).rejects.toThrow('server returned 502');
  });
});
