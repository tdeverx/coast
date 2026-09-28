import * as v from 'valibot';
import type { MediaInsights, PersonDetails } from '$lib/media/details';
import type { ProviderTransport } from '../contracts';
import { tmdbArtwork } from './adapter.server';
const text = v.nullish(v.string());
const num = v.nullish(v.number());
const person = v.object({
  id: v.number(),
  name: v.string(),
  profile_path: text,
  job: text,
  department: text,
});
const names = v.optional(v.array(v.object({ name: v.string() })), []);
export async function tmdbInsights(
  request: ProviderTransport,
  path: string,
  language: string,
  page = 1
): Promise<MediaInsights> {
  const query = new URLSearchParams({ language, append_to_response: 'credits' });
  const data = v.parse(
    v.object({
      vote_average: num,
      vote_count: num,
      status: text,
      tagline: text,
      original_language: text,
      release_date: text,
      first_air_date: text,
      air_date: text,
      last_air_date: text,
      number_of_episodes: num,
      number_of_seasons: num,
      budget: num,
      revenue: num,
      networks: names,
      production_companies: names,
      spoken_languages: v.optional(v.array(v.object({ english_name: v.string() })), []),
      next_episode_to_air: v.nullish(
        v.object({ name: text, air_date: text, season_number: num, episode_number: num })
      ),
      credits: v.optional(v.object({ crew: v.optional(v.array(person), []) })),
    }),
    await request(`/3/${path}?${query}`)
  );
  const facts: MediaInsights['facts'] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '')
      facts.push({ label, value: String(value) });
  };
  add('Status', data.status);
  add('Released', data.release_date || data.first_air_date || data.air_date);
  add('Last aired', data.last_air_date);
  add('Seasons', data.number_of_seasons);
  add('Episodes', data.number_of_episodes);
  add('Languages', data.spoken_languages.map((x) => x.english_name).join(', '));
  add('Network', data.networks.map((x) => x.name).join(', '));
  add('Production', data.production_companies.map((x) => x.name).join(', '));
  if (data.budget)
    add(
      'Budget',
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(data.budget)
    );
  if (data.revenue)
    add(
      'Box office',
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(data.revenue)
    );
  if (data.next_episode_to_air)
    add(
      'Next episode',
      [data.next_episode_to_air.name, data.next_episode_to_air.air_date].filter(Boolean).join(' · ')
    );
  let incomplete = false;
  let reviews: MediaInsights['reviews'] = [],
    pages = 0;
  if (/^(movie|tv)\/\d+$/.test(path)) {
    try {
      const response = v.parse(
        v.object({
          total_pages: v.number(),
          results: v.array(
            v.object({
              id: v.string(),
              author: v.string(),
              content: v.string(),
              created_at: text,
              author_details: v.optional(v.object({ rating: num })),
            })
          ),
        }),
        await request(`/3/${path}/reviews?${new URLSearchParams({ language, page: String(page) })}`)
      );
      pages = response.total_pages;
      reviews = response.results.map((r) => ({
        id: r.id,
        author: r.author,
        text: r.content,
        date: r.created_at ?? undefined,
        rating: r.author_details?.rating ?? undefined,
        spoiler: true,
        url: `https://www.themoviedb.org/review/${encodeURIComponent(r.id)}`,
      }));
    } catch {
      incomplete = true;
    }
  }
  const crew = new Map<number, MediaInsights['crew'][number]>();
  for (const p of data.credits?.crew ?? []) {
    const old = crew.get(p.id);
    if (old) {
      if (p.job && !old.character.split(' · ').includes(p.job)) old.character += ` · ${p.job}`;
    } else
      crew.set(p.id, {
        id: p.id,
        name: p.name,
        character: p.job ?? p.department ?? '',
        portrait: tmdbArtwork(p.profile_path, 'w342'),
      });
  }
  return {
    source: 'TMDB',
    incomplete,
    url: `https://www.themoviedb.org/${path}`,
    rating: data.vote_count ? (data.vote_average ?? undefined) : undefined,
    votes: data.vote_count ?? undefined,
    facts,
    crew: [...crew.values()],
    reviews,
    page,
    pages,
  };
}
export async function tmdbPerson(
  request: ProviderTransport,
  id: number,
  language: string
): Promise<PersonDetails> {
  const credit = v.object({
    id: v.number(),
    media_type: v.string(),
    title: text,
    name: text,
    overview: text,
    poster_path: text,
    backdrop_path: text,
    release_date: text,
    first_air_date: text,
    character: text,
    job: text,
    department: text,
    popularity: num,
  });
  const data = v.parse(
    v.object({
      id: v.number(),
      name: v.string(),
      biography: text,
      profile_path: text,
      known_for_department: text,
      birthday: text,
      deathday: text,
      place_of_birth: text,
      combined_credits: v.object({ cast: v.array(credit), crew: v.array(credit) }),
    }),
    await request(
      `/3/person/${id}?${new URLSearchParams({ language, append_to_response: 'combined_credits' })}`
    )
  );
  const credits: PersonDetails['credits'] = [];
  for (const [department, entries] of [
    ['acting', data.combined_credits.cast],
    ['crew', data.combined_credits.crew],
  ] as const)
    for (const entry of entries) {
      if (!['movie', 'tv'].includes(entry.media_type)) continue;
      credits.push({
        department,
        creditDepartment: department === 'acting' ? 'Acting' : (entry.department ?? 'Crew'),
        role: entry.character ?? entry.job ?? '',
        popularity: entry.popularity ?? 0,
        metadata: {
          provider: 'tmdb',
          externalId: String(entry.id),
          kind: entry.media_type === 'tv' ? 'show' : 'movie',
          title: entry.title || entry.name || 'Untitled',
          overview: entry.overview ?? undefined,
          posterPath: tmdbArtwork(entry.poster_path),
          backdropPath: tmdbArtwork(entry.backdrop_path, 'original'),
          releaseDate: entry.release_date || entry.first_air_date || undefined,
          language,
        },
      });
    }
  return {
    id: data.id,
    name: data.name,
    biography: data.biography ?? '',
    portrait: tmdbArtwork(data.profile_path),
    department: data.known_for_department ?? undefined,
    birthday: data.birthday ?? undefined,
    deathday: data.deathday ?? undefined,
    birthplace: data.place_of_birth ?? undefined,
    credits,
  };
}
