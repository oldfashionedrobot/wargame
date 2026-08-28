import type { InStatement, InValue } from '@libsql/client';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Query } from 'drizzle-orm';
import { applyEvents, resolveAction, validateCommand } from '@vod/shared';
import type {
  Command,
  CommandResult,
  EventsResponse,
  MatchSummary,
  PlayerId,
  StateResponse,
} from '@vod/shared';
import type { Database } from './db';
import { createInitialState } from './initialState';
import { Matches, Resolutions } from './schema';

// Nothing deletes or expires matches yet, and anyone can create them, so the
// table only grows. A cap keeps the start screen bounded without pretending to
// be pagination -- which isn't worth building until matches are owned and
// there's a reason to look past the newest few.
const LIST_LIMIT = 50;

export interface MatchStore {
  create(): Promise<MatchSummary>;
  list(): Promise<MatchSummary[]>;
  snapshot(matchId: string): Promise<StateResponse | null>;
  since(matchId: string, from: number): Promise<EventsResponse | null>;
  submit(matchId: string, command: Command, actor: PlayerId): Promise<CommandResult>;
}

/**
 * Hands a Drizzle-built statement to the raw libSQL driver.
 *
 * Needed because `client.batch` takes a transaction mode and Drizzle's own
 * `batch` does not -- see submit. Drizzle types params as `unknown[]` since it
 * is dialect-agnostic; libSQL wants `InValue[]`. Every SQLite column type
 * Drizzle emits maps into libSQL's `Value` union, so the assertion is sound --
 * but it is an assertion, and this is the one place it lives.
 */
const bind = (query: Query): InStatement => ({
  sql: query.sql,
  args: query.params as InValue[],
});

export function createMatchStore({ db }: Database): MatchStore {
  // Return type is inferred from the schema rather than declared: the columns
  // are the source of truth for it, and a hand-written mirror is a second
  // thing to keep in step.
  async function loadMatch(matchId: string) {
    const [row] = await db
      .select({ state: Matches.currentState, seq: Matches.currentSeq })
      .from(Matches)
      .where(eq(Matches.id, matchId));
    return row ?? null;
  }

  return {
    async create() {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const state = createInitialState();

      await db.insert(Matches).values({
        id,
        createdAt,
        initialState: state,
        currentState: state,
        currentSeq: 0,
        currentTurn: state.currentTurn,
      });

      return { id, createdAt, seq: 0, currentTurn: state.currentTurn };
    },

    async list() {
      // No board parsing here -- current_turn is denormalised precisely so
      // listing stays cheap as matches accumulate.
      return db
        .select({
          id: Matches.id,
          createdAt: Matches.createdAt,
          seq: Matches.currentSeq,
          currentTurn: Matches.currentTurn,
        })
        .from(Matches)
        .orderBy(desc(Matches.createdAt))
        .limit(LIST_LIMIT);
    },

    async snapshot(matchId) {
      const match = await loadMatch(matchId);
      return match && { seq: match.seq, state: match.state };
    },

    async since(matchId, from) {
      const match = await loadMatch(matchId);
      if (!match) return null;

      const rows = await db
        .select({ events: Resolutions.events })
        .from(Resolutions)
        .where(and(eq(Resolutions.matchId, matchId), gt(Resolutions.seq, from)))
        .orderBy(Resolutions.seq);

      return {
        seq: match.seq,
        events: rows.flatMap((row) => row.events),
        state: match.state,
      };
    },

    async submit(matchId, command, actor) {
      const match = await loadMatch(matchId);
      if (!match) return { ok: false, reason: 'no such match' };

      // validateCommand is the only thing that can mint an Action, and it
      // stamps `actor` itself -- so a client-supplied `actor` in the JSON body
      // cannot survive, and resolveAction cannot be reached without this
      // having succeeded.
      const validation = validateCommand(match.state, command, actor);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const events = resolveAction(match.state, validation.action);

      // Reducers return events, not state. Folding them here is the only way a
      // new state is ever produced, so what gets stored and what a replay of
      // the log produces are the same computation.
      const nextState = applyEvents(match.state, events);
      const nextSeq = match.seq + 1;

      // Built by Drizzle, run by the raw driver. Drizzle's own batch() cannot
      // pass a transaction mode -- it always gets libSQL's default, `deferred`,
      // which starts as a read and upgrades on first write. `write` is BEGIN
      // IMMEDIATE: the lock is taken up front, so the upgrade cannot fail
      // partway through. Deliberate, and the reason this is not db.batch().
      //
      // Atomicity here is about crashes more than races: a process dying
      // between the two writes would leave the log one ahead of the
      // materialized state, and every later command would fail.
      //
      // Concurrent writers are caught for free -- two requests claiming the
      // same seq means one violates PRIMARY KEY (match_id, seq) and throws.
      // That needs a player submitting twice inside a single round trip, which
      // the client's in-flight guard prevents, so it is left to fail loudly
      // rather than be handled. A retry would go here.
      const [, updated] = await db.$client.batch(
        [
          db.insert(Resolutions).values({
            matchId,
            seq: nextSeq,
            actor,
            action: validation.action,
            events,
            createdAt: Date.now(),
          }),
          db
            .update(Matches)
            .set({
              currentState: nextState,
              currentSeq: nextSeq,
              currentTurn: nextState.currentTurn,
            })
            // Optimistic concurrency: refuse to write over a row that moved
            // since we read it.
            .where(and(eq(Matches.id, matchId), eq(Matches.currentSeq, match.seq))),
        ].map((query) => bind(query.toSQL())),
        'write',
      );

      // Unreachable while the log's primary key violates first, which is
      // exactly why it is worth asserting: an impossible condition that goes
      // unchecked is one nobody notices becoming possible.
      if (updated.rowsAffected !== 1) {
        throw new Error(`match ${matchId} moved underneath us at seq ${match.seq}`);
      }

      return { ok: true, seq: nextSeq, events, state: nextState };
    },
  };
}
