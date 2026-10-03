export const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter', 'plus-darker'] as const;
export type BlendMode = typeof blendModes[number];
export const blendOptions = blendModes.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }));

// Static monochrome grain is optional and shared by native glass and CSS fallbacks.
const texture = {
  noiseOpacity: 0,
  noiseScale: 1,
  noiseColor: 'var(--white)',
  noiseBlend: 'soft-light',
  noiseTintBlend: 'multiply',
  noiseCoverage: 'uniform',
  noiseEdgeStart: 40,
} as const;

/** Glass materials, each paired with its blur fallback. */
const clear = {
  ...texture,
  tint: 'var(--canvas)',
  fillOpacity: 5,
  blur: 2,
  saturation: 120,
  brightness: 100,
  strokeColor: 'var(--canvas)',
  strokeWidth: 0.25,
  strokeOpacity: 20,
  strokeAlignment: 'external',
  strokeBlend: 'soft-light',
  topInnerColor: 'var(--white)',
  topInnerWidth: 6,
  topInnerOpacity: 20,
  topInnerSoftness: 4,
  topInnerOffsetX: 0,
  topInnerSpread: -4,
  bottomInnerColor: 'var(--white)',
  bottomInnerWidth: 7,
  bottomInnerOpacity: 10,
  bottomInnerSoftness: 5,
  bottomInnerOffsetX: 0,
  bottomInnerSpread: -5,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 10,
  shadowColor: 'var(--canvas)',
  shadowBlur: 15,
  shadowSpread: 0,
  shadowPosition: 'outer',
  refraction: 1,
  depth: 30,
  dispersion: 0.5,
} as const;

const glassDark = {
  ...texture,
  tint: 'color-mix(in srgb, var(--surface) 80%, var(--canvas))',
  fillOpacity: 56,
  blur: 18,
  saturation: 130,
  brightness: 78,
  strokeColor: 'var(--white)',
  strokeWidth: 1,
  strokeOpacity: 16,
  strokeAlignment: 'internal',
  strokeBlend: 'soft-light',
  topInnerColor: 'var(--white)',
  topInnerWidth: 1,
  topInnerOpacity: 7,
  topInnerSoftness: 2,
  topInnerOffsetX: 0,
  topInnerSpread: -2,
  bottomInnerColor: 'var(--white)',
  bottomInnerWidth: 1,
  bottomInnerOpacity: 7,
  bottomInnerSoftness: 2,
  bottomInnerOffsetX: 0,
  bottomInnerSpread: -2,
  shadowOffsetX: 0,
  shadowOffsetY: 8,
  shadowOpacity: 24,
  shadowColor: 'var(--canvas)',
  shadowBlur: 15,
  shadowSpread: 0,
  shadowPosition: 'outer',
  refraction: 0.5,
  depth: 12,
  dispersion: 0.04,
} as const;

const glassLight = {
  ...glassDark,
  tint: 'var(--white)',
  fillOpacity: 54,
  saturation: 120,
  brightness: 108,
  strokeOpacity: 34,
  topInnerOpacity: 32,
  bottomInnerOpacity: 32,
  shadowOpacity: 16,
} as const;
const glassProminent = {
  ...glassDark,
  tint: 'var(--accent)',
  fillOpacity: 48,
  brightness: 100,
  shadowOpacity: 20,
} as const;
const darkFallback = { ...glassDark, fillOpacity: 68, blur: 24, saturation: 120 };
const lightFallback = {
  ...glassLight,
  fillOpacity: 62,
  blur: 24,
  saturation: 115,
  brightness: 104,
  topInnerOpacity: 24,
  bottomInnerOpacity: 24,
};
export const glassPresets = {
  materials: { clear, glassLight, glassDark, glassProminent },
  fallbacks: {
    clear: { ...clear, blur: 12, refraction: 0 },
    glassLight: { ...lightFallback, refraction: 0 },
    glassDark: { ...darkFallback, refraction: 0 },
    glassProminent: { ...glassProminent, fillOpacity: 64, blur: 24, saturation: 120, refraction: 0 },
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
