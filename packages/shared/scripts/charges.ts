/**
 * What the charge tables actually mean, printed as odds and what failing costs.
 *
 *     bun packages/shared/scripts/charges.ts
 *
 * ⚠️ **The companion to `matchups.ts`, and it prints a different artefact
 * because charge is a different question.** Damage is tuned against
 * hits-to-kill; a charge is tuned against *the health a target has to be at
 * before the gamble is worth taking*, which is the odds column read against the
 * repel band beside it.
 *
 * ⚠️ **Printed on road**, where terrain adds nothing. Every other tile makes a
 * charge harder, and plains -- which is where units mostly stand -- costs the
 * attacker a point or two that this table deliberately does not show.
 *
 * ⚠️ **Head-on only, because 10a pins `directionalMultiplier` at 1.** A base
 * value wants checking at all three multipliers before it is trusted: one that
 * reads reasonable front-on can saturate at the flank and leave the rear
 * distinction doing nothing. `cavalry → artillery` is already automatic at 55
 * health head-on, which is deliberate and is the shape to watch for arriving
 * somewhere it was not intended.
 */
import { chargeChance, chargeThreshold } from '../src/combat';
import { CHARGE_REPEL, REPEL_DIVISOR } from '../src/data/combat';
import { makeState } from '../src/testing';
import type { UnitTypeId } from '../src/data/unitTypes';

const CHARGERS: UnitTypeId[] = ['cavalry', 'infantry'];
const TARGETS: UnitTypeId[] = ['infantry', 'cavalry', 'artillery'];
const HEALTHS = [100, 85, 70, 55, 40, 25];

const board = (attacker: UnitTypeId, defender: UnitTypeId, health: number) =>
  makeState(
    ['...', '.-.', '.-.'],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: attacker },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: defender, health },
    ],
  );

console.log(`odds to break, on road, head-on.  repel is flat + overshoot/${REPEL_DIVISOR}\n`);
console.log(`${''.padEnd(22)}${HEALTHS.map((h) => `${h}hp`.padStart(7)).join('')}   failing costs`);

for (const attacker of CHARGERS) {
  for (const defender of TARGETS) {
    if (chargeThreshold(attacker, defender) === null) continue;
    const odds = HEALTHS.map((health) => {
      const state = board(attacker, defender, health);
      return `${chargeChance(state, state.units[0], state.units[1])!}%`.padStart(7);
    });
    const repel = CHARGE_REPEL[defender];
    console.log(
      `${`${attacker} → ${defender}`.padEnd(22)}${odds.join('')}   ${repel}–${repel + 9}`,
    );
  }
}
