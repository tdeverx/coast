import * as v from 'valibot';
import { ProviderActionError } from '../contracts';
import type { DiscoverKind, Metadata, ProviderTransport, SyncCategory } from '../contracts';
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
const seriesAirs = v.nullish(v.object({day:v.nullish(v.string()),time:v.nullish(v.string()),timezone:v.nullish(v.string())}));
const titleFacts=v.object({status:v.nullish(v.string()), tagline:v.nullish(v.string()), language:v.nullish(v.string()), country:v.nullish(v.string()),
  network:v.nullish(v.string()), rating:v.nullish(v.number()), votes:v.nullish(v.number()), aired_episodes:v.nullish(v.number())});
const publicTitle = v.object({ ...title.entries, overview: v.nullish(v.string()), released: v.nullish(v.string()),
  first_aired: v.nullish(v.string()), airs:seriesAirs, genres: v.optional(v.array(v.string())),...titleFacts.entries });
function traktTitleFacts(item:v.InferOutput<typeof titleFacts>):Metadata['facts'] {
  const facts = {
    status:item.status?.slice(0,100), tagline:item.tagline?.slice(0,500),
    originalLanguage:item.language??undefined, countries:item.country?[item.country]:undefined,
    networks:item.network?[{name:item.network.slice(0,250)}]:undefined,
    episodeCount:item.aired_episodes??undefined,
    audience:item.rating!=null&&item.votes?{score:item.rating,votes:item.votes,scale:10 as const}:undefined,
  };
  return Object.values(facts).some(value=>value!==undefined)?facts:undefined;
}
const episode = v.object({
  season: v.number(),
  number: v.number(),
  title: v.nullish(v.string()),
  runtime: v.nullish(v.number()),
  ids,
});
const calendarEntry = v.object({
  first_aired: v.nullish(v.string()),
  show: v.object({ids, airs:seriesAirs,...titleFacts.entries}),
  episode: v.object({season:v.number(),number:v.number(),ids,episode_type:v.nullish(v.string())}),
});
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function seriesAirSchedule(airs: v.InferOutput<typeof calendarEntry>['show']['airs']):Metadata['airSchedule'] {
  if(!airs?.time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(airs.time)||!airs.timezone)return;
  try {
    const timeZone=new Intl.DateTimeFormat('en',{timeZone:airs.timezone}).resolvedOptions().timeZone;
    const weekday=weekdays.indexOf(airs.day?.toLowerCase()??'');
    return {time:airs.time,timeZone,...weekday>=0?{weekday}:{}};
  }catch{return;}
}
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
const traktDate = v.pipe(v.string(), v.isoTimestamp(), v.check(date => Number.isFinite(Date.parse(date))),
  v.transform(date => new Date(date).toISOString()));
const syncShow = v.object({ ...title.entries, ids: v.object({
  ...ids.entries, trakt: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
}) });
export const traktRecordSchema = v.object({
  id: v.optional(v.number()),
  type: v.optional(v.string()),
  watched_at: v.optional(v.string()),
  rated_at: v.optional(v.string()),
  collected_at: v.optional(v.string()),
  metadata: v.nullish(v.record(v.string(),v.unknown())),
  listed_at: v.optional(v.string()),
  paused_at: v.optional(v.string()),
  reset_at: v.optional(traktDate),
  rating: v.optional(v.number()),
  progress: v.optional(v.number()),
  movie: v.nullish(title),
  show: v.nullish(title),
  season: v.nullish(season),
  episode: v.nullish(episode),
});
export type TraktRecord = v.InferOutput<typeof traktRecordSchema>;
const collectionFields = { collected_at: traktRecordSchema.entries.collected_at, metadata: traktRecordSchema.entries.metadata };
const collectedMovies = v.pipe(v.array(v.object({ ...collectionFields, movie: title })), v.maxLength(100));
const collectedEpisodes = v.pipe(v.array(v.object({ ...collectionFields, show: title, episode })), v.maxLength(100));

const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const mutationCounts = v.pipe(
  v.record(v.string(), count),
  v.check(counts => ['movies','shows','seasons','episodes','people','users'].some(kind => Object.hasOwn(counts, kind)))
);
const missingItems = v.record(v.string(), v.nullish(v.array(v.unknown())));
const addReceipt = v.object({ added: mutationCounts, existing: v.optional(mutationCounts), updated: v.optional(mutationCounts), not_found: missingItems });
const removeReceipt = v.object({ deleted: mutationCounts, not_found: missingItems });

function confirmItemWrite(response: unknown, remove: boolean) {
  const {not_found} = v.parse(remove ? removeReceipt : addReceipt, response);
  if (Object.values(not_found).some(items => items?.length))
    throw new ProviderActionError('Trakt could not match every item. Review the title identities before retrying.', 'identity');
}

const scrobbleReceipt = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  action: v.picklist(['start','pause','stop','scrobble']),
  progress: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
});

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
  /** A single bounded calendar window supplies episode times and the recurring series schedule. */
  async airSchedule(startDate: string) {
    const records=v.parse(v.pipe(v.array(calendarEntry),v.maxLength(5000)),
      await this.call(`/calendars/all/shows/${encodeURIComponent(startDate)}/8?extended=full`));
    return records.filter(({episode})=>Number.isSafeInteger(episode.season)&&episode.season>=0&&Number.isSafeInteger(episode.number)&&episode.number>0)
      .map(({show,episode,first_aired})=>{
        const facts=traktTitleFacts(show);
        return {
        traktId:String(show.ids.trakt),tmdbId:show.ids.tmdb ? String(show.ids.tmdb) : undefined,
        episodeTmdbId:episode.ids.tmdb ? String(episode.ids.tmdb) : undefined,
        season:episode.season,episode:episode.number,
        firstAiredAt:first_aired&&v.is(v.pipe(v.string(),v.isoTimestamp()),first_aired)&&Number.isFinite(Date.parse(first_aired))
          ? new Date(first_aired).toISOString() : undefined,
        schedule:seriesAirSchedule(show.airs),
        ...(facts ? {showFacts:facts} : {}),
        ...(episode.episode_type ? {episodeFacts:{episodeType:episode.episode_type.slice(0,100)}} : {}),
      };});
  }
  async browse(kind: DiscoverKind, order: 'trending' | 'popular' | 'anticipated', genre?: string, signal?: AbortSignal): Promise<Metadata[]> {
    const params = new URLSearchParams({page:'1',limit:'20',extended:'full'});
    if (genre) params.set('genres',genre);
    const path = `/${kind === 'movie' ? 'movies' : 'shows'}/${order}?${params}`;
    const items = order === 'popular' ? v.parse(v.array(publicTitle),await this.call(path,{signal}))
      : v.parse(v.array(v.object({[kind]:publicTitle})),await this.call(path,{signal})).map(entry=>entry[kind]);
    return items.slice(0,20).filter(item=>Number.isSafeInteger(item.ids.trakt)&&item.ids.trakt>0).map(item => ({
      kind, provider:'trakt', externalId:String(item.ids.trakt), title:item.title, overview:item.overview??undefined,
      releaseDate:(item.released || item.first_aired)?.slice(0,10), runtimeMinutes:item.runtime??undefined, genres:item.genres,
      facts:traktTitleFacts(item),
      ...(kind==='show'&&item.airs?{airSchedule:seriesAirSchedule(item.airs)}:{}),
      externalIds:{...(item.ids.tmdb ? {tmdb:String(item.ids.tmdb)} : {}), ...(item.ids.imdb ? {imdb:item.ids.imdb} : {}),
        ...(kind==='show' && item.ids.tvdb ? {tvdb:String(item.ids.tvdb)} : {})},
    }));
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
      v.object({ user: v.object({ username: v.string(), ids: v.object({ uuid: v.string(), slug: v.optional(v.string()) }), images:v.optional(v.object({avatar:v.optional(v.object({full:v.nullish(v.string())}))})) }) }),
      await this.call('/users/settings')
    );
    return { id: data.user.ids.uuid, username: data.user.username, slug: data.user.ids.slug, avatar:data.user.images?.avatar?.full??null };
  }
  async recommendations(kind:'movie'|'show'){
    return v.parse(v.array(title),await this.call(`/recommendations/${kind==='movie'?'movies':'shows'}?limit=40`));
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
    const result = await this.call(`${path}?page=${page}&limit=100&extended=full`);
    return v.parse(category === 'collection' ? collectedMovies : v.array(traktRecordSchema), result);
  }
  /** Activity fence for a staged census; this is a change signal, not a snapshot. */
  async lastActivity(): Promise<string> {
    return v.parse(v.object({ all: v.string() }), await this.call('/sync/last_activities')).all;
  }
  async droppedShowsPage(page: number) {
    return v.parse(v.array(v.object({ show: syncShow })), await this.call(`/users/hidden/dropped?page=${page}&limit=100`));
  }
  async rewatchingShowsPage(page: number) {
    const rows = v.parse(v.array(v.object({ show: syncShow, progress: v.object({ reset_at: traktDate }) })),
      await this.call(`/sync/progress/watched?only_rewatching=true&page=${page}&limit=100`));
    return rows.map(({ show, progress }) => ({ show, reset_at: progress.reset_at }));
  }
  async showRewatchDate(id: number) {
    const progress = v.parse(v.object({ reset_at: v.nullable(traktDate) }),
      await this.call(`/shows/${id}/progress/watched`));
    return progress.reset_at;
  }
  async writeDroppedShow(id: number, dropped: boolean) {
    const response = await this.call(`/users/hidden/dropped${dropped ? '' : '/remove'}`, {
      method: 'POST', body: JSON.stringify({ shows: [{ ids: { trakt: id } }] }),
    });
    confirmItemWrite(response, !dropped);
  }
  async writeShowRewatch(id: number, date: string | null) {
    const path = `/shows/${id}/progress/watched/reset`;
    try {
      if (!date) {
        await this.call(path, { method: 'DELETE' });
        return null;
      }
      const receipt = v.parse(v.object({ reset_at: traktDate }), await this.call(path, {
        method: 'POST', body: JSON.stringify({ reset_at: date }),
      }));
      return receipt.reset_at;
    } catch (error) {
      if ((error as { status?: number }).status === 403)
        throw new ProviderActionError('Trakt requires VIP to sync a show rewatch date. Your Coast rewatch is saved.', 'permission');
      throw error;
    }
  }
  async collectionEpisodesPage(page=1) {
    return v.parse(collectedEpisodes,await this.call(`/sync/collection/episodes?extended=full&page=${page}&limit=100`));
  }
  async *collectionEpisodePages() {
    for (let page=1;page<=10000;page++) {
      const episodes=await this.collectionEpisodesPage(page);
      yield episodes;
      if (episodes.length<100) return;
    }
    throw new Error('Trakt episode collection exceeded the supported page bound.');
  }
  async listsPage(page=1) {
    return v.parse(v.array(v.object({name:v.string(),description:v.nullish(v.string()),ids:v.object({trakt:v.number(),slug:v.string()})})),await this.call(`/users/me/lists?page=${page}&limit=100`));
  }
  async listItemsPage(listId:string,page=1):Promise<TraktRecord[]> {
    return v.parse(v.array(traktRecordSchema),await this.call(`/users/me/lists/${encodeURIComponent(listId)}/items/movie,show,season,episode?extended=full&page=${page}&limit=100`));
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
  async community(path: string, page = 1): Promise<import('#lib/media/details.js').MediaInsights> {
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
  /** Resolve an item by its own IDs, never by title or its parent show. */
  async resolveExactId(kind: 'movie' | 'episode' | 'show', identity: Record<string, string | number>) {
    const providers = ['trakt', 'tmdb', 'tvdb', 'imdb'] as const;
    const verified = new Set<string>();
    let traktId: number | undefined;
    for (const provider of providers) {
      const id = identity[provider];
      if (!id || verified.has(provider)) continue;
      let response: unknown;
      try {
        response = await this.call(`/search/${provider}/${encodeURIComponent(id)}?type=${kind}`);
      } catch (error) {
        if ((error as { status?: number }).status === 404) continue;
        throw error;
      }
      const matches = v.parse(
        v.array(traktRecordSchema),
        response
      ).flatMap(record => {
        const item = record[kind];
        return item?.ids[provider] === id ? [item.ids] : [];
      });
      if (!matches.length) continue;
      if (matches.length !== 1) return;
      const [remote] = matches;
      if (!Number.isSafeInteger(remote.trakt) || remote.trakt <= 0 ||
        (traktId !== undefined && traktId !== remote.trakt)) return;
      for (const key of providers) {
        if (!identity[key] || remote[key] == null) continue;
        if (remote[key] !== identity[key]) return;
        verified.add(key);
      }
      traktId = remote.trakt;
    }
    return traktId;
  }
  async historyFor(kind: 'movie' | 'episode', traktId: number, at?: string) {
    const query = new URLSearchParams(at ? { start_at: at, end_at: at, limit: '100' } : { limit: '1' });
    const records = v.parse(
      v.array(traktRecordSchema),
      await this.call(
        `/sync/history/${kind === 'movie' ? 'movies' : 'episodes'}/${traktId}?${query}`
      )
    );
    if (records.some(record => record[kind]?.ids.trakt !== traktId))
      throw new ProviderActionError('Trakt returned history for a different title.', 'identity');
    return records;
  }
  async write(
    category: 'history' | 'collection' | 'ratings' | 'watchlist',
    payload: Record<string, unknown>,
    remove = false
  ) {
    const response = await this.call(`/sync/${category}${remove ? '/remove' : ''}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    confirmItemWrite(response, remove);
  }
  async deleteList(listId: string) {
    try {
      await this.call(`/users/me/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }
  async reorderList(listId: string, rank: number[]) {
    const response = await this.call(`/users/me/lists/${encodeURIComponent(listId)}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ rank }),
    });
    const receipt = v.parse(v.object({ updated: count, skipped_ids: v.array(v.number()) }), response);
    if (receipt.skipped_ids.length)
      throw new ProviderActionError('Trakt skipped items in the requested order. Review the list before retrying.', 'identity');
  }
  async writeList(listId: string, payload: Record<string, unknown>, remove = false) {
    const response = await this.call(
      `/users/me/lists/${encodeURIComponent(listId)}/items${remove ? '/remove' : ''}`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
    confirmItemWrite(response, remove);
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
  async watching() {
    const raw=await this.call('/users/me/watching?extended=full');
    return raw===null?null:v.parse(v.object({started_at:v.pipe(v.string(),v.isoTimestamp()),expires_at:v.pipe(v.string(),v.isoTimestamp()),action:v.string(),type:v.picklist(['movie','episode']),movie:v.nullish(title),show:v.nullish(title),episode:v.nullish(episode)}),raw);
  }
  async checkin(kind:'movie'|'episode',traktIds:Record<string,string|number>) {
    return v.parse(v.object({id:v.number(),watched_at:v.pipe(v.string(),v.isoTimestamp()),movie:v.nullish(title),show:v.nullish(title),episode:v.nullish(episode)}),await this.call('/checkin',{method:'POST',body:JSON.stringify({[kind]:{ids:traktIds},sharing:{twitter:false,tumblr:false,mastodon:false},app_version:'0.1.0'})}));
  }
  async cancelCheckin(){await this.call('/checkin',{method:'DELETE'});}
  async recentHistory(since:string) {
    return this.readPages(`/sync/history?extended=full&start_at=${encodeURIComponent(since)}`,raw=>v.parse(v.array(traktRecordSchema),raw));
  }
  async scrobble(
    event: 'start' | 'pause' | 'stop',
    kind: 'movie' | 'episode',
    traktIds: Record<string, string | number>,
    progress: number
  ) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 100)
      throw new Error('Invalid playback progress.');
    const receipt = v.parse(scrobbleReceipt, await this.call(`/scrobble/${event}`, {
      method: 'POST',
      body: JSON.stringify({ [kind]: { ids: traktIds }, progress, app_version: '0.1.0' }),
    }));
    if ((event === 'stop' && receipt.action === 'start') || (event !== 'stop' && receipt.action !== event))
      throw new ProviderActionError('Trakt acknowledged a different playback action. Review the synced activity.', 'invalid-request');
    return receipt;
  }
}
