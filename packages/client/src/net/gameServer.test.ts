import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '@vod/shared/testing';
import type {
  CommandResult,
  EventsResponse,
  GameEvent,
  GameServer,
  StateResponse,
} from '@vod/shared';
import { connectGameServer } from './gameServer';

// The most intricate code in the client. fetch and timers are faked; the DOM
// is happy-dom's, which is what makes the visibility behaviour testable --
// `document.hidden` is shadowed per-test and restored in afterEach.
//
// Every timer advance is the *async* form. The poll loop reschedules from an
// async callback, so the sync form would fire the timer, never let the awaits
// inside settle, and the loop would silently stop after one poll.

const POLL = 2000;
const MAX_BACKOFF = 30_000;

const state0 = makeState(3, [{ id: 'b1', col: 0, row: 0 }]);
const state1 = makeState(3, [{ id: 'b1', col: 0, row: 1 }]);
const moved: GameEvent[] = [
  {
    type: 'unitMoved',
    unitId: 'b1',
    path: [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ],
  },
];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

// One handler per endpoint, swappable mid-test, so each test scripts only the
// endpoint it is about. `requested` is what URL assertions read.
let onState: () => Promise<Response>;
let onEvents: (since: number) => Promise<Response>;
let onCommands: () => Promise<Response>;
let requested: string[];

const polls = (): number => requested.filter((url) => url.includes('/events')).length;

const nothingNew = (since: number): Promise<Response> =>
  Promise.resolve(json({ seq: since, events: [], state: state0 } satisfies EventsResponse));

const servers: GameServer[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  requested = [];
  onState = () => Promise.resolve(json({ seq: 0, state: state0 } satisfies StateResponse));
  onEvents = nothingNew;
  onCommands = () => Promise.reject(new Error('no command scripted for this test'));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requested.push(url);
      if (url.includes('/state')) return onState();
      if (url.includes('/events')) {
        const since = Number(new URL(url, 'http://test').searchParams.get('since'));
        return onEvents(since);
      }
      if (url.includes('/commands') && init?.method === 'POST') return onCommands();
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
});

afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
  Reflect.deleteProperty(document, 'hidden'); // drop any per-test shadow
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// happy-dom's document.hidden is a prototype getter; an own property shadows
// it for one test and afterEach deletes the shadow.
function setTabHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

async function connect(options?: Parameters<typeof connectGameServer>[1]): Promise<GameServer> {
  const result = await connectGameServer('m1', options);
  if (!result.ok) throw new Error('fixture failed to connect');
  servers.push(result.server);
  return result.server;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('connectGameServer', () => {
  it('connects and serves the fetched state synchronously', async () => {
    const server = await connect();
    expect(server.getState()).toEqual(state0);
  });

  // The kind, never the message: transport wording changes in step 2, and a
  // test pinned to it would be rewritten by an otherwise additive change.
  it('classifies a missing match as notFound', async () => {
    onState = () => Promise.resolve(json({ error: 'not found' }, 404));
    const result = await connectGameServer('nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('notFound');
  });

  it('classifies a dead network as unreachable', async () => {
    onState = () => Promise.reject(new TypeError('fetch failed'));
    const result = await connectGameServer('m1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('unreachable');
  });
});

describe('subscribe', () => {
  it('fires synchronously with the current state, so subscribers need no initial fetch', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([], state0);
  });

  it('stops delivering after unsubscribe', async () => {
    const server = await connect();
    const listener = vi.fn();
    const unsubscribe = server.subscribe(listener);
    unsubscribe();
    onEvents = () => Promise.resolve(json({ seq: 1, events: moved, state: state1 }));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(listener).toHaveBeenCalledTimes(1); // the synchronous initial fire only
  });
});

describe('polling', () => {
  it('asks for everything after the last seq it saw', async () => {
    await connect();
    onEvents = () => Promise.resolve(json({ seq: 3, events: moved, state: state1 }));
    await vi.advanceTimersByTimeAsync(POLL);
    onEvents = nothingNew;
    await vi.advanceTimersByTimeAsync(POLL);
    const asked = requested.filter((url) => url.includes('/events'));
    expect(asked[0]).toContain('since=0');
    expect(asked[1]).toContain('since=3');
  });

  it('delivers new events and state to listeners', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);
    onEvents = () => Promise.resolve(json({ seq: 1, events: moved, state: state1 }));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(moved, state1);
    expect(server.getState()).toEqual(state1);
  });

  it('delivers nothing when the poll brings nothing new', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('seq deduplication', () => {
  // The reason the guard exists: a poll already in flight when a command is
  // submitted returns the same events the POST response delivers. Applying both
  // would animate the move twice -- state hides a double-apply, events do not.
  it('drops a poll response repeating an update the submit already delivered', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);

    const inFlight = deferred<Response>();
    onEvents = () => inFlight.promise;
    await vi.advanceTimersByTimeAsync(POLL); // the poll leaves and does not return yet

    onCommands = () =>
      Promise.resolve(
        json({ ok: true, seq: 1, events: moved, state: state1 } satisfies CommandResult),
      );
    await server.submit({ type: 'endTurn' });
    expect(listener).toHaveBeenCalledTimes(2); // initial fire + the submit's own delivery

    onEvents = nothingNew;
    inFlight.resolve(json({ seq: 1, events: moved, state: state1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(2); // the duplicate was dropped

    await vi.advanceTimersByTimeAsync(POLL); // and the next poll asks past it
    expect(requested.at(-1)).toContain('since=1');
  });
});

describe('submit', () => {
  it('delivers its own response immediately, without waiting for a poll', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);
    onCommands = () =>
      Promise.resolve(
        json({ ok: true, seq: 1, events: moved, state: state1 } satisfies CommandResult),
      );
    const result = await server.submit({ type: 'endTurn' });
    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(moved, state1);
  });

  it('reports a transport failure as ok: false and flips the connection to retrying', async () => {
    const onConnectionChange = vi.fn();
    const server = await connect({ onConnectionChange });
    const listener = vi.fn();
    server.subscribe(listener);
    onCommands = () => Promise.reject(new TypeError('fetch failed'));
    const result = await server.submit({ type: 'endTurn' });
    expect(result.ok).toBe(false);
    expect(onConnectionChange).toHaveBeenCalledWith('retrying');
    expect(listener).toHaveBeenCalledTimes(1); // nothing to deliver
  });

  // A rejection is an answer, not a connection problem. The server's own
  // wording is the contract here -- passing it through is the point -- so
  // asserting it is not the message-pinning the transport tests avoid.
  it('returns a 422 rejection with the server reason, without touching the connection', async () => {
    const onConnectionChange = vi.fn();
    const server = await connect({ onConnectionChange });
    const listener = vi.fn();
    server.subscribe(listener);
    onCommands = () => Promise.resolve(json({ error: 'unit has already acted' }, 422));
    const result = await server.submit({ type: 'endTurn' });
    expect(result).toEqual({ ok: false, reason: 'unit has already acted' });
    expect(onConnectionChange).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1); // nothing to deliver
  });

  it('carries the server reason on a non-422 failure too, still as transport', async () => {
    const onConnectionChange = vi.fn();
    const server = await connect({ onConnectionChange });
    onCommands = () => Promise.resolve(json({ error: 'seq guard matched nothing' }, 500));
    const result = await server.submit({ type: 'endTurn' });
    expect(result).toEqual({ ok: false, reason: 'seq guard matched nothing' });
    expect(onConnectionChange).toHaveBeenCalledWith('retrying');
  });

  it('falls back to the status when the failure body is not ours', async () => {
    const server = await connect();
    onCommands = () => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const result = await server.submit({ type: 'endTurn' });
    expect(result).toEqual({ ok: false, reason: 'server returned 502' });
  });
});

describe('backoff', () => {
  it('doubles the interval per failed poll and caps at 30s', async () => {
    await connect();
    onEvents = () => Promise.reject(new TypeError('fetch failed'));

    await vi.advanceTimersByTimeAsync(POLL);
    expect(polls()).toBe(1); // failed; next in 4s
    await vi.advanceTimersByTimeAsync(2 * POLL - 1);
    expect(polls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls()).toBe(2); // failed; next in 8s
    await vi.advanceTimersByTimeAsync(4 * POLL);
    expect(polls()).toBe(3); // failed; next in 16s

    await vi.advanceTimersByTimeAsync(8 * POLL); // 4th failure caps the doubling
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF); // from here every gap is 30s
    expect(polls()).toBe(5);
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF - 1);
    expect(polls()).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls()).toBe(6);
  });

  it('resets the interval on the next success', async () => {
    await connect();
    onEvents = () => Promise.reject(new TypeError('fetch failed'));
    await vi.advanceTimersByTimeAsync(POLL); // failed; next in 4s
    onEvents = nothingNew;
    await vi.advanceTimersByTimeAsync(2 * POLL); // succeeded; interval back to 2s
    expect(polls()).toBe(2);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(polls()).toBe(3);
  });

  it('reports retrying while polls fail and connected once one succeeds', async () => {
    const onConnectionChange = vi.fn();
    await connect({ onConnectionChange });
    onEvents = () => Promise.reject(new TypeError('fetch failed'));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onConnectionChange).toHaveBeenLastCalledWith('retrying');
    onEvents = nothingNew;
    await vi.advanceTimersByTimeAsync(2 * POLL);
    expect(onConnectionChange).toHaveBeenLastCalledWith('connected');
  });
});

describe('hidden tab', () => {
  it('polls at the slowest interval while the tab is hidden', async () => {
    setTabHidden(true);
    await connect();
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF - 1);
    expect(polls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls()).toBe(1);
  });

  // Without the reset, restoring a tab could leave it up to thirty seconds
  // stale while looking live.
  it('resets the backoff and polls immediately on return', async () => {
    setTabHidden(true);
    await connect();
    setTabHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(1); // immediately, not thirty seconds out
    await vi.advanceTimersByTimeAsync(POLL);
    expect(polls()).toBe(2); // and back on the normal interval
  });

  it('ignores visibility changes after dispose', async () => {
    const server = await connect();
    server.dispose();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF);
    expect(polls()).toBe(0);
  });
});

describe('dispose', () => {
  it('stops the poll loop', async () => {
    const server = await connect();
    server.dispose();
    await vi.advanceTimersByTimeAsync(10 * MAX_BACKOFF);
    expect(polls()).toBe(0);
  });

  // StrictMode produces exactly this: a poll in flight when the route tears
  // down. Whoever constructed the server disposes it; the late response must
  // not restart the loop or reach a listener.
  it('does not reschedule or deliver when a poll resolves after dispose', async () => {
    const server = await connect();
    const listener = vi.fn();
    server.subscribe(listener);

    const inFlight = deferred<Response>();
    onEvents = () => inFlight.promise;
    await vi.advanceTimersByTimeAsync(POLL); // the poll leaves...
    server.dispose(); // ...the route unmounts...
    inFlight.resolve(json({ seq: 1, events: moved, state: state1 })); // ...then it lands
    await vi.advanceTimersByTimeAsync(10 * MAX_BACKOFF);

    expect(listener).toHaveBeenCalledTimes(1); // dispose cleared the listeners
    expect(polls()).toBe(1); // and nothing rescheduled
  });
});
