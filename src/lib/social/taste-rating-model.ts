import type { TasteDimension, TasteFeatures } from './taste-profile';

const featureWeights: Partial<Record<TasteDimension, number>> = {
  genres: 0.22, tags: 0.65, themes: 0.85, cast: 0.8, directors: 1.2, writers: 1,
  artists: 1.3, franchises: 1.6, developers: 1.2, mechanics: 0.5,
};
const dimensions = Object.entries(featureWeights) as [TasteDimension, number][];
const minRatedTitles = 40;
const maxWeights = 512;
type Term = { key: string; weight: number; pair?: true };
type RatingWeights = Record<string, number>;
export type TasteRatingTerm = { name: string; points: number };

function terms(features: TasteFeatures, names?: Map<string, string>): Term[] {
  const terms = new Map<string, Term>();
  for (const [dimension, weight] of dimensions) {
    const limit = dimension === 'tags' ? 12 : dimension === 'cast' ? 14 : 8;
    const available = features[dimension] ?? [];
    const entries = (dimension === 'artists' ? available.filter(feature => !feature.id.startsWith('artist-name:')) : available).slice(0, limit);
    const singleWeight = weight / Math.sqrt(Math.max(1, entries.length));
    for (const { id, name } of entries) {
      const key = `${dimension}:${id}`;
      terms.set(key, { key, weight: singleWeight });
      names?.set(key, name);
    }
  }
  const genres = features.genres?.slice(0, 4) ?? [];
  const subjects = [...features.tags ?? [], ...features.themes ?? []].slice(0, 10);
  const pairs = new Set<string>();
  for (const [index, genre] of genres.entries()) {
    for (const other of genres.slice(index + 1)) {
      if (other.id === genre.id) continue;
      const key = JSON.stringify([genre.id, other.id].sort());
      pairs.add(key);
      names?.set(key, `${genre.name} + ${other.name}`);
    }
    for (const subject of subjects) {
      if (subject.name.toLowerCase() === genre.name.toLowerCase()) continue;
      const key = JSON.stringify([genre.id, subject.id, 'subject']);
      pairs.add(key);
      names?.set(key, `${genre.name} + ${subject.name}`);
    }
  }
  const pairWeight = 0.4 / Math.sqrt(Math.max(1, pairs.size));
  for (const key of pairs) terms.set(key, { key, weight: pairWeight, pair: true });
  return [...terms.values()];
}

/** Fit stated opinions jointly. The saved reference keeps coefficients, never rated titles. */
export function createTasteRatingTrainer(ratingCount: number, median: number | null) {
  const observations: { value: number; positions: Uint32Array; weights: Float64Array }[] = [];
  const support = new Map<string, { position: number; count: number; minimum: number }>();
  return {
    add(rating: number | null, features: TasteFeatures) {
      if (rating === null || median === null || ratingCount < minRatedTitles) return;
      const inputs = terms(features);
      if (!inputs.length) return;
      const positions = new Uint32Array(inputs.length);
      const weights = new Float64Array(inputs.length);
      for (const [i, { key, pair, weight }] of inputs.entries()) {
        let entry = support.get(key);
        if (!entry) {
          entry = { position: support.size, count: 0, minimum: pair ? 5 : 3 };
          support.set(key, entry);
        }
        entry.count++;
        positions[i] = entry.position;
        weights[i] = weight;
      }
      observations.push({ value: Math.max(-1.5, Math.min(1.5, rating - median)), positions, weights });
    },
    async fit(): Promise<RatingWeights | undefined> {
      if (observations.length < minRatedTitles || !observations.some(row => row.value > 0) || !observations.some(row => row.value < 0)) return;
      const selected = new Int32Array(support.size).fill(-1);
      const keys: string[] = [];
      for (const [key, { position, count, minimum }] of support) {
        if (count < minimum) continue;
        selected[position] = keys.length;
        keys.push(key);
      }
      if (!keys.length) return;
      const average = observations.reduce((total, row) => total + row.value, 0) / observations.length;
      const weights = new Float64Array(keys.length);
      const accepted = new Float64Array(keys.length);
      const gradient = new Float64Array(keys.length);
      const scale = 25 / observations.length;
      const penalty = 0.35;
      let stepSize = 0.13;
      let lastLoss = Infinity;
      for (let step = 0; step <= 36; step++) {
        if (observations.length > 2500 && step % 4 === 0)
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        gradient.fill(0);
        let squaredErrors = 0;
        for (const { value, positions, weights: inputs } of observations) {
          let error = average - value;
          for (let i = 0; i < positions.length; i++) {
            const position = selected[positions[i]];
            if (position >= 0) error += inputs[i] * weights[position];
          }
          for (let i = 0; i < positions.length; i++) {
            const position = selected[positions[i]];
            if (position >= 0) gradient[position] += error * inputs[i];
          }
          squaredErrors += error * error;
        }
        const loss = scale * squaredErrors + penalty * weights.reduce((sum, weight) => sum + weight * weight, 0);
        if (loss > lastLoss) {
          // Very similar ratings cohorts can require a smaller step than a varied catalogue.
          stepSize *= 0.5;
          for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] + accepted[i]) / 2;
          continue;
        }
        lastLoss = loss;
        accepted.set(weights);
        for (let i = 0; i < weights.length; i++)
          weights[i] -= stepSize * (scale * gradient[i] + penalty * weights[i]);
      }
      const fitted = keys.map((key, position) => [key, Math.round(accepted[position] * 10000) / 10000] as const)
        .filter(([, weight]) => weight !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0])).slice(0, maxWeights);
      return fitted.length ? Object.fromEntries(fitted) : undefined;
    },
  };
}

/** This deliberately cannot supply the evidence needed to admit an otherwise unknown match. */
export function tasteRatingAdjustment(ratingWeights: RatingWeights | undefined, features: TasteFeatures, inputs?: TasteRatingTerm[]) {
  if (!ratingWeights) return 0;
  const names = inputs ? new Map<string, string>() : undefined;
  let fit = 0;
  for (const { key, weight } of terms(features, names)) {
    if (!Object.hasOwn(ratingWeights, key)) continue;
    const value = ratingWeights[key] * weight;
    fit += value;
    const name = names?.get(key);
    if (name && value) inputs?.push({ name, points: 16 * value });
  }
  return Math.round(16 * Math.max(-0.5, Math.min(0.5, fit)));
}
