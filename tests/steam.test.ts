import { describe, expect, test } from 'bun:test';
import { SteamAdapter } from '../src/lib/providers/steam/adapter.server';
import { steamAssertion, steamLoginUrl } from '../src/lib/providers/steam/connection.server';
import { mapIgdbGame } from '../src/lib/providers/igdb/adapter.server';
const id='76561198000000000';
describe('Steam provider contracts',()=>{
  test('ownership uses an API key header and distinguishes private, incomplete, and empty libraries',async()=>{
    let raw:unknown={response:{game_count:1,games:[{appid:10,name:'Fixture',playtime_forever:42}]}};
    const adapter=new SteamAdapter(async(path,init)=>{
      expect(path).not.toContain('secret');expect(new Headers(init?.headers).get('x-webapi-key')).toBe('secret');
      expect(new URL(path,'https://api.steampowered.com').searchParams.get('steamid')).toBe(id);return raw;
    },'secret');
    expect((await adapter.ownedGames(id))[0].playtime_forever).toBe(42);
    raw={response:{}};await expect(adapter.ownedGames(id)).rejects.toThrow('private');
    raw={response:{game_count:2,games:[{appid:10,name:'Fixture',playtime_forever:42}]}};await expect(adapter.ownedGames(id)).rejects.toThrow('incomplete');
    raw={response:{game_count:0}};expect(await adapter.ownedGames(id)).toEqual([]);
  });
  test('achievement reads retain Steam unlock facts and reject failed or different-account responses',async()=>{
    let raw:unknown={playerstats:{steamID:id,success:true,achievements:[{apiname:'DONE',achieved:1,unlocktime:0}]}};
    const adapter=new SteamAdapter(async()=>raw,'secret');
    expect((await adapter.achievements(id,10))[0].unlocktime).toBe(0);
    raw={playerstats:{steamID:'76561198000000001',success:true}};await expect(adapter.achievements(id,10)).rejects.toThrow('private');
    raw={playerstats:{success:false}};await expect(adapter.achievements(id,10)).rejects.toThrow('private');
  });
  test('OpenID pins the issuer, signed account identity, callback, nonce and rejects duplicate parameters',()=>{
    const returnTo='http://localhost:5173/connections/steam/callback?state=fixture';
    const login=new URL(steamLoginUrl(returnTo));expect(login.hostname).toBe('steamcommunity.com');expect(login.searchParams.get('openid.return_to')).toBe(returnTo);
    const parameters=new URLSearchParams({'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'id_res','openid.op_endpoint':'https://steamcommunity.com/openid/login','openid.return_to':returnTo,'openid.identity':`https://steamcommunity.com/openid/id/${id}`,'openid.claimed_id':`https://steamcommunity.com/openid/id/${id}`,'openid.response_nonce':new Date().toISOString().replace(/\.\d{3}Z/,'Z')+'nonce','openid.assoc_handle':'fixture','openid.signed':'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle','openid.sig':'fixture'});
    expect(steamAssertion(parameters,returnTo).id).toBe(id);
    expect(()=>steamAssertion(parameters,returnTo+'x')).toThrow('verification');
    const unsigned=new URLSearchParams(parameters);unsigned.set('openid.signed','return_to');expect(()=>steamAssertion(unsigned,returnTo)).toThrow('unsigned');
    const hostile=new URLSearchParams(parameters);hostile.set('openid.op_endpoint','https://attacker.test/');expect(()=>steamAssertion(hostile,returnTo)).toThrow('verification');
    const expired=new URLSearchParams(parameters);expired.set('openid.response_nonce','2000-01-01T00:00:00Znonce');expect(()=>steamAssertion(expired,returnTo)).toThrow('expired');
    parameters.append('openid.sig','duplicate');expect(()=>steamAssertion(parameters,returnTo)).toThrow('duplicate');
  });
  test('IGDB identities require an exact Steam store link and matching AppID',()=>{
    const game=mapIgdbGame({id:1,name:'Fixture',external_games:[{uid:'10',url:'https://store.steampowered.com/app/10/Fixture/'},{uid:'20',url:'https://store.steampowered.com/app/21/'},{uid:'30',url:'https://store.steampowered.com.attacker.test/app/30/'}]});
    expect(game.identities).toEqual([{provider:'steam',externalId:'10'}]);
  });
});
