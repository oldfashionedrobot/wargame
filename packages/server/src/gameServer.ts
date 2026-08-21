import { applyAction } from '@aw/shared'
import type {
  Action,
  Command,
  CommandResult,
  GameServer,
  GameState,
  UpdateListener,
} from '@aw/shared'

// The authority. Holds the only mutable GameState reference in the process;
// everyone else gets immutable snapshots handed to them.
//
// In-process for now, so submit() resolves immediately. Phase 3 replaces this
// with an HTTP implementation of the same interface and nothing above it
// changes.
export function createLocalGameServer(initial: GameState): GameServer {
  let state = initial
  const listeners = new Set<UpdateListener>()

  // Hot-seat concession: one connection drives both players, so the server
  // can't tell them apart and stamps whoever's turn it is. This is where a
  // connection -> player lookup goes once clients have identities, and it is
  // deliberately the ONLY place `actor` is set -- a client cannot supply one.
  //
  // ORDER MATTERS: `actor` is assigned AFTER the spread, so a client-supplied
  // `actor` is overwritten rather than honoured. In phase 3 commands arrive as
  // untyped JSON and can carry any field they like; swapping these two lines
  // would be a privilege escalation that the type system cannot catch.
  const authenticate = (command: Command): Action => ({
    ...command,
    actor: state.currentTurn,
  })

  return {
    getState() {
      return state
    },

    async submit(command) {
      const result = applyAction(state, authenticate(command))
      if (!result.ok) {
        return { ok: false, reason: result.reason } satisfies CommandResult
      }

      state = result.state
      for (const listener of listeners) listener(result.events, state)
      return { ok: true, events: result.events, state } satisfies CommandResult
    },

    subscribe(onUpdate) {
      listeners.add(onUpdate)
      onUpdate([], state) // so a subscriber needs no separate initial fetch
      return () => listeners.delete(onUpdate)
    },
  }
}
