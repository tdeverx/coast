import { effectGroups, type ExperimentalEffects } from './experimental';
import type { GlassSurface, GlassVariant } from './presets';
import { colorControls } from './tuning';

/** Complete selected treatment, independent of theme tokens and editor-only state. */
export function exportMaterialPreset(
  variant: GlassVariant | 'temporary',
  surfaces: { materials: GlassSurface; fallbacks: GlassSurface },
  resolveColor: (value: string) => string,
  effects?: ExperimentalEffects,
) {
  const concrete = (surface: GlassSurface) => {
    const result = { ...surface };
    for (const { key } of colorControls) result[key] = resolveColor(result[key]);
    return result;
  };
  const experiment = effects ? { ...effects } : undefined;
  if (experiment) for (const { color } of effectGroups) experiment[color] = resolveColor(experiment[color]);
  return {
    format: 'coast-material-preset',
    version: 1,
    variant,
    materials: concrete(surfaces.materials),
    fallbacks: concrete(surfaces.fallbacks),
    ...(experiment ? { effects: experiment } : {}),
  };
}
