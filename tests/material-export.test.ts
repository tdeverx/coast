import { expect, test } from 'bun:test';
import { exportMaterialPreset } from '../src/lib/ui/materials/export';
import { defaultMaterialDrafts, colorControls } from '../src/lib/ui/materials/tuning';
import { experimentalDefaults, effectGroups } from '../src/lib/ui/materials/experimental';

test('export captures the complete selected treatment and resolves every layer color', () => {
  const drafts = defaultMaterialDrafts();
  const surfaces = { materials: drafts.materials.glassDark, fallbacks: drafts.fallbacks.glassDark };
  surfaces.materials.shadowSpread = 12;
  surfaces.fallbacks.noiseBlend = 'screen';
  const exported = exportMaterialPreset('temporary', surfaces, () => 'rgb(18, 52, 86)', experimentalDefaults);
  expect(exported.format).toBe('coast-material-preset');
  expect(exported.version).toBe(1);
  expect(exported.materials.shadowSpread).toBe(12);
  expect(exported.fallbacks.noiseBlend).toBe('screen');
  expect(Object.keys(exported.materials).sort()).toEqual(Object.keys(surfaces.materials).sort());
  for (const { key } of colorControls) {
    expect(exported.materials[key]).toBe('rgb(18, 52, 86)');
    expect(exported.fallbacks[key]).toBe('rgb(18, 52, 86)');
  }
  for (const { color } of effectGroups) expect(exported.effects?.[color]).toBe('rgb(18, 52, 86)');
  expect(surfaces.materials.tint).toContain('var(');
  expect(experimentalDefaults.sheenColor).toBe('var(--white)');
  expect(exportMaterialPreset('glassDark', surfaces, value => value)).not.toHaveProperty('effects');
});
