import type { GameMap } from './types';

/**
 * Drawn after Advance Wars: Dual Strike's *Little Lion*. The armies start in
 * opposite corners, with a ridge and a lake in each of the other two, and one
 * road from each army meeting in the middle. Each half is the other turned,
 * so the zones are declared toward the corners.
 */
export const littleLion: GameMap = {
  id: 'little-lion-16',
  name: 'Little Lion',
  rows: [
    '.-..............',
    '.-..............',
    '.-....ff...www..',
    '.-..^.ff..wwwww.',
    '.-..^.....wwwww.',
    '.-..^....#wwww..',
    '.-#.^^^^...ww...',
    '.-------........',
    '.......--------.',
    '...ww...^^^^.#-.',
    '..wwww#....^..-.',
    '.wwwww.....^..-.',
    '.wwwww..ff.^..-.',
    '..www...ff....-.',
    '..............-.',
    '..............-.',
  ],
  zoneStarts: [0, 6],
};
