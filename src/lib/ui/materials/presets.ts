export const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter', 'plus-darker'] as const;
export type BlendMode = typeof blendModes[number];
export const blendOptions = blendModes.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }));

/** Glass materials, each paired with its blur fallback. */
const clear = {
  noiseOpacity: 0,
  noiseScale: 1,
  noiseColor: 'var(--white)',
  noiseBlend: 'soft-light',
  noiseTintBlend: 'multiply',
  noiseCoverage: 'uniform',
  noiseEdgeStart: 40,
  tint: 'var(--canvas)',
  fillOpacity: 0,
  blur: 2,
  saturation: 120,
  brightness: 90,
  strokeColor: 'var(--canvas)',
  strokeWidth: 0.25,
  strokeOpacity: 15,
  strokeAlignment: 'external',
  strokeBlend: 'normal',
  topInnerColor: 'var(--white)',
  topInnerWidth: 8,
  topInnerOpacity: 15,
  topInnerSoftness: 3,
  topInnerOffsetX: 0,
  topInnerSpread: -6,
  bottomInnerColor: 'var(--white)',
  bottomInnerWidth: 8,
  bottomInnerOpacity: 15,
  bottomInnerSoftness: 3,
  bottomInnerOffsetX: 0,
  bottomInnerSpread: -6,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 20,
  shadowColor: 'var(--canvas)',
  shadowBlur: 25,
  shadowSpread: -15,
  shadowPosition: 'outer',
  refraction: 1,
  depth: 25,
  dispersion: 0.15,
} as const;

const glassLight = {
  ...clear,
  tint: 'var(--white)',
  fillOpacity: 20,
  blur: 3,
  brightness: 110,
} as const;
const glassDark = {
  ...clear,
  fillOpacity: 40,
  blur: 3,
  brightness: 80,
} as const;
const glassProminent = {
  ...glassLight,
  tint: 'var(--accent)',
  fillOpacity: 50,
} as const;

export const glassPresets = {
  materials: { clear, glassLight, glassDark, glassProminent },
  fallbacks: {
    clear: { ...clear, refraction: 0 },
    glassLight: { ...glassLight, refraction: 0 },
    glassDark: { ...glassDark, refraction: 0 },
    glassProminent: { ...glassProminent, refraction: 0 },
  },
} as const;
export type GlassVariant = keyof typeof glassPresets.materials;

/** Editable physical parameters; preset literals remain the application defaults. */
export type GlassSurface = {
  -readonly [Key in keyof typeof clear]: Key extends 'strokeAlignment'
    ? 'internal' | 'external'
    : Key extends 'noiseBlend' | 'noiseTintBlend' | 'strokeBlend' ? BlendMode
    : Key extends 'noiseCoverage' ? 'uniform' | 'edges'
    : Key extends 'shadowPosition' ? 'outer' | 'inner'
    : (typeof clear)[Key] extends number ? number : string;
};
