import { tmdbArtwork } from './artwork';
import * as v from 'valibot';
import { tmdbInsights, tmdbPerson } from './details.server';
import type { DiscoverKind, Metadata, MetadataProvider, ProviderTransport } from '../contracts';
const text = v.nullish(v.string());
const number = v.nullish(v.number());
const item = v.object({
  id: v.number(),
  media_type: text,
  title: text,
  name: text,
  original_title: text,
  original_name: text,
  overview: text,
  poster_path: text,
  backdrop_path: text,
  still_path: text,
  release_date: text,
  first_air_date: text,
  air_date: text,
  runtime: number,
  season_number: number,
  episode_number: number,
});
const result = v.object({ results: v.array(item) });
const castMember = v.object({
  id: v.number(),
  name: v.string(),
  character: text,
  profile_path: text,
  roles: v.optional(v.array(v.object({ character: v.string() })), []),
});
const credits = v.object({
  cast: v.array(castMember),
  guest_stars: v.optional(v.array(castMember), []),
});
const detail = v.object({
  credits: v.optional(credits),
  aggregate_credits: v.optional(credits),
  recommendations: v.optional(result),
  ...item.entries,
  images: v.optional(
    v.object({
      logos: v.optional(v.array(v.object({ file_path: v.string(), iso_639_1: text })), []),
    })
  ),
  genres: v.optional(v.array(v.object({ name: v.string() })), []),
  seasons: v.optional(
    v.array(
      v.object({ ...item.entries, id: v.optional(v.number(), 0), season_number: v.number() })
    ),
    []
  ),
  episodes: v.optional(v.array(item), []),
  external_ids: v.optional(v.object({ imdb_id: text, tvdb_id: number })),
  belongs_to_collection: v.nullish(v.object({ id: v.number(), name: v.string() })),
  videos: v.optional(
    v.object({
      results: v.array(
        v.object({
          key: v.string(),
          site: v.string(),
          type: v.string(),
          official: v.optional(v.boolean()),
        })
      ),
    })
  ),
  release_dates: v.optional(
    v.object({
      results: v.array(
        v.object({
          iso_3166_1: v.string(),
          release_dates: v.array(v.object({ certification: v.string() })),
        })
      ),
    })
  ),
  content_ratings: v.optional(
    v.object({ results: v.array(v.object({ iso_3166_1: v.string(), rating: v.string() })) })
  ),
});
function mapItem(
  data: v.InferOutput<typeof item>,
  kind: Metadata['kind'],
  language: string,
  region: string
): Metadata {
  const date = data.release_date || data.first_air_date || data.air_date;
  return {
    provider: 'tmdb',
    externalId: String(data.id),
    kind,
    title: data.title || data.name || 'Untitled',
    originalTitle: data.original_title || data.original_name || undefined,
    overview: data.overview || undefined,
    posterPath: tmdbArtwork(data.poster_path, 'w780'),
    backdropPath: tmdbArtwork(data.backdrop_path || data.still_path, 'original'),
    artwork: {
      primary: tmdbArtwork(data.poster_path, 'w780'),
      backdrop: tmdbArtwork(data.backdrop_path || data.still_path, 'original'),
      thumb: tmdbArtwork(data.still_path, 'w780'),
    },
    releaseDate: date || undefined,
    runtimeMinutes: data.runtime || undefined,
    language,
    region,
    seasonNumber: data.season_number ?? undefined,
    episodeNumber: data.episode_number ?? undefined,
  };
}
export class TmdbAdapter implements MetadataProvider {
  constructor(
    private request: ProviderTransport,
    private language = 'en-US',
    private region = 'GB'
  ) {}
  private path(path: string, params: Record<string, string | number> = {}) {
    const query = new URLSearchParams({
      language: this.language,
      ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    });
    return `${path}?${query}`;
  }
  async search(query: string, page = 1) {
    const data = v.parse(
      result,
      await this.request(this.path('/3/search/multi', { query, page, include_adult: 'false' }))
    );
    return data.results
      .filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
      .map((x) => mapItem(x, x.media_type === 'tv' ? 'show' : 'movie', this.language, this.region));
  }
  async trending(page = 1) {
    const data = v.parse(result, await this.request(this.path('/3/trending/all/week', { page })));
    return data.results
      .filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
      .map((x) => mapItem(x, x.media_type === 'tv' ? 'show' : 'movie', this.language, this.region));
  }
  async recent(kind: DiscoverKind, page = 1) {
    const data = v.parse(
      result,
      await this.request(
        this.path(`/3/${kind === 'show' ? 'tv/on_the_air' : 'movie/now_playing'}`, {
          page,
          region: this.region,
        })
      )
    );
    return data.results.map((x) => mapItem(x, kind, this.language, this.region));
  }
  async recommendations(kind: DiscoverKind, id: string) {
    const data = v.parse(
      result,
      await this.request(
        this.path(
          `/3/${kind === 'show' ? 'tv' : 'movie'}/${encodeURIComponent(id)}/recommendations`
        )
      )
    );
    return data.results.map((x) => mapItem(x, kind, this.language, this.region));
  }
  async details(kind: DiscoverKind, id: string, includeRecommendations = true): Promise<Metadata> {
    const data = v.parse(
      detail,
      await this.request(
        this.path(`/3/${kind === 'show' ? 'tv' : 'movie'}/${encodeURIComponent(id)}`, {
          append_to_response: `external_ids,videos,release_dates,content_ratings,images,${includeRecommendations ? 'recommendations,' : ''}${kind === 'show' ? 'aggregate_credits' : 'credits'}`,
          include_image_language: `${this.language.split('-')[0]},en,null`,
        })
      )
    );
    const metadata = mapItem(data, kind, this.language, this.region);
    const logos = data.images?.logos ?? [];
    const logo =
      logos.find((image) => image.iso_639_1 === this.language.split('-')[0]) ??
      logos.find((image) => image.iso_639_1 === 'en') ??
      logos.find((image) => !image.iso_639_1) ??
      logos[0];
    metadata.artwork = { ...metadata.artwork, logo: tmdbArtwork(logo?.file_path, 'original') };
    metadata.artworkUpdatedAt = new Date().toISOString();
    metadata.cast = (data.aggregate_credits?.cast ?? data.credits?.cast ?? [])
      .slice(0, 40)
      .map((person) => ({
        id: person.id,
        name: person.name,
        character: person.character ?? person.roles.map((role) => role.character).join(' / '),
        portrait: tmdbArtwork(person.profile_path, 'original'),
      }));
    metadata.recommendations = (data.recommendations?.results ?? [])
      .filter((entry) => entry.id !== data.id)
      .slice(0, 20)
      .map((entry) => mapItem(entry, kind, this.language, this.region));
    metadata.genres = data.genres.map((x) => x.name);
    metadata.externalIds = {
      tmdb: String(data.id),
      ...(data.external_ids?.imdb_id ? { imdb: data.external_ids.imdb_id } : {}),
      ...(data.external_ids?.tvdb_id ? { tvdb: String(data.external_ids.tvdb_id) } : {}),
    };
    metadata.certificate =
      data.release_dates?.results
        .find((x) => x.iso_3166_1 === this.region)
        ?.release_dates.find((x) => x.certification)?.certification ||
      data.content_ratings?.results.find((x) => x.iso_3166_1 === this.region)?.rating;
    const trailer =
      data.videos?.results.find(
        (x) => x.site === 'YouTube' && x.type === 'Trailer' && x.official
      ) || data.videos?.results.find((x) => x.site === 'YouTube' && x.type === 'Trailer');
    if (trailer && /^[\w-]{11}$/.test(trailer.key)) metadata.trailerKey = trailer.key;
    if (data.belongs_to_collection)
      metadata.collection = {
        id: String(data.belongs_to_collection.id),
        name: data.belongs_to_collection.name,
      };
    if (kind === 'show')
      metadata.children = data.seasons.map((x) => ({
        ...mapItem(x, 'season', this.language, this.region),
        provider: 'tmdb',
        externalId: `${id}:season:${x.season_number}`,
        kind: 'season',
        title: x.name || (x.season_number === 0 ? 'Specials' : `Season ${x.season_number}`),
        language: this.language,
        region: this.region,
        seasonNumber: x.season_number,
      }));
    return metadata;
  }
  async collection(id: string): Promise<Metadata> {
    const data = v.parse(
      v.object({ ...item.entries, parts: v.pipe(v.array(item), v.maxLength(1000)) }),
      await this.request(this.path(`/3/collection/${encodeURIComponent(id)}`))
    );
    const children = data.parts
      .map((part) => mapItem(part, 'movie', this.language, this.region))
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
    return {
      ...mapItem(data, 'collection', this.language, this.region),
      artworkUpdatedAt: new Date().toISOString(),
      children,
    };
  }
  async season(showId: string, seasonNumber: number): Promise<Metadata> {
    const data = v.parse(
      detail,
      await this.request(
        this.path(`/3/tv/${encodeURIComponent(showId)}/season/${seasonNumber}`, {
          append_to_response: 'credits',
        })
      )
    );
    return {
      ...mapItem(data, 'season', this.language, this.region),
      externalId: `${showId}:season:${seasonNumber}`,
      seasonNumber,
      cast: [
        ...new Map(
          [...(data.credits?.cast ?? []), ...(data.credits?.guest_stars ?? [])].map((p) => [
            p.id,
            p,
          ])
        ).values(),
      ].map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character ?? '',
        portrait: tmdbArtwork(p.profile_path),
      })),
      children: data.episodes.map((x) => ({
        ...mapItem(x, 'episode', this.language, this.region),
        seasonNumber,
      })),
    };
  }
  async episode(showId: string, seasonNumber: number, episodeNumber: number): Promise<Metadata> {
    const data = v.parse(
      detail,
      await this.request(
        this.path(
          `/3/tv/${encodeURIComponent(showId)}/season/${seasonNumber}/episode/${episodeNumber}`,
          { append_to_response: 'credits' }
        )
      )
    );
    return {
      ...mapItem(data, 'episode', this.language, this.region),
      seasonNumber,
      episodeNumber,
      cast: [
        ...new Map(
          [...(data.credits?.cast ?? []), ...(data.credits?.guest_stars ?? [])].map((p) => [
            p.id,
            p,
          ])
        ).values(),
      ].map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character ?? '',
        portrait: tmdbArtwork(p.profile_path),
      })),
    };
  }
  insights(path: string, page = 1) {
    return tmdbInsights(this.request, path, this.language, page);
  }
  person(id: number) {
    return tmdbPerson(this.request, id, this.language);
  }
}
