# Advance Wars Clone

A turn-based strategy game with an American Revolutionary War theme — infantry, cavalry, and artillery rather than tanks and jets. React + TypeScript + Babylon.js, built with bun.

The full spec lives in `.plan/architecture.md` (gitignored, local only).

## Getting started

```sh
bun install
bun run dev        # http://localhost:5173
```

## Layout

Bun workspaces, three packages, split by **authority** rather than by subject matter:

| Package | Depends on | Contents |
|---|---|---|
| `@aw/shared` | nothing | The rulebook — types, legality predicates, queries, pathfinding, reducers, content tables. Pure functions, no React, no Babylon, no I/O, no randomness. |
| `@aw/server` | `shared` | The authority. Owns the one mutable `GameState`, generates rolls, keeps the event log. |
| `@aw/client` | `shared` | Presentation and input — Babylon rendering, pointer handling, React. |

Bun installs these isolated rather than hoisted, so `packages/server/node_modules/` contains only `@aw/shared`. A stray `import 'react'` in server code is a resolution failure, not something to catch in review.

Cross-package imports go through each package's barrel (`@aw/shared`, `@aw/server`), never into individual files.

`shared` has no build step — its `exports` point at TypeScript source. Bun runs TS natively; Vite compiles it for the browser. The `.d.ts` files under `packages/shared/dist-types/` exist only so downstream packages typecheck against declarations instead of re-reading source; nothing at runtime uses them.

## Scripts

Run from the repo root:

| Command | Does |
|---|---|
| `bun run dev` | Vite dev server for the client |
| `bun run typecheck` | `tsc -b` across all packages, in dependency order |
| `bun run build` | Typecheck everything, then bundle the client |
| `bun run lint` | ESLint across the repo |
| `bun run preview` | Serve the production build |

Both `lint` and `build` exit non-zero on failure.

Working on a single package? `bun run --filter '@aw/client' build` bundles *without* typechecking — use the root `build` for the real check.

## State of play

Hot-seat: select a unit, see its movement range, move it, end turn. Two players, two units each.

Combat is designed but unbuilt, terrain is a single `land` placeholder, and the client still owns `GameState` directly — the `GameServer` boundary is the next piece of work. See the architecture doc for the roadmap.
