import type { Command, GameEvent, GameState } from './types'

// The wire contract. Lives in shared because both sides need it: the server
// implements it in-process today and over HTTP later, and the client's HTTP
// implementation must not have to import the server package to know its shape.

export type CommandResult =
  | { ok: true; events: GameEvent[]; state: GameState }
  | { ok: false; reason: string }

export type UpdateListener = (events: GameEvent[], state: GameState) => void

export interface GameServer {
  /** Current authoritative state. Kept for debugging and one-off reads. */
  getState(): GameState

  /** Submit intent. Async from the first version -- sync-to-async is a
   *  retrofit that touches every call site. */
  submit(command: Command): Promise<CommandResult>

  /**
   * Register for state changes. Fires with current state as soon as it has
   * one -- synchronously for the in-process implementation, on connect for a
   * remote one. Never assume delivery before this call returns.
   *
   * The client applies state and events from HERE ONLY, never from submit()'s
   * return -- applying from both would animate the submitter's own events
   * twice. Returns an unsubscribe function.
   */
  subscribe(onUpdate: UpdateListener): () => void
}
