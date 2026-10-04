import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { AppError } from '$lib/server/security/errors';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
export const STEAM_BASE_URL = 'https://api.steampowered.com';
export const steamIdSchema = v.pipe(v.string(), v.regex(/^\d{17}$/), v.check(id => /^\d{17}$/.test(id) && BigInt(id) >= 76561197960265728n && BigInt(id) <= 76561202255233023n));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const appId = v.pipe(count, v.minValue(1));
const owned = v.object({
  appid: appId, name: v.pipe(v.string(),v.minLength(1),v.maxLength(250)),
  playtime_forever: count, playtime_2weeks: v.optional(count,0),
  rtime_last_played: v.optional(count,0), has_community_visible_stats: v.optional(v.boolean(),false),
});
export type SteamOwnedGame = v.InferOutput<typeof owned>;
export class SteamAdapter {
  constructor(private call: ProviderTransport, private apiKey: string) {}
  private get(path: string, parameters: Record<string,string> = {}) {
    // Keep API keys out of URLs and diagnostic query strings.
    return this.call(path + '?' + new URLSearchParams(parameters), {headers:{'x-webapi-key':this.apiKey}});
  }
  async profile(steamId: string) {
    v.parse(steamIdSchema,steamId);
    const result = v.parse(v.object({response:v.object({players:v.array(v.object({steamid:steamIdSchema,personaname:v.string(),gameid:v.optional(v.string())}))})}),await this.get('/ISteamUser/GetPlayerSummaries/v2/',{steamids:steamId}));
    const profile=result.response.players.find(p=>p.steamid===steamId);
    if(!profile)throw new AppError(502,'Steam did not return this account.');
    return {id:profile.steamid,username:profile.personaname,playingId:profile.gameid ?? null};
  }
  async ownedGames(steamId:string) {
    v.parse(steamIdSchema,steamId);
    const response=v.parse(v.object({response:v.object({game_count:v.optional(count),games:v.optional(v.array(owned))})}),await this.get('/IPlayerService/GetOwnedGames/v1/',{steamid:steamId,include_appinfo:'true',include_played_free_games:'true',include_free_sub:'true'})).response;
    if(response.game_count===undefined || (response.game_count>0&&!response.games))
      throw new AppError(409,'Steam game details are private or unavailable. Previous imports are retained.','steam_private');
    const games=response.games??[];
    if(new Set(games.map(g=>g.appid)).size!==response.game_count || games.length!==response.game_count)
      throw new AppError(502,'Steam returned an incomplete game library. Previous ownership is retained.');
    return games;
  }
  async achievements(steamId:string,id:number) {
    v.parse(steamIdSchema,steamId);v.parse(appId,id);
    let response: unknown;
    try {
      response=await this.get('/ISteamUserStats/GetPlayerAchievements/v1/',{steamid:steamId,appid:String(id),l:'english'});
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status===403) {
        const denial=v.safeParse(v.object({playerstats:v.object({success:v.literal(false),error:v.literal('Profile is not public')})}),error.responseBody);
        if (denial.success) throw new AppError(409,'Steam achievements are private or unavailable. Previous progress is retained.','steam_private');
      }
      throw error;
    }
    const result=v.parse(v.object({playerstats:v.object({steamID:v.optional(steamIdSchema),success:v.boolean(),achievements:v.optional(v.array(v.object({apiname:v.string(),achieved:v.picklist([0,1]),unlocktime:v.optional(count,0)})))})}),response).playerstats;
    if(!result.success || result.steamID && result.steamID!==steamId)throw new AppError(409,'Steam achievements are private or unavailable. Previous progress is retained.','steam_private');
    return result.achievements??[];
  }
  async achievementSchema(id:number) {
    v.parse(appId,id);
    const result=v.parse(v.object({game:v.object({availableGameStats:v.optional(v.object({achievements:v.optional(v.array(v.object({name:v.string(),displayName:v.string(),description:v.optional(v.string(),''),hidden:v.optional(v.picklist([0,1]),0),icon:v.optional(v.string()),icongray:v.optional(v.string())}))) }))})}),await this.get('/ISteamUserStats/GetSchemaForGame/v2/',{appid:String(id),l:'english'}));
    return result.game.availableGameStats?.achievements??[];
  }
}
