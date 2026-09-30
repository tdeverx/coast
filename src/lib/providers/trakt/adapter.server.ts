import * as v from 'valibot';
import type { ProviderTransport, SyncCategory } from '../contracts';
const ids = v.object({
  trakt: v.number(),
  slug: v.optional(v.string()),
  imdb: v.nullish(v.string()),
  tmdb: v.nullish(v.number()),
  tvdb: v.nullish(v.number()),
});
const title = v.object({
  title: v.string(),
  year: v.nullish(v.number()),
  runtime: v.nullish(v.number()),
  ids,
});
const episode = v.object({
  season: v.number(),
  number: v.number(),
  title: v.nullish(v.string()),
  runtime: v.nullish(v.number()),
  ids,
});
const season = v.object({
  number: v.number(),
  title: v.nullish(v.string()),
  ids,
});
const tokens = v.object({
  access_token: v.string(),
  refresh_token: v.string(),
  expires_in: v.number(),
  created_at: v.number(),
  token_type: v.string(),
  scope: v.string(),
});
export const traktRecordSchema = v.object({
  id: v.optional(v.number()),
  type: v.optional(v.string()),
  watched_at: v.optional(v.string()),
  rated_at: v.optional(v.string()),
  collected_at: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(),v.unknown())),
  listed_at: v.optional(v.string()),
  paused_at: v.optional(v.string()),
  rating: v.optional(v.number()),
  progress: v.optional(v.number()),
  movie: v.nullish(title),
  show: v.nullish(title),
  season: v.nullish(season),
  episode: v.nullish(episode),
  seasons: v.optional(
    v.array(
      v.object({
        number: v.number(),
        episodes: v.array(v.object({ number: v.number(), collected_at: v.optional(v.string()), metadata: v.optional(v.record(v.string(),v.unknown())) })),
      })
    )
  ),
});
export type TraktRecord = v.InferOutput<typeof traktRecordSchema>;
export type TraktTokens = v.InferOutput<typeof tokens>;
export class TraktAdapter {
  constructor(
    private request: ProviderTransport,
    private clientId: string,
    private clientSecret: string,
    private accessToken?: string
  ) {}
  private call(path: string, init: RequestInit = {}) {
    return this.request(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.clientId,
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...init.headers,
      },
    });
  }
  private async readPages<T>(path: string, parse: (value: unknown) => T[]): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 10000; page++) {
      const items = parse(
        await this.call(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`)
      );
      result.push(...items);
      if (items.length < 100) return result;
    }
    throw new Error('Trakt list exceeded the supported page bound.');
  }
  async startDevice() {
    return v.parse(
      v.object({
        device_code: v.string(),
        user_code: v.string(),
        verification_url: v.string(),
        expires_in: v.number(),
        interval: v.number(),
      }),
      await this.call('/oauth/device/code', {
        method: 'POST',
        body: JSON.stringify({ client_id: this.clientId }),
      })
    );
  }
  async finishDevice(code: string) {
    return v.parse(
      tokens,
      await this.call('/oauth/device/token', {
        method: 'POST',
        body: JSON.stringify({ code, client_id: this.clientId, client_secret: this.clientSecret }),
      })
    );
  }
  async refresh(refreshToken: string) {
    return v.parse(
      tokens,
      await this.call('/oauth/token', {
        method: 'POST',
        body: JSON.stringify({
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
          grant_type: 'refresh_token',
        }),
      })
    );
  }
  async profile() {
    const data = v.parse(
      v.object({ user: v.object({ username: v.string(), ids: v.object({ uuid: v.string(), slug: v.optional(v.string()) }) }) }),
      await this.call('/users/settings')
    );
    return { id: data.user.ids.uuid, username: data.user.username, slug: data.user.ids.slug };
  }
  async read(
    category: Exclude<SyncCategory, 'lists' | 'scrobble'>,
    page = 1
  ): Promise<TraktRecord[]> {
    const path =
      category === 'progress'
        ? '/sync/playback'
        : category === 'collection'
          ? '/sync/collection/movies'
          : `/sync/${category}`;
    return v.parse(
      v.array(traktRecordSchema),
      await this.call(`${path}?page=${page}&limit=100&extended=full`)
    );
  }
  async collectionShows(): Promise<TraktRecord[]> {
    return this.readPages('/sync/collection/shows?extended=full', value => v.parse(v.array(traktRecordSchema),value));
  }
  async lists() {
    return this.readPages('/users/me/lists', (value) =>
      v.parse(
        v.array(
          v.object({
            name: v.string(),
            description: v.nullish(v.string()),
            ids: v.object({ trakt: v.number(), slug: v.string() }),
          })
        ),
        value
      )
    );
  }
  async listItems(listId: string) {
    return this.readPages(
      `/users/me/lists/${encodeURIComponent(listId)}/items/movie,show,season,episode?extended=full`,
      (value) => v.parse(v.array(traktRecordSchema), value)
    );
  }
  async updateList(id: string, name: string, description: string) {
    await this.call(`/users/me/lists/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    });
  }
  async createList(name: string, description?: string) {
    return v.parse(
      v.object({ ids: v.object({ trakt: v.number(), slug: v.string() }) }),
      await this.call('/users/me/lists', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          privacy: 'private',
          display_numbers: true,
          allow_comments: false,
        }),
      })
    );
  }
  async community(path: string, page = 1): Promise<import('$lib/media/details').MediaInsights> {
    const results = await Promise.allSettled([
      this.call(`${path}/ratings`).then((data) =>
        v.parse(
          v.object({
            rating: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
            votes: v.pipe(v.number(), v.integer(), v.minValue(0)),
            distribution: v.optional(
              v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(0)))
            ),
          }),
          data
        )
      ),
      this.call(`${path}/stats`).then((data) =>
        v.parse(
          v.object({
            watchers: v.optional(v.number()),
            plays: v.optional(v.number()),
            comments: v.optional(v.number()),
            lists: v.optional(v.number()),
          }),
          data
        )
      ),
      this.call(`${path}/comments/likes?page=${page}&limit=10`).then((data) =>
        v.parse(
          v.array(
            v.object({
              id: v.number(),
              comment: v.string(),
              spoiler: v.boolean(),
              created_at: v.string(),
              user_rating: v.nullish(v.number()),
              user: v.object({ username: v.string() }),
            })
          ),
          data
        )
      ),
    ]);
    if (results.every((result) => result.status === 'rejected'))
      throw new Error('Trakt details are unavailable.');
    const rating = results[0].status === 'fulfilled' ? results[0].value : null;
    const stats = results[1].status === 'fulfilled' ? results[1].value : {};
    const comments = results[2].status === 'fulfilled' ? results[2].value : [];
    return {
      incomplete: results.some((result) => result.status === 'rejected'),
      source: 'Trakt',
      url: `https://trakt.tv${path}`,
      rating: rating?.votes ? rating.rating : undefined,
      votes: rating?.votes,
      ratingDistribution: rating?.distribution
        ? Array.from({ length: 10 }, (_, index) => ({
            value: index + 1,
            count: rating.distribution![String(index + 1)] ?? 0,
          }))
        : undefined,
      metrics: Object.entries(stats)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
          label: (
            { watchers: 'Viewers', plays: 'Plays', comments: 'Comments', lists: 'Lists' } as Record<
              string,
              string
            >
          )[key],
          value: Number(value),
        })),
      facts: [],
      crew: [],
      reviews: comments.map((c) => ({
        id: String(c.id),
        author: c.user.username,
        text: c.comment,
        spoiler: c.spoiler,
        date: c.created_at,
        rating: c.user_rating ?? undefined,
        url: `https://trakt.tv/comments/${c.id}`,
      })),
      page,
      pages: comments.length === 10 ? page + 1 : page,
    };
  }
  async lookupIds(
    kind: 'movie' | 'episode' | 'show',
    externalId: number | string,
    provider = 'tmdb'
  ) {
    const results = v.parse(
      v.array(traktRecordSchema),
      await this.call(`/search/${provider}/${externalId}?type=${kind}`)
    );
    return (results[0]?.movie || results[0]?.episode || results[0]?.show)?.ids;
  }
  async historyFor(kind: 'movie' | 'episode', traktId: number, at: string) {
    const query = new URLSearchParams({ start_at: at, end_at: at, limit: '100' });
    return v.parse(
      v.array(traktRecordSchema),
      await this.call(
        `/sync/history/${kind === 'movie' ? 'movies' : 'episodes'}/${traktId}?${query}`
      )
    );
  }
  async write(
    category: 'history' | 'collection' | 'ratings' | 'watchlist',
    payload: Record<string, unknown>,
    remove = false
  ) {
    await this.call(`/sync/${category}${remove ? '/remove' : ''}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  async deleteList(listId: string) {
    try {
      await this.call(`/users/me/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }
  async reorderList(listId: string, rank: number[]) {
    await this.call(`/users/me/lists/${encodeURIComponent(listId)}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ rank }),
    });
  }
  async writeList(listId: string, payload: Record<string, unknown>, remove = false) {
    await this.call(
      `/users/me/lists/${encodeURIComponent(listId)}/items${remove ? '/remove' : ''}`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
  }
  async clearProgress(
    kind: 'movie' | 'episode',
    identity: Record<string, unknown>,
    only?: { ids: number[]; dates: string[] }
  ) {
    const records = await this.readPages('/sync/playback', (value) =>
      v.parse(v.array(traktRecordSchema), value)
    );
    for (const record of records) {
      const item = record[kind];
      if (
        record.id &&
        (!only ||
          only.ids.includes(record.id) ||
          (!!record.paused_at &&
            only.dates.some((date) => Date.parse(date) === Date.parse(record.paused_at!)))) &&
        item &&
        Object.entries(identity).some(
          ([provider, id]) => String(item.ids[provider as keyof typeof item.ids]) === String(id)
        )
      ) {
        try {
          await this.call(`/sync/playback/${record.id}`, { method: 'DELETE' });
        } catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
        }
      }
    }
  }
  async scrobble(
    event: 'start' | 'pause' | 'stop',
    kind: 'movie' | 'episode',
    traktIds: Record<string, string | number>,
    progress: number
  ) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 100)
      throw new Error('Invalid playback progress.');
    await this.call(`/scrobble/${event}`, {
      method: 'POST',
      body: JSON.stringify({ [kind]: { ids: traktIds }, progress, app_version: '0.1.0' }),
    });
  }
}
