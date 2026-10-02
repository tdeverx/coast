import { expect, test } from 'bun:test';
import { experimentalDefaults, effectGroups, readExperimentalEffects } from '../src/lib/ui/materials/experimental';

test('temporary effects all start disabled and expose every control', () => {
  const controls: string[] = effectGroups.flatMap(group => group.controls.map(control => control.key));
  expect(controls.sort()).toEqual(Object.keys(experimentalDefaults).sort());
  expect(Object.entries(experimentalDefaults).filter(([key]) => key.endsWith('Amount')).every(([, value]) => value === 0)).toBe(true);
  const draft = readExperimentalEffects({ sheenAmount: 999, edgeWidth: -10, frostBlur: Infinity, interactionAmount: 40, unknown: 5 });
  expect(draft.sheenAmount).toBe(100);
  expect(draft.edgeWidth).toBe(.25);
  expect(draft.frostBlur).toBe(8);
  expect(draft.interactionAmount).toBe(40);
  expect('unknown' in draft).toBe(false);
  expect(experimentalDefaults.interactionAmount).toBe(0);
  expect(readExperimentalEffects(null)).toEqual(experimentalDefaults);
});
