import type { GameMap } from './types';

/**
 * One river, bent through a right angle, and a road crossing each arm of it.
 *
 * The bend is the point: the west arm runs east–west and is crossed by a
 * north–south bridge, while the south arm runs north–south and is crossed by
 * an east–west one. So both bridge orientations appear on the same map, and the
 * water directly south of the east–west deck is the tile that has to render as
 * the bridge's underside rather than as open water.
 *
 * The river cuts the board into three, and the two bridges are the only way
 * between them for anything on hooves or wheels. Infantry can ford, which is
 * what makes holding a bridge a decision rather than a formality.
 */
export const twoBridges: GameMap = {
  id: 'two-bridges',
  name: 'Two Bridges',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  // rows[0] is the bottom of the screen.
  rows: [
    '......~..ff.',
    '......~.....',
    '...---=---..',
    '...-..~.....',
    '.ff-..~.....',
    '...-..~.....',
    '~~~=~~~.....',
    '...-...^^.ff',
    '...-...^^...',
    '...-........',
  ],
};
