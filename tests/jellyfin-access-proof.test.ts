import {expect,test} from 'bun:test';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {unrestrictedScreenPolicy,screenCensusMaxAgeMs} from '../src/lib/providers/jellyfin/access-proof.server';
import {providerSchedule} from '../src/lib/providers/schedule';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';

const policy={IsDisabled:false,EnableMediaPlayback:true,EnableRemoteAccess:true,EnableAllDevices:true,EnableAllFolders:true,
  EnabledFolders:[],BlockedMediaFolders:[],BlockedTags:[],AllowedTags:[],BlockUnratedItems:[],AccessSchedules:[]};
test('cache age follows the configured full census cadence with bounded recent-scan grace',()=>{
  expect(screenCensusMaxAgeMs()).toBe(24*3600000+10*60000);
  expect(screenCensusMaxAgeMs({...providerSchedule('jellyfin'),fullIntervalHours:4,intervalMinutes:120})).toBe(5*3600000);
  expect(screenCensusMaxAgeMs({fullIntervalHours:100000})).toBe(screenCensusMaxAgeMs());
});
test('known null-omitting policy JSON supports unrestricted and explicit folder scope but rejects unknown item restrictions',()=>{
  expect(unrestrictedScreenPolicy(policy)).not.toBeNull();
  expect(unrestrictedScreenPolicy({...policy,MaxParentalRating:null,MaxParentalSubRating:null})).toBe(unrestrictedScreenPolicy(policy));
  expect(unrestrictedScreenPolicy({...policy,EnableAllFolders:false,EnabledFolders:['a'.repeat(32)],BlockedMediaFolders:['b'.repeat(32)]})).not.toBeNull();
  for(const change of [{MaxParentalRating:0},{MaxParentalSubRating:1},{IsDisabled:true},{EnableMediaPlayback:false},{EnableAllDevices:false},
    {BlockedTags:['private']},{AllowedTags:['public']},{BlockUnratedItems:['Movie']},{AccessSchedules:[{}]},{NewPolicyFlag:false}])
    expect(unrestrictedScreenPolicy({...policy,...change})).toBeNull();
  const {BlockedTags,...missing}=policy;expect(unrestrictedScreenPolicy(missing)).toBeNull();
});

test('access proof reads the token-owned account and actual authenticated library IDs',async()=>{
  const id='a'.repeat(32),requests:string[]=[];
  const adapter=new JellyfinAdapter(async(path,init)=>{
    requests.push(path);expect(new Headers(init?.headers).get('Authorization')).toContain('Token="fixture"');
    if(path==='/Users/Me')return {Id:id,ServerId:'server',Policy:policy};
    return [{Id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},{Id:'c'.repeat(32)}];
  },'device','fixture');
  expect((await adapter.accessIdentity(id)).Policy).toEqual(policy);
  expect(await adapter.screenLibraries(id)).toEqual(['b'.repeat(32),'c'.repeat(32)]);
  expect(requests[0]).toBe('/Users/Me');expect(requests[1]).toBe(`/UserViews/GroupingOptions?userId=${id}`);
  await expect(adapter.accessIdentity('d'.repeat(32))).rejects.toThrow('unexpected user identity');
});

test('library IDs and upstream auth failures cannot silently become a cache proof',async()=>{
  for(const folders of [[{Id:'not-a-guid'}],[{Id:'a'.repeat(32)},{Id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}]])
    await expect(new JellyfinAdapter(async()=>folders,'device').screenLibraries('user')).rejects.toThrow('invalid library identities');
  await expect(new JellyfinAdapter(async()=>{throw new ProviderHttpError(401);},'device').accessIdentity('user')).rejects.toBeInstanceOf(ProviderHttpError);
});
