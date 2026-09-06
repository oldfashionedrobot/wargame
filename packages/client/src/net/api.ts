import type { MatchSummary } from '@vod/shared';

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

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, init);
  } catch {
    throw new HttpError('unreachable', 'could not reach the server');
  }

  if (response.status === 404) throw new HttpError('notFound', 'not found');
  if (!response.ok) throw new HttpError('unreachable', `server returned ${response.status}`);
  return response;
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
