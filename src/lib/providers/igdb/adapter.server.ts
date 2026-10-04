import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { AppError } from '../../server/security/errors';
import { createProviderTransport, ProviderHttpError } from '../../server/security/provider-fetch';

export const IGDB_BASE_URL = 'https://api.igdb.com';
export const TWITCH_BASE_URL = 'https://id.twitch.tv';
const credential = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250), v.regex(/^[A-Za-z0-9_-]+$/));
export const igdbCredentialsSchema = v.object({ clientId: credential, clientSecret: credential });
export const igdbIdSchema = v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,14}$/), v.check((id) => Number.isSafeInteger(Number(id)), 'Enter a valid IGDB game ID.'));
const tokenSchema = v.object({
  access_token: credential,
  expires_in: v.pipe(v.number(), v.integer(), v.minValue(1)),
  token_type: v.literal('bearer'),
});
const name = v.object({ name: v.pipe(v.string(), v.minLength(1), v.maxLength(250)) });
const image = v.object({ image_id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+$/), v.maxLength(100)) });
const gameFields = {
  id: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER)),
  name: name.entries.name,
  summary: v.optional(v.pipe(v.string(), v.maxLength(50000))),
  first_release_date: v.optional(v.pipe(v.number(), v.integer(), v.minValue(-62135596800), v.maxValue(253402300799))),
  cover: v.optional(image),
  artworks: v.optional(v.pipe(v.array(image), v.maxLength(500)), []),
  external_games: v.optional(v.array(v.object({uid:v.string(),url:v.optional(v.string())})), []),
  keywords:v.optional(v.array(v.object({id:v.number(),name:v.string()})),[]),
  themes:v.optional(v.array(v.object({id:v.number(),name:v.string()})),[]),
  game_modes:v.optional(v.array(v.object({id:v.number(),name:v.string()})),[]),
  player_perspectives:v.optional(v.array(v.object({id:v.number(),name:v.string()})),[]),
  franchises:v.optional(v.array(v.object({id:v.number(),name:v.string()})),[]),
  platforms: v.optional(v.pipe(v.array(name), v.maxLength(100)), []),
  genres: v.optional(v.pipe(v.array(name), v.maxLength(100)), []),
  involved_companies: v.optional(v.pipe(v.array(v.object({
    company: name, developer: v.optional(v.boolean(), false), publisher: v.optional(v.boolean(), false),
  })), v.maxLength(500)), []),
};
const remoteGame=v.object({...gameFields,parent_game:v.optional(v.object(gameFields)),version_parent:v.optional(v.object(gameFields))});
const fields = 'external_games.uid,external_games.url,name,summary,first_release_date,cover.image_id,artworks.image_id,platforms.name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,keywords.id,keywords.name,themes.id,themes.name,game_modes.id,game_modes.name,player_perspectives.id,player_perspectives.name,franchises.id,franchises.name';
const expandedFields=fields+',parent_game.'+fields.split(',').join(',parent_game.')+',version_parent.'+fields.split(',').join(',version_parent.');
const pageSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000));
export const IGDB_PAGE_SIZE = 60;

function mapGame(game:v.InferOutput<typeof remoteGame>) {
  const companies = game.involved_companies;
  return {
    identities: game.external_games.flatMap(item => {
      try { const url=new URL(item.url??'');const id=url.pathname.match(/^\/app\/([1-9][0-9]*)(?:\/|$)/)?.[1];
        return url.hostname==='store.steampowered.com' && id===item.uid ? [{provider:'steam',externalId:id}] : [];
      } catch { return []; }
    }),
    category: 'game' as const, provider: 'igdb' as const, externalId: String(game.id),
    title: game.name, overview: game.summary ?? null,
    releaseDate: game.first_release_date === undefined ? null : new Date(game.first_release_date * 1000).toISOString().slice(0, 10),
    posterPath: game.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
    backdropPath: game.artworks[0] ? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.artworks[0].image_id}.jpg` : null,
    tasteFeatures:{
      tags:game.keywords.map(item=>({id:`igdb:${item.id}`,name:item.name})),
      themes:game.themes.map(item=>({id:`igdb:${item.id}`,name:item.name})),
      mechanics:game.game_modes.map(item=>({id:`igdb:${item.id}`,name:item.name})),
      perspectives:game.player_perspectives.map(item=>({id:`igdb:${item.id}`,name:item.name})),
      franchises:game.franchises.map(item=>({id:`igdb:${item.id}`,name:item.name})),
    },
    platforms: [...new Set(game.platforms.map((item) => item.name))],
    genres: [...new Set(game.genres.map((item) => item.name))],
    developers: [...new Set(companies.filter((item) => item.developer).map((item) => item.company.name))],
    publishers: [...new Set(companies.filter((item) => item.publisher).map((item) => item.company.name))],
  };
}
export function mapIgdbGame(raw:unknown){
  const game=v.parse(remoteGame,raw),parent=game.parent_game??game.version_parent;
  return {...mapGame(game),parent:parent&&parent.id!==game.id?mapGame(parent):undefined};
}
export type IgdbGame = ReturnType<typeof mapGame> & {parent?:ReturnType<typeof mapGame>};

// Share a conservative request lane across instances using the same Twitch application.
// Serial requests, at least 275ms apart, stay below IGDB's 4/sec and 8-open-request limits.
type Lane = { tail: Promise<void>; pending: number; lastStart: number };
const lanes = new Map<string, Lane>();
async function inLane<T>(clientId: string, work: () => Promise<T>): Promise<T> {
  let lane = lanes.get(clientId);
  if (!lane) {
    for (const [id, candidate] of lanes) {
      if (candidate.pending === 0 && Date.now() - candidate.lastStart > 60_000) lanes.delete(id);
    }
    if (lanes.size >= 64) throw new AppError(429, 'Game metadata is busy. Try again shortly.', 'igdb_busy');
    lane = { tail: Promise.resolve(), pending: 0, lastStart: 0 };
    lanes.set(clientId, lane);
  }
  if (lane.pending >= 20) throw new AppError(429, 'Game metadata is busy. Try again shortly.', 'igdb_busy');
  const current = lane;
  current.pending++;
  const result = current.tail.then(async () => {
    const delay = Math.max(0, current.lastStart + 275 - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    current.lastStart = Date.now();
    return work();
  });
  current.tail = result.then(() => {}, () => {});
  try { return await result; } finally { current.pending--; }
}

function providerError(error: unknown): never {
  if (error instanceof ProviderHttpError) {
    if ([400, 401, 403].includes(error.status))
      throw new AppError(502, 'IGDB authentication or the metadata request failed. Check the Twitch application credentials.', 'igdb_rejected');
    if (error.status === 429)
      throw new AppError(429, 'IGDB is limiting requests. Try again later.', 'igdb_rate_limited');
  }
  if (error instanceof AppError) throw error;
  throw new AppError(502, 'IGDB could not return valid game metadata. Try again later.', 'igdb_unavailable');
}

export class IgdbAdapter {
  private credentials: v.InferOutput<typeof igdbCredentialsSchema>;
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;
  constructor(
    credentials: unknown,
    private request: ProviderTransport = createProviderTransport({ baseUrl: IGDB_BASE_URL, provider: 'igdb', approved: true, allowedPorts: [443] }),
    private oauth: ProviderTransport = createProviderTransport({ baseUrl: TWITCH_BASE_URL, provider: 'igdb', approved: true, allowedPorts: [443], maxResponseBytes: 16384 }),
  ) {
    this.credentials = v.parse(igdbCredentialsSchema, credentials);
  }
  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const response = v.parse(tokenSchema, await this.oauth('/oauth2/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, grant_type: 'client_credentials' }).toString(),
      }));
      this.token = { value: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 - Math.min(60_000, response.expires_in * 100) };
      return this.token.value;
    })();
    try { return await this.tokenRequest; } finally { this.tokenRequest = undefined; }
  }
  private async requestQuery(body: string, endpoint: string) {
    try {
      let token = await this.accessToken();
      const send = () => inLane(this.credentials.clientId, () => this.request(`/v4/${endpoint}`, {
        method: 'POST', headers: { 'Client-ID': this.credentials.clientId, Authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'text/plain' }, body,
      }));
      let raw: unknown;
      try { raw = await send(); } catch (error) {
        if (!(error instanceof ProviderHttpError) || error.status !== 401) throw error;
        if (this.token?.value === token) this.token = undefined;
        token = await this.accessToken();
        raw = await send();
      }
      return raw;
    } catch (error) { providerError(error); }
  }
  private async query(body: string) {
    try {return v.parse(v.pipe(v.array(remoteGame), v.maxLength(IGDB_PAGE_SIZE)),await this.requestQuery(body,'games')).map(mapIgdbGame);} catch(error){providerError(error);}
  }
  async discover(section: 'trending' | 'recent') {
    if(section==='recent')return this.query(`fields ${expandedFields}; where version_parent = null & first_release_date != null & first_release_date <= ${Math.floor(Date.now()/1000)}; sort first_release_date desc; limit ${IGDB_PAGE_SIZE};`);
    const parsed=v.safeParse(v.pipe(v.array(v.object({game_id:v.pipe(v.number(),v.integer(),v.minValue(1))})),v.maxLength(IGDB_PAGE_SIZE)),await this.requestQuery(`fields game_id; where popularity_type = 1; sort value desc; limit ${IGDB_PAGE_SIZE};`,'popularity_primitives'));
    if(!parsed.success)throw new AppError(502,'IGDB returned invalid popularity data.','igdb_unavailable');
    const popularity=parsed.output;
    const ids=[...new Set(popularity.map(p=>p.game_id))];
    if(!ids.length)return [];
    const games=await this.query(`fields ${expandedFields}; where id = (${ids.join(',')}); limit ${IGDB_PAGE_SIZE};`);
    const byId=new Map(games.map(g=>[Number(g.externalId),g]));
    return ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
  }
  async steamMatches(ids:string[]) {
    const selected=ids.slice(0,50).map(id=>v.parse(v.pipe(v.string(),v.regex(/^[1-9][0-9]*$/)),id));
    if(!selected.length)return [];
    return this.query(`fields ${expandedFields}; where external_games.uid = (${selected.map(id=>JSON.stringify(id)).join(',')}); limit ${IGDB_PAGE_SIZE};`);
  }
  async verify() {
    await this.query('fields name; limit 1;');
  }
  async search(query: string, page = 1) {
    const search = v.parse(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250), v.check((value) => !/[\u0000-\u001f]/.test(value), 'Enter a valid search query.')), query);
    v.parse(pageSchema, page);
    const items = await this.query(`fields ${expandedFields}; search ${JSON.stringify(search)}; where version_parent = null; limit ${IGDB_PAGE_SIZE}; offset ${(page - 1) * IGDB_PAGE_SIZE};`);
    return { items, page, hasMore: items.length === IGDB_PAGE_SIZE };
  }
  async details(id: string) {
    v.parse(igdbIdSchema, id);
    const [game] = await this.query(`fields ${expandedFields}; where id = ${id}; limit 1;`);
    if (!game || game.externalId !== id) throw new AppError(404, 'IGDB game not found.', 'not_found');
    return game;
  }
  async recommendations(id:string){
    v.parse(igdbIdSchema,id);
    const [seed]=v.parse(v.array(v.object({similar_games:v.optional(v.array(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(Number.MAX_SAFE_INTEGER))),[])})),await this.requestQuery(`fields similar_games; where id = ${id}; limit 1;`,'games'));
    const ids=[...new Set(seed?.similar_games??[])].filter(value=>String(value)!==id).slice(0,20);
    if(!ids.length)return [];
    const games=await this.query(`fields ${expandedFields}; where id = (${ids.join(',')}); limit 20;`);
    return ids.flatMap(id=>games.filter(game=>game.externalId===String(id)));
  }
}
