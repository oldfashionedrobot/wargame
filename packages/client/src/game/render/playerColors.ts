import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PlayerColor } from '@vod/shared';

/**
 * What a player's colour is, once.
 *
 * ⚠️ **Hex is the source and `Color3` is derived, not the other way round.**
 * The board wants floats and the DOM wants a string, and whichever is written
 * down is the one a person has to edit -- so it is the one every tool in the
 * world already speaks. `Color3(0.35, 0.6, 1)` is not a colour anybody can
 * picture or paste into a picker.
 *
 * ⚠️ **It exists because there were two of these and they disagreed.** The
 * board drew blue as `#5999ff` while the cutaway's health bar drew the same
 * player `#4a7fd4`, and red likewise -- near enough to look deliberate, far
 * enough apart that a unit changed colour when you looked at it closely. Two
 * literals of one idea do not stay equal; a derivation does.
 *
 * Chosen to read against the board rather than to be canonical blue and red:
 * the ground is a bright saturated teal, so darker colours sank into it. Green
 * is deliberately pushed toward lime -- a true green sits almost on top of the
 * grass, which matters the day there are four players.
 */
export const PLAYER_HEX: Record<PlayerColor, string> = {
  blue: '#5999ff',
  red: '#ff544d',
  green: '#99eb40',
  yellow: '#ffd940',
};

/** The same palette as the renderer wants it. */
export const PLAYER_COLORS: Record<PlayerColor, Color3> = {
  blue: Color3.FromHexString(PLAYER_HEX.blue),
  red: Color3.FromHexString(PLAYER_HEX.red),
  green: Color3.FromHexString(PLAYER_HEX.green),
  yellow: Color3.FromHexString(PLAYER_HEX.yellow),
};
