import type { TasteDimension, TasteFeature, TasteFeatures } from './taste-profile';
import type { CatalogueFacts } from '#lib/providers/contracts.js';

const featureWeights: Partial<Record<TasteDimension, number>> = {
  genres: 1, tags: 0.9, themes: 0.85, cast: 0.8, directors: 1.2, writers: 1,
  artists: 1.3, franchises: 1.6, developers: 1.2, mechanics: 0.5,
};
const dimensions = Object.entries(featureWeights) as [TasteDimension, number][];
export function isDescriptiveTasteDimension(dimension: TasteDimension) {
  return dimension === 'genres' || dimension === 'tags' || dimension === 'themes';
}
const descriptiveDimensions = dimensions.filter(([dimension]) => isDescriptiveTasteDimension(dimension));
const minRatedTitles = 40;
const maxWeights = 512;
const combinationLimits: Record<TasteDimension, number> = {
  genres:4, tags:8, themes:3, cast:2, directors:1, writers:1, illustrators:1, composers:1, cinematographers:1,
  franchises:1, developers:1, publishers:1, mechanics:2, perspectives:1, artists:2, studios:1, networks:1,
  languages:1, countries:1, decades:1,
};
const combinationDimensions = Object.entries(combinationLimits) as [TasteDimension, number][];
type CombinationFeature = TasteFeature & { dimension: TasteDimension; key: string };
type TasteCombination = { key: string; left: CombinationFeature; right: CombinationFeature };
type Term = { key: string; weight: number; pair?: true };
type RatingWeights = Record<string, number>;
export type TasteRatingTerm = { name: string; points: number };
export type TasteAudienceRating = NonNullable<CatalogueFacts['audience']>;
const neutralRating = 3;

/** A fixed 3-star neutral point applies to every medium and rating history. */
export function ratingVote(rating: number, negativeWeight = 1) {
  const vote = Math.max(-1, Math.min(1, (rating - neutralRating) / 2));
  return vote < 0 ? vote * negativeWeight : vote;
}

/** Distance from neutral controls how much evidence a rating contributes. */
export function ratingInfluence(rating: number) {
  // Neutral ratings count lightly and carry less weight than the nearest half-star rating.
  return rating === neutralRating ? 0.15 : Math.abs(ratingVote(rating));
}

export type FriendTasteEvidence = { rating: number | null; shared: number; difference: number };
export type FriendTasteAdjustment = { watched: number; rated: number; points: number };

/** Compare stated preferences; an unrated watch supplies a small positive signal. */
export function friendTasteAdjustment(evidence: readonly FriendTasteEvidence[]): FriendTasteAdjustment {
  let support=0, votes=0, watched=0, rated=0;
  for (const {rating,shared,difference} of evidence) {
    const agreement=1-difference/4.5;
    if (shared<8 || agreement<0.8) continue;
    const trust=(agreement-0.75)*4*shared/(shared+8);
    support+=trust;
    votes+=trust*(rating===null ? 0.25 : ratingVote(rating));
    watched++;
    if(rating!==null)rated++;
  }
  const adjustment=6*votes/(0.75+support);
  const rounded=Math.round(Math.abs(adjustment));
  return {watched,rated,points:rounded ? Math.sign(adjustment)*rounded : 0};
}

/** A shared dislike is weaker evidence against the title's features. */
export function negativeRatingWeight(rating: number | null, audience?: TasteAudienceRating) {
  if (rating === null || rating >= neutralRating || !audience || !hasAudienceEvidence(audience)) return 1;
  const stars = 5 * audience.score / audience.scale;
  const lowScore = Math.max(0, Math.min(1, (3.25 - stars) / 0.75));
  const agreement = Math.max(0, 1 - Math.abs(rating - stars) / 1.25);
  const confidence = audience.votes / (audience.votes + 100);
  return 1 - 0.5 * lowScore * agreement * confidence;
}

export function hasAudienceEvidence(audience: TasteAudienceRating | null | undefined): audience is TasteAudienceRating & {votes:number} {
  return !!audience && (audience.scale === 10 || audience.scale === 100)
    && Number.isFinite(audience.score) && audience.score >= 0 && audience.score <= audience.scale
    && typeof audience.votes === 'number' && Number.isSafeInteger(audience.votes) && audience.votes >= 20;
}

/** Keep the same bounded, distinct combinations during training and scoring. */
export function tasteCombinations(features: TasteFeatures): TasteCombination[] {
  if (!features.genres?.length && !features.tags?.length && !features.themes?.length) return [];
  const candidates: CombinationFeature[] = [];
  const keys = new Set<string>();
  const descriptions = new Set<string>();
  for (const [dimension, limit] of combinationDimensions) {
    const descriptive = isDescriptiveTasteDimension(dimension);
    let count = 0;
    for (const feature of features[dimension] ?? []) {
      if (dimension === 'artists' && feature.id.startsWith('artist-name:')) continue;
      const key = `${dimension}:${feature.id}`;
      if (keys.has(key)) continue;
      if (descriptive) {
        const name = feature.name.trim().toLowerCase();
        if (descriptions.has(name)) continue;
        descriptions.add(name);
      }
      keys.add(key);
      candidates.push({ ...feature, dimension, key });
      if (++count === limit) break;
    }
  }
  const genres = candidates.filter(feature => feature.dimension === 'genres');
  const anchors = genres.length ? genres : candidates.filter(feature => feature.dimension === 'tags' || feature.dimension === 'themes').slice(0, 3);
  const seen = new Set<string>();
  const pairs: TasteCombination[] = [];
  for (const left of anchors) for (const right of candidates) {
    if (left.key === right.key || left.id === right.id) continue;
    const key = JSON.stringify(left.key < right.key ? [left.key, right.key] : [right.key, left.key]);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({key, left, right});
  }
  return pairs;
}

function terms(features: TasteFeatures, names?: Map<string, string>, availableDimensions=dimensions): Term[] {
  const terms = new Map<string, Term>();
  const descriptions = new Set<string>();
  for (const [dimension, weight] of availableDimensions) {
    const available = features[dimension] ?? [];
    const descriptive = isDescriptiveTasteDimension(dimension);
    const entries = descriptive ? available.filter(({ name }) => {
      const concept = name.trim().toLocaleLowerCase('en-US');
      if (descriptions.has(concept)) return false;
      descriptions.add(concept);
      return true;
    }) : (dimension === 'artists' ? available.filter(feature => !feature.id.startsWith('artist-name:')) : available).slice(0, dimension === 'cast' ? 14 : 8);
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
export function createTasteRatingTrainer(ratingCount: number) {
  const observations: { value: number; influence: number; positions: Uint32Array; weights: Float64Array }[] = [];
  const support = new Map<string, { position: number; count: number; minimum: number }>();
  return {
    add(rating: number | null, features: TasteFeatures, negativeWeight = 1) {
      if (rating === null || ratingCount < minRatedTitles) return;
      const influence = ratingInfluence(rating);
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
      // Attenuate the same below-neutral evidence used in the saved affinities.
      const value = rating < neutralRating ? neutralRating + (rating - neutralRating) * negativeWeight : rating;
      observations.push({ value, influence, positions, weights });
    },
    async fit(): Promise<RatingWeights | undefined> {
      if (observations.length < minRatedTitles || !observations.some(row => row.value !== observations[0].value)) return;
      const selected = new Int32Array(support.size).fill(-1);
      const keys: string[] = [];
      for (const [key, { position, count, minimum }] of support) {
        if (count < minimum) continue;
        selected[position] = keys.length;
        keys.push(key);
      }
      if (!keys.length) return;
      const totalInfluence = observations.reduce((total, row) => total + row.influence, 0);
      const average = observations.reduce((total, row) => total + row.value * row.influence, 0) / totalInfluence;
      const weights = new Float64Array(keys.length);
      const accepted = new Float64Array(keys.length);
      const gradient = new Float64Array(keys.length);
      const scale = 25 / Math.max(minRatedTitles, totalInfluence);
      const penalty = 0.35;
      let stepSize = 0.13;
      let lastLoss = Infinity;
      for (let step = 0; step <= 36; step++) {
        if (observations.length > 2500 && step % 4 === 0)
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        gradient.fill(0);
        let squaredErrors = 0;
        for (const { value, influence, positions, weights: inputs } of observations) {
          let error = average - value;
          for (let i = 0; i < positions.length; i++) {
            const position = selected[positions[i]];
            if (position >= 0) error += inputs[i] * weights[position];
          }
          for (let i = 0; i < positions.length; i++) {
            const position = selected[positions[i]];
            if (position >= 0) gradient[position] += influence * error * inputs[i];
          }
          squaredErrors += influence * error * error;
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
        .filter(([key, weight]) => weight !== 0 && (key.startsWith('[')
          || descriptiveDimensions.some(([dimension])=>key.startsWith(dimension+':'))))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0])).slice(0, maxWeights);
      return fitted.length ? Object.fromEntries(fitted) : undefined;
    },
  };
}

/** Other features help fit the descriptive terms; the affinity blend owns their score contribution. */
export function tasteRatingAdjustment(ratingWeights: RatingWeights | undefined, features: TasteFeatures, inputs?: TasteRatingTerm[]) {
  if (!ratingWeights) return 0;
  const names = inputs ? new Map<string, string>() : undefined;
  let fit = 0;
  for (const { key, weight } of terms(features, names, descriptiveDimensions)) {
    if (!Object.hasOwn(ratingWeights, key)) continue;
    const value = ratingWeights[key] * weight;
    fit += value;
    const name = names?.get(key);
    if (name && value) inputs?.push({ name, points: 16 * value });
  }
  return Math.round(16 * Math.max(-0.5, Math.min(0.5, fit)));
}

/** Use the strongest supported return patterns on either side to resolve equal ranks. */
export function tasteReturnTieBreak(returnWeights: RatingWeights | undefined, features: TasteFeatures) {
  if (!returnWeights) return 0;
  let positive = 0, negative = 0;
  for (const {key} of tasteCombinations(features)) {
    if (!Object.hasOwn(returnWeights,key)) continue;
    const value = returnWeights[key];
    positive = Math.max(positive, value);
    negative = Math.min(negative, value);
  }
  return Math.round((positive+negative)*10000)/10000;
}
