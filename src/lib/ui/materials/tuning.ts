import { glassPresets, type GlassSurface, type GlassVariant } from './presets';

type NumericKey = { [K in keyof GlassSurface]: GlassSurface[K] extends number ? K : never }[keyof GlassSurface];
export const materialNames: { value: GlassVariant; label: string }[] = [
  { value: 'clear', label: 'Clear glass' }, { value: 'clearBlur', label: 'Clear blur' },
  { value: 'glassLight', label: 'Glass light' }, { value: 'glassDark', label: 'Glass dark' },
  { value: 'blurLight', label: 'Blur light' }, { value: 'blurDark', label: 'Blur dark' },
];
export const sliderGroups: { title: string; controls: { key: NumericKey; label: string; min: number; max: number; step: number; unit: string }[] }[] = [
  { title: 'Fill and filter', controls: [
    { key: 'fillOpacity', label: 'Fill opacity', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'blur', label: 'Blur', min: 0, max: 60, step: .5, unit: 'px' },
    { key: 'saturation', label: 'Saturation', min: 0, max: 250, step: 1, unit: '%' },
    { key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, unit: '%' },
  ] },
  { title: 'Stroke', controls: [
    { key: 'strokeWidth', label: 'Stroke width', min: 0, max: 8, step: .25, unit: 'px' },
    { key: 'strokeOpacity', label: 'Stroke opacity', min: 0, max: 100, step: 1, unit: '%' },
  ] },
  ...(['top', 'bottom'] as const).map(side => ({ title: `${side === 'top' ? 'Top' : 'Bottom'} inner light`, controls: [
    { key: `${side}InnerWidth` as NumericKey, label: 'Width', min: 0, max: 30, step: .5, unit: 'px' },
    { key: `${side}InnerOpacity` as NumericKey, label: 'Opacity', min: 0, max: 100, step: 1, unit: '%' },
    { key: `${side}InnerSoftness` as NumericKey, label: 'Softness', min: 0, max: 30, step: .5, unit: 'px' },
  ] })),
  { title: 'Shadow', controls: [
    { key: 'shadowOffsetX', label: 'Horizontal offset', min: -40, max: 40, step: 1, unit: 'px' },
    { key: 'shadowOffsetY', label: 'Vertical offset', min: -40, max: 40, step: 1, unit: 'px' },
    { key: 'shadowOpacity', label: 'Shadow opacity', min: 0, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Texture', controls: [
    { key: 'noiseOpacity', label: 'Grain amount', min: 0, max: 100, step: .5, unit: '%' },
    { key: 'noiseScale', label: 'Grain scale', min: .25, max: 4, step: .05, unit: '×' },
  ] },
  { title: 'Refraction', controls: [
    { key: 'refraction', label: 'Refraction strength', min: 0, max: 2, step: .01, unit: '' },
    { key: 'depth', label: 'Depth', min: 0, max: 60, step: 1, unit: 'px' },
    { key: 'dispersion', label: 'Dispersion', min: 0, max: 1, step: .01, unit: '' },
  ] },
];
export const colorControls = [
  { key: 'noiseColor', label: 'Grain tint' },
  { key: 'tint', label: 'Fill tint' }, { key: 'strokeColor', label: 'Stroke color' },
  { key: 'topInnerColor', label: 'Top light color' }, { key: 'bottomInnerColor', label: 'Bottom light color' },
] as const;
export type MaterialDrafts = Record<'materials' | 'fallbacks', Record<GlassVariant, GlassSurface>>;
export function defaultMaterialDrafts(): MaterialDrafts {
  return {
    materials: Object.fromEntries(materialNames.map(({ value }) => [value, { ...glassPresets.materials[value] }])) as Record<GlassVariant, GlassSurface>,
    fallbacks: Object.fromEntries(materialNames.map(({ value }) => [value, { ...glassPresets.fallbacks[value] }])) as Record<GlassVariant, GlassSurface>,
  };
}
/** Read only known fields and bounded finite numbers from browser-local drafts. */
export function readMaterialDrafts(value: unknown): MaterialDrafts {
  const result = defaultMaterialDrafts();
  if (!value || typeof value !== 'object') return result;
  for (const layer of ['materials', 'fallbacks'] as const) {
    const group = (value as Record<string, unknown>)[layer];
    if (!group || typeof group !== 'object') continue;
    for (const { value: variant } of materialNames) {
      const source = (group as Record<string, unknown>)[variant];
      if (!source || typeof source !== 'object') continue;
      const fields = source as Record<string, unknown>;
      for (const { controls } of sliderGroups) for (const { key, min, max } of controls) {
        const number = fields[key];
        if (typeof number === 'number' && Number.isFinite(number)) result[layer][variant][key] = Math.min(max, Math.max(min, number));
      }
      for (const { key } of colorControls) {
        const color = fields[key];
        if (typeof color === 'string' && color.length <= 200) result[layer][variant][key] = color;
      }
      if (fields.noiseBlend === 'normal' || fields.noiseBlend === 'soft-light')
        result[layer][variant].noiseBlend = fields.noiseBlend;
      if (fields.noiseCoverage === 'uniform' || fields.noiseCoverage === 'edges')
        result[layer][variant].noiseCoverage = fields.noiseCoverage;
      if (fields.strokeAlignment === 'internal' || fields.strokeAlignment === 'external')
        result[layer][variant].strokeAlignment = fields.strokeAlignment;
    }
  }
  return result;
}
