import { applyAction } from '@aw/shared'
import type {
  Action,
  Command,
  CommandResult,
  EventsResponse,
  GameEvent,
  GameState,
  PlayerId,
  StateResponse,
} from '@aw/shared'
import type { Database } from './db'
import { createInitialState } from './initialState'

// Nothing deletes or expires matches yet, and anyone can create them, so the
// table only grows. A cap keeps the start screen bounded without pretending to
// be pagination -- which isn't worth building until matches are owned and
// there's a reason to look past the newest few.
const LIST_LIMIT = 50

/** What the start screen needs to render a match without loading its state. */
export interface MatchSummary {
  id: string
  createdAt: number
  seq: number
  currentTurn: PlayerId
}

export interface MatchStore {
  create(): Promise<MatchSummary>
  list(): Promise<MatchSummary[]>
  snapshot(matchId: string): Promise<StateResponse | null>
  since(matchId: string, from: number): Promise<EventsResponse | null>
  submit(matchId: string, command: Command, actor: PlayerId): Promise<CommandResult>
}

interface MatchRow {
  state: GameState
  seq: number
}

export function createMatchStore({ client: db }: Database): MatchStore {
  async function loadMatch(matchId: string): Promise<MatchRow | null> {
    const { rows } = await db.execute({
      sql: 'SELECT current_state, current_seq FROM matches WHERE id = ?',
      args: [matchId],
    })
    const row = rows[0]
    if (!row) return null
    return {
      state: JSON.parse(row.current_state as string) as GameState,
      seq: Number(row.current_seq),
    }
  }

  return {
    async create() {
      const id = crypto.randomUUID()
      const createdAt = Date.now()
      const state = createInitialState()
      // Written once and never read back yet -- deliberately. initial_state
      // plus the log is a complete history; without it the log is deltas with
      // no anchor, and it cannot be reconstructed after the fact. Cheap to
      // keep, impossible to backfill.
      const serialized = JSON.stringify(state)

      await db.execute({
        sql: `INSERT INTO matches
                (id, created_at, initial_state, current_state, current_seq, current_turn)
              VALUES (?, ?, ?, ?, 0, ?)`,
        args: [id, createdAt, serialized, serialized, state.currentTurn],
      })

      return { id, createdAt, seq: 0, currentTurn: state.currentTurn }
    },

    async list() {
      const { rows } = await db.execute(
        `SELECT id, created_at, current_seq, current_turn
           FROM matches
          ORDER BY created_at DESC
          LIMIT ${LIST_LIMIT}`,
      )
      // No board parsing here -- current_turn is denormalised precisely so
      // listing stays cheap as matches accumulate.
      return rows.map((row) => ({
        id: row.id as string,
        createdAt: Number(row.created_at),
        seq: Number(row.current_seq),
        currentTurn: row.current_turn as PlayerId,
      }))
    },

    async snapshot(matchId) {
      const match = await loadMatch(matchId)
      return match && { seq: match.seq, state: match.state }
    },

    async since(matchId, from) {
      const match = await loadMatch(matchId)
      if (!match) return null

      const { rows } = await db.execute({
        sql: 'SELECT events FROM log_entries WHERE match_id = ? AND seq > ? ORDER BY seq',
        args: [matchId, from],
      })

      return {
        seq: match.seq,
        events: rows.flatMap((row) => JSON.parse(row.events as string) as GameEvent[]),
        state: match.state,
      }
    },

    async submit(matchId, command, actor) {
      const match = await loadMatch(matchId)
      if (!match) return { ok: false, reason: 'no such match' }

      // `actor` is assigned AFTER the spread, so a client-supplied `actor` in
      // the JSON body is overwritten rather than honoured. Swapping these two
      // would be a privilege escalation the type system cannot catch.
      const action: Action = { ...command, actor }

      const result = applyAction(match.state, action)
      if (!result.ok) return { ok: false, reason: result.reason }

      const nextSeq = match.seq + 1

      // Both writes in one atomic round trip. This is about crashes more than
      // races: a process dying between them would leave the log one ahead of
      // the materialized state, and every later command would then fail.
      //
      // It also catches concurrent writers for free -- two requests claiming
      // the same seq means one violates PRIMARY KEY (match_id, seq) and
      // throws. That needs a player submitting twice inside a single round
      // trip, which the client's in-flight guard prevents, so it is left to
      // fail loudly rather than be handled. A retry would go here.
      await db.batch(
        [
          {
            sql: `INSERT INTO log_entries (match_id, seq, action, events, created_at)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              matchId,
              nextSeq,
              JSON.stringify(action),
              JSON.stringify(result.events),
              Date.now(),
            ],
          },
          {
            sql: `UPDATE matches
                     SET current_state = ?, current_seq = ?, current_turn = ?
                   WHERE id = ? AND current_seq = ?`,
            args: [
              JSON.stringify(result.state),
              nextSeq,
              result.state.currentTurn,
              matchId,
              match.seq,
            ],
          },
        ],
        'write',
      )

      return { ok: true, seq: nextSeq, events: result.events, state: result.state }
    },
  }
}
