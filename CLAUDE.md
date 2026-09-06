# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The spec comes first

`.plan/architecture.md` is the single running spec — architecture, invariants,
combat design, roadmap, all marked ✅ built · 🚧 partial · ⬜ not built. Read
the relevant section before changing anything structural, and **update the doc
in the same commit as the code it describes**. It keeps no decision history;
scratch docs (like the former `phase-5a-decisions.md`) get absorbed into it and
deleted when their increment lands.

## Commands

| | |
|---|---|
| `bun run dev` | Vite (5173) + server (3001); `/api` is proxied, same-origin everywhere |
| `bun run test` | `bun test` for shared+server, then Vitest for client |
| `bun run typecheck` | `tsc -b` — but see the stale-cache trap below |
| `bun run lint` / `bun run build` / `bun run format:check` | all exit non-zero on failure |
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
`server/` is the authority (owns the DB, generates rolls, keeps the event log),
`client/` is presentation. Installs are isolated, so a stray `import 'react'`
in server code is a resolution error, not a review catch. Cross-package imports
go through the `@vod/shared` barrel only, never into files; `server/` is an
app, not a library — no barrel, `http.ts` is the entry point.

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
body is `{ error: string }`.

## Traps that bit before

- **`db:*` scripts run from the repo root.** `file:` URLs in `DATABASE_URL`
  resolve differently for the server (explicit `REPO_ROOT`) and drizzle-kit
  (cwd) — converting those scripts to `bun run --filter` silently creates a
  second empty database beside the real one.
- **One `.env`, at the repo root.** Bun doesn't walk up; server scripts pass
  `--env-file=../../.env` explicitly.
- **Don't assert on transport-failure message text** in client tests — assert
  the error's kind/type. The wording belongs to the server (`ErrorResponse`
  body passthrough) and changes without the failure mode changing.
- **`http.test.ts` is a black box** over real `fetch` against `createServer`.
  Keep it that way — it survived a routing rewrite untouched precisely because
  nothing in it knows how URLs dispatch.
- `strict` is on everywhere; `erasableSyntaxOnly` forbids constructor parameter
  properties; `verbatimModuleSyntax` requires explicit `import type`.

## Commits

Small, one concern each, message style `area: what changed` in lowercase with
the reasoning in the body — read `git log` before writing one. Plan-doc updates
ride in the same commit as the code they track.
