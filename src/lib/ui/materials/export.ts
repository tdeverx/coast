import { effectGroups, type ExperimentalEffects } from './experimental';
import type { GlassSurface, GlassVariant } from './presets';
import { colorControls } from './tuning';

/** Complete selected treatment, independent of theme tokens and editor-only state. */
export function exportMaterialPreset(
  variant: GlassVariant | 'temporary',
  surfaces: { materials: GlassSurface; fallbacks: GlassSurface },
  resolveColor: (value: string, mode: 'materials' | 'fallbacks') => string,
  effects?: ExperimentalEffects,
) {
  const concrete = (surface: GlassSurface, mode: 'materials' | 'fallbacks') => {
    const result = { ...surface };
    for (const { key } of colorControls) result[key] = resolveColor(result[key], mode);
    return result;
  };
  const experiment = effects ? { ...effects } : undefined;
  if (experiment) for (const { color } of effectGroups) experiment[color] = resolveColor(experiment[color], 'materials');
  return {
    format: 'coast-material-preset',
    version: 1,
    variant,
    materials: concrete(surfaces.materials, 'materials'),
    fallbacks: concrete(surfaces.fallbacks, 'fallbacks'),
    ...(experiment ? { effects: experiment } : {}),
  };
}
