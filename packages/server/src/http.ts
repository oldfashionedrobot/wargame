import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunRequest } from 'bun';
import { parseCommand } from '@vod/shared';
import type { ErrorResponse, GameState, PlayerId } from '@vod/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';
import { listMaps, getMap } from './maps';
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
  /** Defaults to the checked-in client build. A fixture directory in tests. */
  clientDist?: string;
}

export async function createServer({ port, databaseUrl, clientDist }: ServerOptions = {}) {
  // Re-resolved so the traversal guard's `dist + sep` prefix check below works
  // whatever shape the caller passed (trailing separator, relative path).
  const dist = resolve(clientDist ?? CLIENT_DIST);
  const db = await createDb(databaseUrl);
  await migrate(db);
  const matches = createMatchStore(db);

  const server = Bun.serve({
    port: port ?? DEFAULT_PORT,
    // A command is only a few hundred bytes
    maxRequestBodySize: 64 * 1024,
    routes: {
      '/api/maps': {
        GET: withSession(async () =>
          // Ids and names only: the rows are nobody else's business, and a
          // map's terrain reaches the client inside the match state anyway.
          Response.json(listMaps().map(({ id, name }) => ({ id, name }))),
        ),
      },

      '/api/matches': {
        GET: withSession(async () => Response.json(await matches.list())),
        POST: withSession(async (request) => {
          // The body is optional -- no body means the default map -- so an
          // unparseable one is treated as absent rather than refused.
          const body: unknown = await request.json().catch(() => null);
          const mapId = readMapId(body);
          if (mapId === INVALID) return badRequest('unknown map');

          return Response.json(await matches.create(mapId), { status: 201 });
        }),
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
          // goes away in phase 10 when resolveActor stops needing state. The
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
      '/*': withSession(async (request) => serveClient(dist, request)),
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

// Cache policy by path shape: Vite content-hashes every /assets/* filename,
// so those bytes can never change under their name -- cache forever. Anything
// else (index.html above all, whose content decides which hashes get fetched)
// revalidates on every load.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

async function serveClient(dist: string, request: BunRequest): Promise<Response> {
  // Production only: in dev the client is served by Vite, which proxies
  // /api here. Falls back to index.html so client routing works.
  const url = new URL(request.url);
  const accept = request.headers.get('accept-encoding') ?? '';

  const serveIndex = async (): Promise<Response> =>
    (await serveFile(join(dist, 'index.html'), NO_CACHE, accept)) ??
    errorResponse('client not built -- run `bun run build`', 404);

  if (url.pathname === '/') return serveIndex();

  // Belt-and-braces: URL parsing already collapses `..`, but filesystem access
  // should not rest on how the parser happens to behave. `+ sep` is load-
  // bearing -- a bare startsWith would accept a sibling like dist-types.
  const resolved = resolve(dist, '.' + url.pathname);
  if (!resolved.startsWith(dist + sep)) return serveIndex();

  const cacheControl = url.pathname.startsWith('/assets/') ? IMMUTABLE : NO_CACHE;
  return (await serveFile(resolved, cacheControl, accept)) ?? serveIndex();
}

/**
 * Serves one file from the build, preferring a precompressed sibling the
 * client accepts -- the build writes .br and .gz beside every compressible
 * asset. Null when the file does not exist, so the caller owns the fallback.
 *
 * Content-Type comes from the *original* file either way: Bun.file would
 * guess application/octet-stream from a .br extension. Vary rides every
 * response, compressed or not -- a cache that stored the plain body for a
 * br-accepting client would otherwise serve it to everyone. The encoding
 * check is a substring match, which is enough for machine-generated token
 * lists; a client contorted enough to send `q=0` gets bytes it can decode.
 */
async function serveFile(
  path: string,
  cacheControl: string,
  accept: string,
): Promise<Response | null> {
  const original = Bun.file(path);
  if (!(await original.exists())) return null;

  const headers: Record<string, string> = {
    'Content-Type': original.type,
    'Cache-Control': cacheControl,
    Vary: 'Accept-Encoding',
  };

  for (const [encoding, extension] of [
    ['br', '.br'],
    ['gzip', '.gz'],
  ] as const) {
    if (!accept.includes(encoding)) continue;
    const variant = Bun.file(path + extension);
    if (!(await variant.exists())) continue;
    return new Response(variant, { headers: { ...headers, 'Content-Encoding': encoding } });
  }

  return new Response(original, { headers });
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
 * The id is decorative until phase 10. See Identity in the plan for the two
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
/**
 * The requested map, `undefined` for "whatever the default is", or `INVALID`.
 *
 * Three outcomes rather than two because absent and wrong are different
 * answers: an older client sends no body at all and should still get a match.
 */
const INVALID = Symbol('unknown map');

function readMapId(body: unknown): string | undefined | typeof INVALID {
  if (typeof body !== 'object' || body === null) return undefined;
  const { mapId } = body as { mapId?: unknown };
  if (mapId === undefined) return undefined;
  if (typeof mapId !== 'string') return INVALID;

  try {
    return getMap(mapId).id;
  } catch {
    return INVALID;
  }
}

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
