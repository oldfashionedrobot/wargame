import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunRequest } from 'bun';
import { parseCommand } from '@vod/shared';
import type { ErrorResponse, GameState, PlayerId } from '@vod/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';
import { DEFAULT_PORT, IS_PROD, SESSION_COOKIE } from './const';

// fileURLToPath, not .pathname -- the latter percent-encodes, so a checkout
// under a path with a space would resolve to a directory that does not exist
// and every request would fall through to "client not built".
const CLIENT_DIST = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));

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

export async function createServer({ port, databaseUrl }: ServerOptions = {}) {
  const db = await createDb(databaseUrl);
  await migrate(db);
  const matches = createMatchStore(db);

  const server = Bun.serve({
    port: port ?? DEFAULT_PORT,
    // A command is only a few hundred bytes
    maxRequestBodySize: 64 * 1024,
    routes: {
      '/api/matches': {
        GET: withSession(async () => Response.json(await matches.list())),
        POST: withSession(async () => Response.json(await matches.create(), { status: 201 })),
      },

      '/api/matches/:id/state': {
        GET: withSession(async (request) => {
          const snapshot = await matches.snapshot(request.params.id);
          return snapshot ? Response.json(snapshot) : notFound();
        }),
      },

      '/api/matches/:id/events': {
        GET: withSession(async (request) => {
          const since = Number(new URL(request.url).searchParams.get('since') ?? 0);
          if (!Number.isInteger(since) || since < 0) {
            return badRequest('since must be a non-negative integer');
          }
          const events = await matches.since(request.params.id, since);
          return events ? Response.json(events) : notFound();
        }),
      },

      '/api/matches/:id/commands': {
        POST: withSession(async (request, session) => {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return badRequest('malformed JSON');
          }

          const command = parseCommand(body);
          if (!command) {
            return badRequest('not a valid command');
          }

          const matchId = request.params.id;
          // Second read of the match -- submit() does its own. Deliberate: it
          // goes away in phase 9 when resolveActor stops needing state. The
          // window can only produce a rejection, never a wrong write.
          const snapshot = await matches.snapshot(matchId);
          if (!snapshot) return notFound();

          const result = await matches.submit(
            matchId,
            command,
            resolveActor(session, snapshot.state),
          );
          if (!result) return notFound();
          // 422: the body was a well-formed command, the rules refused it. That
          // is distinct from 400 (not a command at all) and from 5xx, and the
          // reason is the server's to state.
          if (!result.ok) return errorResponse(result.reason, 422);
          return Response.json(result);
        }),
      },

      // Unclaimed /api URLs, including a method an endpoint does not serve.
      // Keeps those 404 rather than falling through to the client build.
      '/api/*': withSession(async () => notFound()),

      // The client build. A route rather than a `fetch` fallback so that every
      // path is in this table and every handler gets a BunRequest -- which is
      // what carries `cookies`. Least specific, so '/api/*' out-matches it.
      '/*': withSession(async (request) => serveClient(new URL(request.url))),
    },

    error(cause) {
      // An ErrorResponse rather than bun's default, so a client that reads the
      // body gets the same shape here as from any other failure. Nothing reads
      // it yet -- the client branches on status alone until phase 5.
      console.error('unhandled request error:', cause);
      return errorResponse('internal server error', 500);
    },
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
      : errorResponse('client not built -- run `bun run build`', 404);

  if (url.pathname === '/') return serveIndex();

  // Belt-and-braces: URL parsing already collapses `..`, but filesystem access
  // should not rest on how the parser happens to behave. `+ sep` is load-
  // bearing -- a bare startsWith would accept a sibling like dist-types.
  const resolved = resolve(CLIENT_DIST, '.' + url.pathname);
  if (!resolved.startsWith(CLIENT_DIST + sep)) return serveIndex();

  const requested = Bun.file(resolved);
  if (await requested.exists()) return new Response(requested);

  return serveIndex();
}

/**
 * Gives a handler a session, minting one if the request arrives without it.
 * Bun applies the cookie change to the response, so nothing here writes a
 * header.
 *
 * Per entry rather than in one place because `Bun.serve` has no middleware and
 * a matched route reaches no fallback. Forgetting it on a new route is silent
 * -- the endpoint still works, it just stops issuing a session -- hence a
 * decorator visible on every line of the table.
 *
 * Keep it `BunRequest<T>`: widening to `Request` compiles but degrades
 * `request.params` to `Record<string, string>`, so a param typo stops being an
 * error.
 *
 * The id is decorative until phase 9. See Identity in the plan for the two
 * constraints that fall on whatever starts storing it.
 */
function withSession<T extends string>(
  handler: (request: BunRequest<T>, session: string) => Promise<Response>,
): (request: BunRequest<T>) => Promise<Response> {
  return async (request) => {
    // `||`, not `??`: `vod_session=` parses to '' and must mint like a missing
    // cookie. `??` would pass the empty string down as the session.
    const existing = request.cookies.get(SESSION_COOKIE);
    const session = existing || crypto.randomUUID();
    if (session !== existing) request.cookies.set(SESSION_COOKIE, session, COOKIE_OPTIONS);

    return handler(request, session);
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

// Every non-2xx body is an ErrorResponse. `Response.json` sets the content
// type itself, so there is nothing here to wrap.
const errorResponse = (error: string, status: number): Response =>
  Response.json({ error } satisfies ErrorResponse, { status });

const badRequest = (error: string): Response => errorResponse(error, 400);
const notFound = (): Response => errorResponse('not found', 404);

// Guarded so importing this module (a test) starts nothing. Without it, the
// dev and start scripts define createServer and exit without listening.
if (import.meta.main) await createServer();
