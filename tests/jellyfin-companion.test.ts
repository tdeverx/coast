import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {companionPageSchema,companionPlan,validateCompanionPage,companionHealthy,type CompanionPage} from '../src/lib/providers/jellyfin/companion';
import {providerSchedule} from '../src/lib/providers/schedule';
import {serviceTasks} from '../src/lib/providers/tasks';
import {eligibleTaskAccounts,taskDue,type TaskAccount} from '../src/lib/providers/task-timing';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
const epoch='a'.repeat(32),item='b'.repeat(32),user='c'.repeat(32),now=Date.parse('2026-10-07T10:00:00Z');
const page=(patch:Partial<CompanionPage>={}):CompanionPage=>({protocol:1,serverId:'server',epoch,cursor:1,reset:false,more:false,changes:[],sessions:[],...patch});
const change=(Sequence:number,Kind:CompanionPage['changes'][number]['Kind'],ItemType='Movie')=>({Sequence,Kind,ItemId:item,UserId:user,ItemType});
test('native plugin contract strips credentials and paths from sessions',()=>{
 const parsed=v.parse(companionPageSchema,page({sessions:[{Id:'session',UserId:user,NowPlayingItem:{Id:item,Name:'Movie'},PlayState:{IsPaused:false},...{AccessToken:'secret',RemoteEndPoint:'private'}}]}));
 expect(JSON.stringify(parsed)).not.toContain('secret');expect(JSON.stringify(parsed)).not.toContain('private');
 expect(()=>v.parse(companionPageSchema,page({protocol:2 as 1}))).toThrow();
});
test('cursor ordering, identity and partial batches are validated before acknowledgement',()=>{
 const previous={epoch,cursor:1};
 expect(()=>validateCompanionPage(page({cursor:2,changes:[change(2,'user-data')]}),previous,'server')).not.toThrow();
 expect(()=>validateCompanionPage(page(),previous,'server')).not.toThrow();
 expect(()=>validateCompanionPage(page({cursor:4,changes:[change(4,'user-data')]}),previous,'server')).not.toThrow();
 for(const invalid of [page({serverId:'other'}),page({epoch:'d'.repeat(32)}),page({cursor:0}),page({cursor:3,changes:[change(3,'user-data'),change(2,'user-data')]}),page({cursor:2}),page({cursor:3,changes:[change(2,'user-data')]}),page({more:true}),page({reset:true,changes:[change(1,'user-data')]})])
  expect(()=>validateCompanionPage(invalid,previous,'server')).toThrow();
 expect(()=>validateCompanionPage(page({epoch:'d'.repeat(32),reset:true}),previous,'server')).not.toThrow();
});
test('last item state wins, personal data stays scoped and unsupported types are ignored',()=>{
 const plan=companionPlan(page({cursor:6,changes:[change(1,'item-removed'),change(2,'item-updated'),change(3,'user-data','Audio'),change(4,'user-updated'),{...change(5,'user-data','Photo'),UserId:'d'.repeat(32)},change(6,'user-data')]}));
 expect(plan.removed).toEqual([]);expect(plan.video).toEqual([item]);expect(plan.personal.get(user)?.permissions).toBe(true);
 expect([...plan.personal.get(user)!.video]).toEqual([item]);expect([...plan.personal.get(user)!.music]).toEqual([item]);
 expect(plan.personal.get('d'.repeat(32))?.video.size).toBe(0);
});
test('healthy plugin schedules retain reconciliation and manual fallback; stale feeds restore native cadence',()=>{
 const schedule=providerSchedule('jellyfin'),account:TaskAccount={id:'source',externalUserId:user,role:'admin',settings:{},userCompleted:new Date(now-60000)};
 const settings={companion:{connectionId:'source',generation:'generation',checkedAt:new Date(now).toISOString(),status:'healthy' as const},libraryScan:{connectionId:'source',externalUserId:user,fullCompletedAt:new Date(now-60000).toISOString()}};
 const task=(kind:string)=>serviceTasks('jellyfin').find(t=>t.kinds[0]===kind)!;
 expect(taskDue(task('jellyfin.live'),schedule,settings,account,{},now).at).toBeNull();
 expect(taskDue(task('jellyfin.streams'),schedule,settings,account,{},now).at).toBeNull();
 expect(taskDue(task('jellyfin.sync'),schedule,settings,account,{},now).at).toBe(now-60000+86400000);
 expect(taskDue(task('jellyfin.library'),schedule,settings,account,{},now).at).toBe(now-60000+86400000);
 expect(taskDue(task('jellyfin.live'),schedule,settings,account,{},now,true).at).toBe(now);
 expect(taskDue(task('jellyfin.live'),{...schedule,updatesEnabled:false},settings,account,{},now).at).toBe(now);
 expect(taskDue(task('jellyfin.live'),schedule,settings,account,{},now+4*60000).at).toBe(now+4*60000);
 expect(taskDue(task('jellyfin.live'),{...schedule,streamsConnectionId:'different'},settings,account,{},now).at).toBe(now);
 expect(companionHealthy(settings.companion,now-1,1)).toBe(false);
 expect(eligibleTaskAccounts('jellyfin.updates',[{...account,role:'user'},account],schedule,{},true)).toEqual([account]);
});
test('companion discovery backs off when absent, while authenticated requests retain the token header',async()=>{
 let request='';let auth='';
 const adapter=new JellyfinAdapter(async(path,init)=>{request=path;auth=new Headers(init?.headers).get('Authorization')!;return page();},'device','token');
 await adapter.companionChanges(epoch,40);expect(request).toBe(`/Coast/Changes?cursor=40&epoch=${epoch}`);expect(request).not.toContain('token');expect(auth).toContain('token');
 const task=serviceTasks('jellyfin').find(t=>t.kinds[0]==='jellyfin.updates')!;
 expect(taskDue(task,providerSchedule('jellyfin'),{companion:{connectionId:'a',generation:'b',checkedAt:new Date(now).toISOString(),status:'unavailable'}},{id:'a',externalUserId:user,role:'admin',settings:{}},{completed:new Date(now)},now).at).toBe(now+10*60000);
});
