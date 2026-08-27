import type { MatchSummary } from '@aw/shared';
import { getJson, postJson } from './http';

// Not on GameServer: that interface is scoped to a single match, and listing
// or creating isn't. Plain functions rather than an interface -- there's only
// ever going to be one implementation of "call this endpoint".

export function listMatches(): Promise<MatchSummary[]> {
  return getJson<MatchSummary[]>('/matches');
}

export function createMatch(): Promise<MatchSummary> {
  return postJson<MatchSummary>('/matches');
}
