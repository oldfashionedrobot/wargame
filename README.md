# Victory or Death

A turn-based strategy game with an American Revolutionary War theme — infantry,
cavalry, and artillery rather than tanks and jets. React + TypeScript +
Babylon.js, built with bun.

- [`.plan/architecture.md`](.plan/architecture.md) — what the code does now.
- [`.plan/roadmap.md`](.plan/roadmap.md) — what is designed but unbuilt.

## Getting started

```sh
bun install
bun run dev        # http://localhost:5173
```

`bun run dev` starts two processes: Vite on 5173 and the server on 3001. Vite
proxies `/api` to the server, so everything is same-origin and the client has no
URL to configure.

Configuration is one optional `.env` at the repo root (`PORT`,
`DATABASE_URL`); see `.env.example`. Without it the defaults apply.

## What plays

Hot-seat against a real server. Select a unit, see the tiles it can reach across
terrain, move it along a route, end turn. Two players, three infantry each, on
an 8×8 all-plains map.

Terrain, pathfinding and path validation are built; combat is not.

## Layout

Bun workspaces, three packages, split by **authority** rather than by subject:

| Package | Depends on | Contents |
|---|---|---|
| `@vod/shared` | nothing | The rulebook — types, content tables, queries, movement, validation, resolution, the event fold, the wire protocol. Pure functions: no React, no Babylon, no I/O, no randomness. |
| `@vod/server` | `shared` | The authority — the database, the event log, match construction, the HTTP surface. |
| `@vod/client` | `shared` | Presentation and transport — Babylon rendering, input, React, and the polling `GameServer` that talks to the API. |

Installs are isolated rather than hoisted, so a package can only import what it
declares: a stray `import 'react'` in server code is a resolution failure, not
something to catch in review.

Cross-package imports go through `@vod/shared`'s `exports` map, which has two
entry points: `.` is the rulebook barrel, and `./testing` is fixtures for tests.
`server` is an application rather than a library — nothing imports it, so it has
no barrel; `src/http.ts` is an entry point that gets run.

`shared` has no build script and emits nothing — its `exports` point at
TypeScript source, which bun runs natively and Vite compiles. `server` and
`client` pull that source into their own programs, so it is typechecked as a
byproduct of being imported.

## Scripts

Run from the repo root. All exit non-zero on failure.

| Command | Does |
|---|---|
| `bun run dev` | Vite (5173) + server (3001) |
| `bun run test` | `bun test` for shared and server, Vitest for client |
| `bun run typecheck` | `tsc -b` across the packages |
| `bun run lint` | ESLint across the repo |
| `bun run build` | Typecheck, then bundle and compress the client |
| `bun run format` / `format:check` | Prettier (Markdown is excluded) |
| `bun run db:generate` / `db:migrate` | drizzle-kit — **from the repo root only** |
| `bun run preview` | `vite preview` — serves the built client with **no `/api` proxy**, so it cannot reach a match. To exercise a real build, run the server (`bun run --filter '@vod/server' start`), which serves `dist` itself |

Three things worth knowing:

- Check **exit codes, not output**. `bun run typecheck | tail -3 && echo OK`
  chains the `&&` to `tail`, which always succeeds, and prints OK on failure.
- `tsc -b` can report success from a stale `.tsbuildinfo`. `bunx tsc -b --force`
  is the real check.
- The `db:*` scripts must run from the repo root. Relative `file:` URLs in
  `DATABASE_URL` resolve against the root, and `bun run --filter` would change
  the cwd and lose the single root `.env`.

Working on one package? `bun run --filter '@vod/client' bundle` bundles
*without* typechecking — use the root `build` for the real check.

## Tests

225 tests across the three packages. The renderer is not covered — it is WebGL,
so a browser is its only check.

```sh
bun run test                                              # everything
bun test packages/server/src/match.test.ts                # one file
bun test packages/server/src/match.test.ts -t 'newest'    # one test
cd packages/client && bunx vitest run src/net/gameServer.test.ts
```
