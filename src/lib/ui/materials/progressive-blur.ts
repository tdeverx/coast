export const progressiveBlurSteps = { min: 1, max: 24, default: 7 } as const;
export const progressiveTintSteps = { min: 2, max: 24, default: 8 } as const;

// The default profile has overlapping ramps and closely spaced low radii to
// preserve detail at the clear end. Resampling keeps coverage at every count.
const starts = [0, 8, 19, 32, 46, 60, 73, 100];
const ends = [0, 25, 40, 54, 67, 79, 90, 100];
const strengths = [0, 0.035, 0.085, 0.16, 0.28, 0.45, 0.68, 1];
const tintPositions = [0, 14, 28, 45, 60, 74, 89, 100];
const tintOpacities = [0, 0.025, 0.1, 0.25, 0.45, 0.68, 0.88, 1];

function sample(values: number[], position: number) {
  const lower = Math.floor(position);
  return values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower);
}

function stepCount(steps: number, { min, max, default: fallback }: { min: number; max: number; default: number }) {
  return Number.isFinite(steps) ? Math.min(max, Math.max(min, Math.round(steps))) : fallback;
}

export function progressiveBlurBands(steps: number) {
  const count = stepCount(steps, progressiveBlurSteps);
  const defaultSteps = progressiveBlurSteps.default;

  return Array.from({ length: count }, (_, index) => {
    const start = index * defaultSteps / count;
    const end = (index + 1) * defaultSteps / count;
    return { start: sample(starts, start), end: sample(ends, end), strength: sample(strengths, end) };
  });
}

export function progressiveTintStops(steps: number) {
  const count = stepCount(steps, progressiveTintSteps);
  const intervals = tintPositions.length - 1;

  return Array.from({ length: count }, (_, index) => {
    const position = index * intervals / (count - 1);
    return `rgb(0 0 0 / ${sample(tintOpacities, position)}) ${sample(tintPositions, position)}%`;
  }).join(', ');
}
