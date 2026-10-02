import { describe, expect, test } from 'bun:test';
import { glassPresets } from '../src/lib/ui/materials/presets';
import { defaultMaterialDrafts, readMaterialDrafts, sliderGroups, colorControls } from '../src/lib/ui/materials/tuning';

describe('material drafts', () => {
  test('every surface field is editable and drafts never mutate presets', () => {
    const keys = ['strokeAlignment', 'noiseBlend', 'noiseCoverage', ...colorControls.map(control => control.key), ...sliderGroups.flatMap(group => group.controls.map(control => control.key))];
    expect(keys.sort()).toEqual(Object.keys(glassPresets.materials.clear).sort());
    const draft = defaultMaterialDrafts();
    draft.materials.clear.fillOpacity = 80;
    expect(glassPresets.materials.clear.fillOpacity).toBe(5);
    expect(draft.fallbacks.clear.fillOpacity).toBe(5);
  });
  test('persisted drafts discard unknown fields and bound invalid numeric values', () => {
    const draft = readMaterialDrafts({ materials: { clear: { fillOpacity: 999, blur: NaN, depth: -1, strokeAlignment: 'wrong', noiseOpacity: -5, noiseScale: Infinity, noiseBlend: 'overlay', noiseCoverage: 'edges', unknown: true } }, fallbacks: { glassDark: { fillOpacity: 40 } } });
    expect(draft.materials.clear.fillOpacity).toBe(100);
    expect(draft.materials.clear.blur).toBe(2);
    expect(draft.materials.clear.depth).toBe(0);
    expect(draft.materials.clear.noiseOpacity).toBe(0);
    expect(draft.materials.clear.noiseScale).toBe(1);
    expect(draft.materials.clear.noiseBlend).toBe('soft-light');
    expect(draft.materials.clear.noiseCoverage).toBe('edges');
    expect(draft.materials.clear.strokeAlignment).toBe('external');
    expect(draft.fallbacks.glassDark.fillOpacity).toBe(40);
    expect('unknown' in draft.materials.clear).toBe(false);
    expect(readMaterialDrafts(null)).toEqual(defaultMaterialDrafts());
  });
});
