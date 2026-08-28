import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunRequest } from 'bun';
import { parseCommand } from '@vod/shared';
import type { GameState, PlayerId } from '@vod/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';
import { DEFAULT_PORT, IS_PROD, SESSION_COOKIE } from './const';

// fileURLToPath, not .pathname -- the latter percent-encodes, so a checkout
// under a path with a space would resolve to a directory that does not exist
// and every request would fall through to "client not built".
export const CLIENT_DIST = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));

// Secure only in production -- dev runs over plain http://localhost.
// SameSite=Lax is what covers CSRF, which is the risk cookies introduce.
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 31536000,
  secure: IS_PROD,
} as const;

export interface ServerOptions {
  /** Defaults to $PORT, then 3001. Pass 0 to let the OS pick a free one. */
  port?: number;
  /** Defaults to $DATABASE_URL, then the local file. `:memory:` for tests. */
  databaseUrl?: string;
}

/**
 * Builds and starts the server.
 */
export async function createServer({ port, databaseUrl }: ServerOptions = {}) {
  const db = createDb(databaseUrl);
  await migrate(db);
  const matches = createMatchStore(db);

  const server = Bun.serve({
    port: port ?? DEFAULT_PORT,
    // A command is only a few hundred bytes
    maxRequestBodySize: 64 * 1024,
    routes: {
      '/api/matches': {
        GET: withSession(async () => json(await matches.list())),
        POST: withSession(async () => json(await matches.create(), { status: 201 })),
      },

      '/api/matches/:id/state': {
        GET: withSession(async (request) => {
          const snapshot = await matches.snapshot(request.params.id);
          return snapshot ? json(snapshot) : notFound();
        }),
      },

      '/api/matches/:id/events': {
        GET: withSession(async (request) => {
          const since = Number(new URL(request.url).searchParams.get('since') ?? 0);
          if (!Number.isInteger(since) || since < 0) {
            return json({ error: 'since must be a non-negative integer' }, { status: 400 });
          }
          const events = await matches.since(request.params.id, since);
          return events ? json(events) : notFound();
        }),
      },

      '/api/matches/:id/commands': {
        POST: withSession(async (request, session) => {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
          }

          const command = parseCommand(body);
          if (!command) {
            return json({ ok: false, reason: 'not a valid command' }, { status: 400 });
          }

          const matchId = request.params.id;
          // Reads the match once here and again inside submit(), because
          // resolveActor needs state to stamp `actor = currentTurn` while submit
          // owns the read. Deliberately not fixed: phase 9 makes resolveActor a
          // session lookup that needs no state, and this read disappears with it.
          // The window between the two reads can only produce a rejection, never
          // a wrong write -- submit validates against its own, later read.
          const snapshot = await matches.snapshot(matchId);
          if (!snapshot) return notFound();

          const result = await matches.submit(
            matchId,
            command,
            resolveActor(session, snapshot.state),
          );
          // A rejected command is a legitimate answer, not an HTTP error -- the
          // client reads `ok`, and 200 keeps rejection distinct from transport
          // failure.
          return json(result);
        }),
      },

      // Catches every /api URL the table above does not claim, including a
      // method an endpoint does not serve. Answering those 200 through the
      // client fallback would be pretending we understand them.
      '/api/*': withSession(async () => notFound()),
    },

    error(cause) {
      // JSON, so the client can parse it and report accurately rather than
      // failing to decode and blaming the network.
      console.error('unhandled request error:', cause);
      return json({ ok: false, reason: 'internal server error' }, { status: 500 });
    },

    // Everything that is not /api: the client build. Unmatched routes fall
    // through to here, wearing the same wrapper as every route above.
    fetch: withSession(async (request) => serveClient(new URL(request.url))),
  });

  console.log(`server listening on http://localhost:${server.port}`);

  return server;
}

async function serveClient(url: URL): Promise<Response> {
  // Production only: in dev the client is served by Vite, which proxies
  // /api here. Falls back to index.html so client routing works.
  const index = Bun.file(join(CLIENT_DIST, 'index.html'));
  const serveIndex = async (): Promise<Response> =>
    (await index.exists())
      ? new Response(index)
      : new Response('client not built -- run `bun run build`', { status: 404 });

  if (url.pathname === '/') return serveIndex();

  // Resolve and confirm the result is still inside the build directory. URL
  // parsing already collapses `..`, so this is belt-and-braces rather than a
  // known hole -- but "safe because of how the parser happens to behave" is
  // not a property to rely on for filesystem access.
  // `+ sep` matters: a bare startsWith would also accept a sibling directory
  // whose name merely begins with the same characters, like dist-types.
  const resolved = resolve(CLIENT_DIST, '.' + url.pathname);
  if (!resolved.startsWith(CLIENT_DIST + sep)) return serveIndex();

  const requested = Bun.file(resolved);
  if (await requested.exists()) return new Response(requested);

  return serveIndex();
}

/**
 * Wraps a handler so its response carries a session, minting one when the
 * request arrives without it and passing it down.
 *
 * It has to wrap each entry rather than sit in one place, because `routes`
 * bypass the `fetch` handler entirely -- the single choke point that used to
 * exist there is gone, and forgetting the wrapper silently stops that route
 * issuing a session. Hence a visible decorator on every line of the table
 * rather than something ambient.
 *
 * Typed as `BunRequest<T>` rather than a plain `Request` so the path literal
 * survives the wrapper and route handlers keep `request.params` typed. Widening
 * it costs that silently: params degrade to `Record<string, string>` and a typo
 * starts compiling (verified both ways).
 *
 * `fetch` reuses it anyway, even though it is handed an ordinary `Request`.
 * That is sound here because the body only touches `headers`, which both have,
 * and it typechecks because bun declares `fetch` with method syntax, whose
 * parameters stay bivariant even under `strictFunctionTypes` -- checked against
 * 5a turning `strict` on.
 *
 * ⚠️ Two concurrent requests from a browser with no cookie yet each mint a
 * *different* id, and last write wins. Harmless while the id is decorative; it
 * becomes orphaned rows the moment a sessions table hangs off it. The fix
 * belongs with that table, not here -- see Identity in the plan.
 */
function withSession<T extends string>(
  handler: (request: BunRequest<T>, session: string) => Promise<Response>,
): (request: BunRequest<T>) => Promise<Response> {
  return async (request) => {
    // `||` rather than `??`: a present-but-empty cookie (`vod_session=`, which
    // any client can send) is as useless as no cookie, and both have to mint.
    // `??` would keep the empty string and hand it down as the session.
    const existing = new Bun.CookieMap(request.headers.get('cookie') ?? '').get(SESSION_COOKIE);
    const session = existing || crypto.randomUUID();

    const response = await handler(request, session);
    // True exactly when the line above minted, empty cookie included.
    if (session !== existing) {
      response.headers.append(
        'set-cookie',
        new Bun.Cookie(SESSION_COOKIE, session, COOKIE_OPTIONS).serialize(),
      );
    }
    return response;
  };
}

/**
 * The single place a request becomes a player.
 *
 * Hot-seat concession: one browser drives both sides, so the server cannot
 * tell them apart and stamps whoever's turn it is. This is where a
 * session -> PlayerId lookup goes once sessions mean something.
 */
function resolveActor(_session: string, state: GameState): PlayerId {
  return state.currentTurn;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

const notFound = (): Response => json({ error: 'not found' }, { status: 404 });

// The entry point, and the only thing here that acts on import -- guarded, so
// it acts only when this file *is* the program. `bun run dev` and `bun run
// start` both execute it; importing the module (a test) gets the factory and
// nothing else. Without the guard the scripts define createServer and exit
// without listening.
if (import.meta.main) await createServer();
