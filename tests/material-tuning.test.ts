import { describe, expect, test } from 'bun:test';
import { blendModes, glassPresets } from '../src/lib/ui/materials/presets';
import { materialNames, defaultMaterialDrafts, readMaterialDrafts, sliderGroups, colorControls } from '../src/lib/ui/materials/tuning';

describe('material drafts', () => {
  test('four materials are exposed, each with its own blur fallback', () => {
    expect(materialNames.map(entry => entry.value)).toEqual(['clear', 'glassLight', 'glassDark', 'glassProminent']);
    expect(Object.keys(glassPresets.materials)).toEqual(Object.keys(glassPresets.fallbacks));
    for (const entry of materialNames) {
      expect(glassPresets.fallbacks[entry.value].refraction).toBe(0);
      expect(glassPresets.fallbacks[entry.value].blur).toBeGreaterThan(glassPresets.materials[entry.value].blur);
    }
  });
  test('prominent glass uses the theme accent and remains independently editable', () => {
    const drafts = defaultMaterialDrafts();
    expect(drafts.materials.glassProminent.tint).toBe('var(--accent)');
    drafts.materials.glassProminent.tint = '#ff0000';
    expect(drafts.fallbacks.glassProminent.tint).toBe('var(--accent)');
    expect(drafts.materials.glassDark.tint).not.toBe('#ff0000');
  });
  test('every surface field is editable and drafts never mutate presets', () => {
    const keys = ['strokeAlignment', 'strokeBlend', 'shadowPosition', 'noiseBlend', 'noiseTintBlend', 'noiseCoverage', ...colorControls.map(control => control.key), ...sliderGroups.flatMap(group => group.controls.map(control => control.key))];
    expect(keys.sort()).toEqual(Object.keys(glassPresets.materials.clear).sort());
    const draft = defaultMaterialDrafts();
    draft.materials.clear.fillOpacity = 80;
    expect(glassPresets.materials.clear.fillOpacity).toBe(5);
    expect(draft.fallbacks.clear.fillOpacity).toBe(5);
  });
  test('persisted drafts discard unknown fields and bound invalid numeric values', () => {
    const draft = readMaterialDrafts({ materials: { clear: { fillOpacity: 999, blur: NaN, depth: -1, strokeAlignment: 'wrong', shadowBlur: -10, shadowSpread: -999, shadowColor: '#123456', shadowPosition: 'inner', noiseOpacity: -5, noiseScale: Infinity, noiseBlend: 'overlay', noiseTintBlend: 'invalid', noiseCoverage: 'edges', unknown: true } }, fallbacks: { glassDark: { fillOpacity: 40 } } });
    expect(draft.materials.clear.fillOpacity).toBe(100);
    expect(draft.materials.clear.blur).toBe(2);
    expect(draft.materials.clear.depth).toBe(0);
    expect(draft.materials.clear.noiseOpacity).toBe(0);
    expect(draft.materials.clear.noiseScale).toBe(1);
    expect(draft.materials.clear.noiseBlend).toBe('overlay');
    expect(draft.materials.clear.noiseTintBlend).toBe('multiply');
    expect(draft.materials.clear.shadowBlur).toBe(0);
    expect(draft.materials.clear.shadowSpread).toBe(-40);
    expect(draft.materials.clear.shadowColor).toBe('#123456');
    expect(draft.materials.clear.shadowPosition).toBe('inner');
    expect(draft.materials.clear.noiseCoverage).toBe('edges');
    expect(draft.materials.clear.strokeAlignment).toBe('external');
    expect(draft.fallbacks.glassDark.fillOpacity).toBe(40);
    expect('unknown' in draft.materials.clear).toBe(false);
    expect(readMaterialDrafts(null)).toEqual(defaultMaterialDrafts());
  });
  test('all offered blend modes survive saved drafts', () => {
    for (const blend of blendModes) {
      const draft = readMaterialDrafts({ materials: { clear: { noiseBlend: blend, noiseTintBlend: blend, strokeBlend: blend } } });
      expect(draft.materials.clear.noiseBlend).toBe(blend);
      expect(draft.materials.clear.noiseTintBlend).toBe(blend);
      expect(draft.materials.clear.strokeBlend).toBe(blend);
    }
  });
});
