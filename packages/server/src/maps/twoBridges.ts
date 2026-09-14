import type { GameMap } from './types';

/**
 * One river bent through a right angle, with a crossing on each arm.
 *
 * ⚠️ Deliberately puts **both deck orientations on one board**: the arm running
 * east to west is crossed by a road running north to south, and the arm running
 * north to south by a road running east to west. A bridge takes its orientation
 * from its strictly-road neighbours, so a board carrying only one of these
 * would leave half of `bridgeTurns` unexercised by anything anyone plays.
 */
export const twoBridges: GameMap = {
  id: 'two-bridges',
  name: 'Two Bridges',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '..........',
    '..-.......',
    '..-..ff...',
    '..-.......',
    '~~=~~~....',
    '..-..~....',
    '..---=-...',
    '..^..~....',
    '..^..~....',
    '..........',
  ],
};
