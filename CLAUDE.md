# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The spec comes first

Two living documents, kept accurate in the same commit as the code they
describe:

- **`.plan/architecture.md`** — what the code does *now*. No rationale, no
  history, no plans. Read the relevant section before changing anything
  structural, and update it with the change.
- **`.plan/roadmap.md`** — what is designed but unbuilt: combat, facing,
  remaining phases, accepted limits. Nothing in it describes current behaviour.

When something ships, it moves from the roadmap into the architecture doc and
is deleted from the roadmap. Neither file keeps a changelog; `git log` is the
history.

## Commands

| | |
|---|---|
| `bun run dev` | Vite (5173) + server (3001); `/api` is proxied, same-origin everywhere |
| `bun run test` | `bun test` for shared+server, then Vitest for client |
| `bun run typecheck` | `tsc -b` — but see the stale-cache trap below |
| `bun run lint` / `bun run build` / `bun run format:check` | all exit non-zero on failure |
| | `format:check` skips Markdown (`.prettierignore`), so these docs are not covered |
| `bun run db:generate` / `db:migrate` | **from the repo root only** — see traps |

Single test file: `bun test packages/server/src/match.test.ts` (add `-t 'name'`
to filter); client: `cd packages/client && bunx vitest run src/net/gameServer.test.ts`.

## The gate — before every commit

Lint, tests, format and build must all be green. Two rules with history behind
them:

- **Check exit codes, not output.** `bun run typecheck | tail -3 && echo OK`
  chains the `&&` to `tail` and prints OK on failure. That happened.
- **`tsc -b` can pass stale** — its `.tsbuildinfo` may believe work is current.
  `bunx tsc -b --force` is the real check.

The `/gate` skill runs the whole chain and reports per-leg exit codes. For
anything visual, the `/run-app` skill launches the app and drives it in a
headless browser — the renderer has no test coverage (WebGL), so a browser is
its only check.

## Architecture in one breath

Three bun workspaces split by **authority**, not subject: `shared/` is the pure
rulebook (zero deps — no I/O, no RNG, no React/Babylon, no `Date.now()`),
`server/` is the authority (owns the DB, keeps the event log, and will own
rolls when combat lands),
`client/` is presentation. Installs are isolated, so a stray `import 'react'`
in server code is a resolution error, not a review catch. Cross-package imports
go through `@vod/shared`'s `exports` map — `.` is the rulebook barrel, and
`./testing` is fixtures for tests. `server/` is an app, not a library: no
barrel, `http.ts` is the entry point.

The pipeline: `validateCommand` (the only constructor of a branded `Action`) →
`resolveAction` (returns **events, not state**) → `applyEvents` (the only
mutator). `Command` is client intent, `Action` is server-accepted, `GameEvent`
is broadcast fact — clients render facts, never resolve outcomes. Deterministic
preview yes, random resolution no. Events are **absolute values, never
deltas**, and independently applicable — that's what makes replay and the
`initial_state + log = current_state` test hold.

The server holds nothing between requests — SQLite (libSQL + Drizzle) is the
only mutable state. Transport is plain HTTP polling with a `seq` cursor; no
push, no WebSockets, ever. Rule-rejected commands answer **422**; every non-2xx
body this code writes is `{ error: string }`.

Movement: `exploreMovement` searches, `validatePath` checks a client-supplied
route, and both call `entryCost` — one function decides what a tile costs, so
the client's overlay and the server's check cannot disagree.

## Traps that bit before

- **`db:*` scripts run from the repo root.** `file:` URLs in `DATABASE_URL`
  resolve differently for the server (explicit `REPO_ROOT`) and drizzle-kit
  (cwd) — converting those scripts to `bun run --filter` silently creates a
  second empty database beside the real one.
- **One `.env`, at the repo root.** Bun doesn't walk up; server scripts pass
  `--env-file=../../.env` explicitly.
- **Don't pin the server's wording in client tests.** Assert the failure's
  *kind* — the reason text belongs to the server and changes without the
  failure mode changing. Asserting that a reason the fixture supplied arrives
  intact is a different thing and is fine; that is passthrough, not wording.
- **`http.test.ts` is a black box** over real `fetch` against `createServer`.
  Keep it that way — it survived a routing rewrite untouched precisely because
  nothing in it knows how URLs dispatch.
- **`shared/`'s own test files are not typechecked** — nothing imports them
  into a program `tsc -b` builds. They are verified by running. `server/` and
  `client/` test files *are* checked.
- **Tests must not touch the real dev database.** Server suites use `:memory:`;
  `db.test.ts` uses a temp directory. A relative `file:` URL resolves against
  the repo root, so a careless one opens `packages/server/vod.db`.
- **`http.test.ts` serves a fixture dist, never the real build.** `dist/` is
  gitignored and `bun run test` does not build it, so tests written against it
  quietly change meaning depending on whether someone ran a build.
- `strict` is on in every program `tsc -b` builds — `server`, and both client
  configs. `shared` has no program of its own; its source is checked inside
  the two that import it, and its `tsconfig.json` exists for editors.
  `erasableSyntaxOnly` forbids constructor parameter properties;
  `verbatimModuleSyntax` requires explicit `import type`.

## Commits

Small, one concern each, message style `area: what changed` in lowercase with
the reasoning in the body — read `git log` before writing one. Plan-doc updates
ride in the same commit as the code they track.
