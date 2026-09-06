import type { ErrorResponse, MatchSummary } from '@vod/shared';

// Same-origin: in dev Vite proxies /api to the server, in production the
// server serves this bundle itself. Either way there's no base URL to
// configure and the session cookie rides along automatically.
const API = '/api';

/**
 * Why a request failed, when the caller needs to tell the difference.
 *
 * `notFound` is not retryable — a deep link to a match that doesn't exist will
 * never succeed, so offering "Retry" would be a lie. `unreachable` covers
 * everything else: the server is down, the network is out, or it answered with
 * something we can't use.
 */
export type FailureKind = 'notFound' | 'unreachable';

export class HttpError extends Error {
  // Declared rather than a constructor parameter property: erasableSyntaxOnly
  // forbids the shorthand, since it emits runtime code from a type position.
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
  }
}

/**
 * A well-formed command the rules refused -- the server's 422, with its reason
 * as the message. Deliberately not an `HttpError` and not a `FailureKind`:
 * a rejection is an answer, not a connection problem, and keeping it a
 * separate type keeps it unrepresentable in the connect path, whose two-case
 * UI it can never reach. A 422 anywhere but a command submit means a broken
 * server, and falls through `instanceof HttpError` checks to `unreachable` --
 * which is what a broken server is.
 */
export class RejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RejectedError';
  }
}

// Every non-2xx body is an ErrorResponse -- the server has no exceptions to
// that rule -- but the network in between can produce anything, so fall back
// to the status when the body isn't ours.
async function reason(response: Response): Promise<string> {
  try {
    const { error } = (await response.json()) as ErrorResponse;
    if (typeof error === 'string') return error;
  } catch {
    // not JSON: a proxy or something else answered, not our server
  }
  return `server returned ${response.status}`;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, init);
  } catch {
    throw new HttpError('unreachable', 'could not reach the server');
  }
  if (response.ok) return response;

  const why = await reason(response);
  if (response.status === 404) throw new HttpError('notFound', why);
  if (response.status === 422) throw new RejectedError(why);
  throw new HttpError('unreachable', why);
}

export async function getJson<T>(path: string): Promise<T> {
  return (await request(path)).json() as Promise<T>;
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await request(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return response.json() as Promise<T>;
}

// Not on GameServer: that interface is scoped to a single match, and listing
// or creating isn't. A plain object rather than an interface -- there's only
// ever going to be one implementation of "call this endpoint".
export const api = {
  matches: {
    list(): Promise<MatchSummary[]> {
      return getJson<MatchSummary[]>('/matches');
    },
    create(): Promise<MatchSummary> {
      return postJson<MatchSummary>('/matches');
    },
  },
};
