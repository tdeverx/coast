import * as v from 'valibot';

export const metadataProviders = ['jellyfin', 'tmdb', 'trakt'] as const;
export const metadataFamilies = ['details', 'artwork', 'release'] as const;
export type MetadataProviderName = (typeof metadataProviders)[number];
export type MetadataFamily = (typeof metadataFamilies)[number];
const provider = v.picklist(metadataProviders);
const order = v.pipe(v.tuple([provider, provider, provider]),
  v.check(values => new Set(values).size === metadataProviders.length, 'Choose each source once.'));
const preset = v.picklist(['local-preferred', 'tmdb-only']);
const preference = v.union([preset, order]);
export const metadataSourceSchema = v.union([
  preset,
  v.strictObject({ details: preference, artwork: preference, release: preference }),
]);
export type MetadataSource = v.InferOutput<typeof metadataSourceSchema>;
export type MetadataPolicy = MetadataSource | 'local-first';

const tmdbSources = ['tmdb'] as const;

export function sourcePreference(policy: MetadataPolicy | undefined, family: MetadataFamily) {
  if (typeof policy === 'object') return policy[family];
  return policy === 'tmdb-only' ? policy : 'local-preferred';
}

export function sourceOrder(policy: MetadataPolicy | undefined, family: MetadataFamily): readonly MetadataProviderName[] {
  const preference = sourcePreference(policy, family);
  if (preference === 'tmdb-only') return tmdbSources;
  return Array.isArray(preference) ? preference : metadataProviders;
}

function compareMetadataSnapshots(sources: readonly string[], a: MetadataSnapshot, b: MetadataSnapshot) {
  const rank = (provider: string) => { const index = sources.indexOf(provider); return index < 0 ? sources.length : index; };
  return rank(a.provider) - rank(b.provider) ||
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
    (a.id ?? '').localeCompare(b.id ?? '');
}

export const metadataFields = [
  'title',
  'originalTitle',
  'overview',
  'posterPath',
  'backdropPath',
  'releaseDate',
  'runtimeMinutes',
  'genres',
  'certificate',
] as const;
export type MetadataField = (typeof metadataFields)[number];
export interface MetadataValues {
  title?: string | null;
  originalTitle?: string | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  runtimeMinutes?: number | null;
  genres?: string[] | null;
  certificate?: string | null;
}
export interface MetadataSnapshot extends MetadataValues {
  id?: string;
  provider: string;
  updatedAt: Date | string;
  region?: string;
  language?: string;
  instanceId?: string | null;
}
export interface ResolutionInput {
  fallback: MetadataValues;
  snapshots?: MetadataSnapshot[];
  override?: (MetadataValues & { updatedAt?: Date | string }) | null;
  locks?: Iterable<MetadataField>;
  user?:
    | (Pick<MetadataValues, 'title' | 'posterPath' | 'backdropPath'> & {
        updatedAt?: Date | string;
      })
    | null;
  policy?: MetadataPolicy;
  preferOriginalTitle?: boolean;
  region?: string;
}
export interface FieldProvenance {
  source: string;
  updatedAt: Date | string | null;
  instanceId?: string;
  region?: string;
  language?: string;
}
export interface ResolvedMetadata {
  values: MetadataValues;
  provenance: Partial<Record<MetadataField, FieldProvenance>>;
}
const present = (value: unknown) => value !== undefined && value !== null;

/** Pure field-by-field resolution: snapshots are never mutated by preference or override. */
export function resolveMetadata(input: ResolutionInput): ResolvedMetadata {
  const locked = new Set(input.locks ?? []);
  const snapshots = input.snapshots ?? [];
  const ranked = new Map<readonly string[], MetadataSnapshot[]>();
  const values: MetadataValues = {};
  const provenance: ResolvedMetadata['provenance'] = {};
  for (const field of metadataFields) {
    const userValue =
      input.user && field in input.user ? input.user[field as keyof typeof input.user] : undefined;
    const overrideValue = input.override?.[field];
    const family = field === 'posterPath' || field === 'backdropPath' ? 'artwork'
      : field === 'releaseDate' ? 'release' : 'details';
    const sources = sourceOrder(input.policy, family);
    let candidates = ranked.get(sources);
    if (!candidates) {
      candidates = snapshots.filter(snapshot => sources !== tmdbSources || snapshot.provider === 'tmdb')
        .sort((a, b) => compareMetadataSnapshots(sources, a, b));
      ranked.set(sources, candidates);
    }
    const provider = candidates.find(
      (snapshot) =>
        present(snapshot[field]) &&
        (field !== 'certificate' || !input.region || snapshot.region === input.region)
    );
    let value: unknown;
    if (!locked.has(field) && present(userValue)) {
      value = userValue;
      provenance[field] = { source: 'user', updatedAt: input.user?.updatedAt ?? null };
    } else if (present(overrideValue)) {
      value = overrideValue;
      provenance[field] = { source: 'administrator', updatedAt: input.override?.updatedAt ?? null };
    } else if (provider) {
      value = provider[field];
      provenance[field] = { source: provider.provider, updatedAt: provider.updatedAt,
        ...(provider.instanceId ? {instanceId:provider.instanceId} : {}),
        ...(provider.language ? {language:provider.language} : {}),
        ...(provider.region ? {region:provider.region} : {}) };
    } else {
      value = input.fallback[field];
      if (present(value)) provenance[field] = { source: 'coast', updatedAt: null };
    }
    if (present(value))
      Object.assign(values, { [field]: Array.isArray(value) ? [...value] : value });
  }
  if (
    input.preferOriginalTitle &&
    !locked.has('title') &&
    !present(input.user?.title) &&
    values.originalTitle
  ) {
    values.title = values.originalTitle;
    provenance.title = provenance.originalTitle;
  }
  return { values, provenance };
}
