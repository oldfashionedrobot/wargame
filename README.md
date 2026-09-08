# Victory or Death

A turn-based strategy game with an American Revolutionary War theme — infantry, cavalry, and artillery rather than tanks and jets. React + TypeScript + Babylon.js, built with bun.

The full spec — architecture, invariants, combat design, roadmap — lives in [`.plan/architecture.md`](.plan/architecture.md). Read it before changing anything structural.

## Getting started

```sh
bun install
bun run dev        # http://localhost:5173
```

## Layout

Bun workspaces, three packages, split by **authority** rather than by subject matter:

| Package | Depends on | Contents |
|---|---|---|
| `@vod/shared` | nothing | The rulebook — types, legality predicates, queries, pathfinding, reducers, content tables. Pure functions, no React, no Babylon, no I/O, no randomness. |
| `@vod/server` | `shared` | The authority. Owns the one mutable `GameState`, generates rolls, keeps the event log. |
| `@vod/client` | `shared` | Presentation and input — Babylon rendering, pointer handling, React. |

Bun installs these isolated rather than hoisted, so `packages/server/node_modules/` contains only `@vod/shared`. A stray `import 'react'` in server code is a resolution failure, not something to catch in review.

Cross-package imports go through the `@vod/shared` barrel, never into individual files. `server` is an application rather than a library — nothing imports it, so it has no barrel and no `exports` field; `http.ts` is an entry point that gets run.

`shared` has no build step and emits nothing at all — its `exports` point at TypeScript source. Bun runs TS natively; Vite compiles it for the browser. `tsc` reads that same source: `server` and `client` pull it into their own programs, so it is typechecked as a byproduct of being imported rather than through declaration files.

## Scripts

Run from the repo root:

| Command | Does |
|---|---|
| `bun run dev` | Vite dev server for the client |
| `bun run typecheck` | `tsc -b` across all packages |
| `bun run build` | Typecheck everything, then bundle the client |
| `bun run lint` | ESLint across the repo |
| `bun run preview` | Serve the production build |

Both `lint` and `build` exit non-zero on failure.

Working on a single package? `bun run --filter '@vod/client' build` bundles *without* typechecking — use the root `build` for the real check.

## State of play

Hot-seat: select a unit, see its movement range, move it, end turn. Two players, three units each.

Combat is designed but unbuilt, and terrain is a single `land` placeholder. The server is a real process — SQLite behind an event log, one `seq`-cursored poll away — and the client talks to it only through the `GameServer` interface. Next: the client folds events as it animates them (phase 5b), then terrain and pathfinding (6), then combat (7). See the architecture doc for the roadmap.
