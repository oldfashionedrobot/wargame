/**
 * What the charge tables actually mean, printed as the most health each charge
 * executes.
 *
 *     bun packages/shared/scripts/charges.ts
 *
 * ⚠️ **The companion to `matchups.ts`, and it prints a different artefact
 * because charge is a different question.** Damage is tuned against
 * hits-to-kill; a charge is a sure execute, so it is tuned against *how worn
 * down a target has to be before a charge will finish it* -- and that line
 * falls with the charger's own health, which is why it gets a column per
 * health rather than one number.
 *
 * ⚠️ **Printed on every distinct depth of cover, and from all three sides.**
 * Each scales the line, and a value that reads reasonable from one side can
 * reach a full-health target from another -- the dead dial `charge.test.ts`
 * guards against, visible here before it is a failure there. One block per
 * star count rather than per terrain: road, bridge, plains and river are all 0
 * and would print four identical tables.
 */
import { chargeReach, hasChargeMeter } from '../src/combat';
import { TERRAIN } from '../src/data/terrain';
import { makeState } from '../src/testing';
import type { UnitTypeId } from '../src/data/unitTypes';

const TYPES: UnitTypeId[] = ['infantry', 'cavalry', 'artillery'];
const HEALTHS = [100, 85, 70, 55, 40, 25];

/**
 * ⚠️ The **defender's** facing decides the side, so the approach is set by
 * turning the target rather than by moving the attacker: `south` looks straight
 * at a charger coming from the south, `north` looks away, `east` takes it on
 * the flank.
 */
const FACING = { 'head-on': 'south', flank: 'east', rear: 'north' } as const;

const board = (
  attacker: UnitTypeId,
  attackerHealth: number,
  defender: UnitTypeId,
  facing: (typeof FACING)[keyof typeof FACING],
  ground: string,
) =>
  makeState(
    ['...', '.-.', `.${ground}.`],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: attacker, health: attackerHealth },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: defender, facing },
    ],
  );

/**
 * One representative tile per distinct star count, named by everything that
 * shares it.
 *
 * ⚠️ **Grouped rather than listed, so the print-out cannot go stale.** Terrains
 * that share a `defense` are indistinguishable to a charge, and printing each
 * of them separately would be four identical tables today and a silently
 * missing one the day a terrain is added.
 */
const COVER = [...new Set(Object.values(TERRAIN).map((g) => g.defense))]
  .sort((a, b) => a - b)
  .map((stars) => {
    const sharing = Object.entries(TERRAIN).filter(([, g]) => g.defense === stars);
    return { stars, char: sharing[0][1].char, names: sharing.map(([name]) => name).join(', ') };
  });

const CELL = 8;
console.log('the most health a charge executes, by the charger’s own health\n');

for (const { stars, char, names } of COVER) {
  console.log(`\n${stars} ${stars === 1 ? 'star' : 'stars'} — ${names}`);
  for (const [approach, facing] of Object.entries(FACING)) {
    console.log(`  ${approach}`);
    console.log(`${''.padEnd(24)}${HEALTHS.map((h) => `${h}hp`.padStart(CELL)).join('')}`);
    for (const attacker of TYPES.filter(hasChargeMeter)) {
      for (const defender of TYPES) {
        const cells = HEALTHS.map((health) => {
          const state = board(attacker, health, defender, facing, char);
          return String(chargeReach(state, state.units[0], state.units[1])).padStart(CELL);
        });
        console.log(`${`${attacker} → ${defender}`.padEnd(24)}${cells.join('')}`);
      }
    }
  }
}
