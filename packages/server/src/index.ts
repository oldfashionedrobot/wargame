// The public surface of the authority. `http.ts` is the entry point and is run
// directly, not imported.

export { createMatch } from './match'
export type { LogEntry, Match } from './match'
export { createInitialState } from './initialState'
