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
  policy?: 'local-first' | 'tmdb-only';
  preferOriginalTitle?: boolean;
  region?: string;
}
export interface FieldProvenance {
  source: string;
  updatedAt: Date | string | null;
}
export interface ResolvedMetadata {
  values: MetadataValues;
  provenance: Partial<Record<MetadataField, FieldProvenance>>;
}
const present = (value: unknown) => value !== undefined && value !== null;

/** Pure field-by-field resolution: snapshots are never mutated by preference or override. */
export function resolveMetadata(input: ResolutionInput): ResolvedMetadata {
  const locked = new Set(input.locks ?? []);
  const snapshots = [...(input.snapshots ?? [])]
    .filter((snapshot) => input.policy !== 'tmdb-only' || snapshot.provider === 'tmdb')
    .sort((a, b) => {
      const priority = (snapshot: MetadataSnapshot) =>
        snapshot.provider === 'jellyfin' ? 0 : snapshot.provider === 'tmdb' ? 1 : 2;
      return (
        priority(a) - priority(b) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  const values: MetadataValues = {};
  const provenance: ResolvedMetadata['provenance'] = {};
  for (const field of metadataFields) {
    const userValue =
      input.user && field in input.user ? input.user[field as keyof typeof input.user] : undefined;
    const overrideValue = input.override?.[field];
    const provider = snapshots.find(
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
      provenance[field] = { source: provider.provider, updatedAt: provider.updatedAt };
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
