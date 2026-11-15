import {afterAll,beforeAll,expect,test} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import {updateConfig} from '../src/lib/application/configuration.server';
import {authenticateSession,type SessionUser} from '../src/lib/server/auth';
import {registerAccount,beginOnboardingImports,onboardingStatus,backgroundOnboardingImports,retryBackgroundOnboardingImports} from '../src/lib/server/auth/onboarding';
import {accountDetails,changeMemberAccess,expireMemberships,manageAccount} from '../src/lib/server/auth/account-management.server';
import {createInvite,issueMemberInvite,inviteClaims,listInvites,memberInviteOverview,memberInviteGrant,previewInvite,regenerateInvite,requestMemberInvite,saveInvitePreset} from '../src/lib/server/auth/invites.server';
import {getFeatureConfig} from '../src/lib/server/features';
import {notifyMany} from '../src/lib/server/notifications';
import {markNotification,notificationInbox,notificationToasts} from '../src/lib/server/notifications/inbox';
import {saveConnection} from '../src/lib/providers/connections.server';
import {managedDetails,managedLibrary,managedRoute} from '../src/lib/server/auth/managed-library.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const admin:SessionUser={id:crypto.randomUUID(),username:'invite-admin',role:'admin',email:null,settings:{}};
const member:SessionUser={id:crypto.randomUUID(),username:'invite-member',role:'user',email:null,settings:{}};
const password='Invitation password!';
const account=(code:string,username:string,addInviter?:'on')=>({code,username,password,passwordConfirmation:password,displayName:username,addInviter});
let preset:string;
beforeAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  await getSql()`insert into users(id,username,role) values(${admin.id},${admin.username},'admin'),(${member.id},${member.username},'user')`;
  await updateConfig(admin,{registrationMode:'invite',registrationProvider:'none'});
  preset=(await saveInvitePreset(admin,{name:'Coast access',defaults:{access:{sharing:false},preferences:{theme:'light'}}})).id;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await closeDb();});

run('atomic multi-use claims, one-time secrets, regeneration and friendship',async()=>{
  const invite=await createInvite(admin,{maxUses:3,presetId:preset});
  expect(await previewInvite(invite.code,'multi')).toMatchObject({inviter:admin.username,preset:'Coast access'});
  const attempts=await Promise.allSettled(['multi-one','multi-two'].map(name=>registerAccount(account(invite.code,name,'on'),name,true)));
  expect(attempts.every(result=>result.status==='fulfilled')).toBe(true);
  const replaced=await regenerateInvite(admin,invite.id);
  await expect(previewInvite(invite.code,'old-code')).rejects.toThrow('invalid');
  const final=await registerAccount(account(replaced.code,'replacement','on'),'replacement',true);
  await expect(registerAccount(account(replaced.code,'too-many'),'too-many',true)).rejects.toThrow('invalid');
  const [choice]=await getSql()`select c.add_inviter,i.created_by,coast_feature_enabled(c.user_id,'social') as member_social,
    coast_feature_enabled(i.created_by,'social') as admin_social from invite_claims c join registration_invites i on i.id=c.invite_id where c.user_id=${final.user.id}`;
  expect(choice).toEqual({add_inviter:true,created_by:admin.id,member_social:true,admin_social:true});
  await beginOnboardingImports(final.user.id);
  await Promise.all([onboardingStatus(final.user.id),onboardingStatus(final.user.id)]);
  const claims=await inviteClaims(admin,replaced.id,null);
  expect(claims.items).toHaveLength(1);
  expect(claims.items[0].readyAt).toBeTruthy();
  const [friend]=await getSql()`select count(*)::int as matches from friendships where requested_by=${final.user.id} and state='accepted'`;
  expect(friend.matches).toBe(1);
  const notices=await getSql()<{user_id:string}[]>`select user_id from notifications where kind='friend-accepted'
    and user_id in (${admin.id},${final.user.id}) and data->>'subjectId' in (
      select id::text from friendships where requested_by=${final.user.id})`;
  expect(notices.map(item=>item.user_id).sort()).toEqual([admin.id,final.user.id].sort());
  expect(final.user.settings.theme).toBe('light');
  const [audit]=await getSql()`select count(*)::int as hits from account_audit where event='invite.ready' and actor_id=${final.user.id}`;
  expect(audit.hits).toBe(1);
});

run('member issuance quota and an approved extra stay bounded under concurrency',async()=>{
  await memberInviteGrant(admin,member.id,{presetId:preset,limit:1});
  const attempts=await Promise.allSettled([issueMemberInvite(member,{}),issueMemberInvite(member,{})]);
  expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const original=attempts.find(result=>result.status==='fulfilled');
  if(original?.status!=='fulfilled')throw new Error('One member invite must be issued.');
  const rotated=await regenerateInvite(admin,original.value.id);
  expect(rotated.id).toBe(original.value.id);
  await expect(previewInvite(original.value.code,'rotated-member')).rejects.toThrow('invalid');
  await expect(issueMemberInvite(member,{})).rejects.toThrow('allowance');
  await requestMemberInvite(member,{note:'A second invitation'});
  const [request]=await getSql()`select id from member_invite_requests where user_id=${member.id}`;
  const override=(await saveInvitePreset(admin,{name:'One-shot access',defaults:{access:{parties:false}}})).id;
  await memberInviteGrant(admin,member.id,{presetId:override,requestId:request.id,decision:'approved'});
  expect((await memberInviteOverview(member,new URLSearchParams())).grant).toEqual({quota:1,remaining:0,preset:'Coast access'});
  const extras=await Promise.allSettled([issueMemberInvite(member,{}),issueMemberInvite(member,{})]);
  expect(extras.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const extra=extras.find(result=>result.status==='fulfilled');
  if(extra?.status!=='fulfilled')throw new Error('An approved extra must issue once.');
  const oneShot=await previewInvite(extra.value.code,'authorized-once');
  expect(oneShot.preset).toBe('One-shot access');
  await memberInviteGrant(admin,member.id,{presetId:null});
  await expect(previewInvite(extra.value.code,'revoked-member')).rejects.toThrow('invalid');
});

run('expiry immediately invalidates sessions and renewal preserves manual suspension',async()=>{
  const invite=await createInvite(admin,{defaults:{membershipDays:1}});
  const result=await registerAccount(account(invite.code,'expiry-member'),'expiry-member',true);
  expect(await authenticateSession(result.token)).toBeTruthy();
  await expireMemberships();
  await expireMemberships();
  const reminders=await getSql()`select id from notifications where user_id=${result.user.id} and kind='membership-expiry'`;
  expect(reminders).toHaveLength(1);
  await getSql()`update users set membership_expires_at=now()-interval '1 second' where id=${result.user.id}`;
  expect(await authenticateSession(result.token)).toBeNull();
  await expireMemberships();
  await getSql()`update users set disabled=true where id=${result.user.id}`;
  await manageAccount(admin,result.user.id,{action:'membership',expiresAt:null});
  const details=await accountDetails(admin,result.user.id);
  expect(details.disabled).toBe(true);
  expect(details.expired).toBe(false);
  const obsolete=await getSql()`select id from notifications where user_id=${result.user.id} and kind='membership-expiry'`;
  expect(obsolete).toHaveLength(0);
  expect(await authenticateSession(result.token)).toBeNull();
});

run('access confirmation applies to the exact reviewed accounts and preset revision',async()=>{
  const preview=await changeMemberAccess(admin,{users:[member.id],presetId:preset});
  if(!preview.versions)throw new Error('Preview must return the reviewed versions.');
  await getSql()`update users set settings='{}'::jsonb where id=${member.id}`;
  await expect(changeMemberAccess(admin,{users:[member.id],presetId:preset,confirm:preview.versions})).rejects.toThrow('Preview');
  const fresh=await changeMemberAccess(admin,{users:[member.id],presetId:preset});
  await changeMemberAccess(admin,{users:[member.id],presetId:preset,confirm:fresh.versions});
  expect((await accountDetails(admin,member.id)).access).toMatchObject({sharing:false});
});

run('approval without a regular grant permits exactly one invite and does not create a standing grant',async()=>{
  const applicant={...member,id:crypto.randomUUID(),username:'one-shot-applicant'};
  await getSql()`insert into users(id,username,role) values(${applicant.id},${applicant.username},'user')`;
  await requestMemberInvite(applicant,{});
  const [request]=await getSql()`select id from member_invite_requests where user_id=${applicant.id}`;
  await memberInviteGrant(admin,applicant.id,{requestId:request.id,decision:'approved',presetId:preset});
  expect((await memberInviteOverview(applicant,new URLSearchParams())).request).toBe('approved');
  expect((await memberInviteOverview(applicant,new URLSearchParams())).grant).toBeNull();
  await issueMemberInvite(applicant,{});
  await expect(issueMemberInvite(applicant,{})).rejects.toThrow('allowance');
});

run('the failed-setup filter lists unresolved claims and drops them once setup is ready',async()=>{
  const invite=await createInvite(admin,{label:'Recoverable fixture'});
  const registered=await registerAccount(account(invite.code,'recoverable-member'),'recoverable',true);
  const filter=new URLSearchParams({status:'setup-failed'});
  expect((await listInvites(admin,filter)).items).toHaveLength(0);
  await getSql()`update invite_claims set setup_failed_at=now() where user_id=${registered.user.id}`;
  expect((await listInvites(admin,filter)).items.map(item=>item.id)).toEqual([invite.id]);
  expect((await inviteClaims(admin,invite.id,null)).items[0].failed).toBe(true);
  await beginOnboardingImports(registered.user.id);
  expect((await listInvites(admin,filter)).items).toHaveLength(0);
});

run('direct access edits bind confirmation to the exact reviewed draft and record the resulting changes',async()=>{
  await updateConfig(admin,{experimentalParties:true});
  expect((await getFeatureConfig(member.id)).features.parties).toBe(true);
  const defaults={access:{parties:false as const}};
  const reviewed=await changeMemberAccess(admin,{users:[member.id],defaults});
  const changed={access:{social:false}};
  await expect(changeMemberAccess(admin,{users:[member.id],defaults:changed,confirm:reviewed.versions})).rejects.toThrow('Preview');
  await changeMemberAccess(admin,{users:[member.id],defaults,confirm:reviewed.versions});
  const [access]=await getSql()`select coast_feature_enabled(${member.id}::uuid,'parties') as allowed from users where id=${member.id}`;
  expect(access.allowed).toBe(false);
  expect((await getFeatureConfig(member.id)).features.parties).toBe(false);
  const [audit]=await getSql()`select details from account_audit where subject_id=${member.id} and event='account.access-updated'
    order by created_at desc,id desc limit 1`;
  expect(audit.details.access.parties).toEqual({before:null,after:false});
});

run('a preset can grant ordinary playback sharing and a reviewed access change can revoke it',async()=>{
  const invite=await createInvite(admin,{defaults:{sharingGrant:true}});
  const accountOwner=await registerAccount(account(invite.code,'preset-shares'),'shared-grant',true);
  expect(accountOwner.user.settings.allowPlaybackSharing).toBe(true);
  const defaults={access:{sharing:false as const}};
  const review=await changeMemberAccess(admin,{users:[accountOwner.user.id],defaults});
  expect(review.changes?.[0].sharing).toEqual({before:true,after:false});
  await changeMemberAccess(admin,{users:[accountOwner.user.id],defaults,confirm:review.versions});
  expect((await accountDetails(admin,accountOwner.user.id)).sharingGranted).toBe(false);
});

run('completed onboarding shows and retries only the member’s current initial imports',async()=>{
  const db=getSql(),user=crypto.randomUUID(),source=crypto.randomUUID(),connection=crypto.randomUUID(),generation=crypto.randomUUID();
  const job=crypto.randomUUID(),other=crypto.randomUUID();
  await db`insert into users(id,username,role) values(${user},'import-member','user')`;
  await db`insert into provider_instances(id,provider,name,base_url) values(${source},'trakt','Trakt fixture','https://fixture.invalid')`;
  await db`insert into provider_connections(id,user_id,instance_id,status,account_generation)
    values(${connection},${user},${source},'connected',${generation})`;
  await db`insert into user_onboarding(user_id,trakt_connection_id,trakt_account_generation,completed_at,import_jobs)
    values(${user},${connection},${generation},now(),${{'trakt.import':job}}::jsonb)`;
  await db`insert into outbox_actions(id,user_id,connection_id,account_generation,kind,state,payload)
    values(${job},${user},${connection},${generation},'trakt.import','failed','{}'),
      (${other},${user},${connection},${generation},'trakt.lists-import','failed','{}')`;
  expect(await backgroundOnboardingImports(user)).toMatchObject([{label:'Trakt tracking',state:'failed',canRetry:true}]);
  await retryBackgroundOnboardingImports(member.id);
  expect(await backgroundOnboardingImports(user)).toMatchObject([{state:'failed'}]);
  await retryBackgroundOnboardingImports(user);
  expect(await backgroundOnboardingImports(user)).toMatchObject([{state:'pending',canRetry:false}]);
  const [unrelated]=await db`select state from outbox_actions where id=${other}`;
  expect(unrelated.state).toBe('failed');
});

run('Library-only members receive membership alerts without gaining access to other notifications',async()=>{
  const restricted={...member,access:{libraryOnly:true}};
  const [renewal,other]=await notifyMany([
    {userId:restricted.id,kind:'membership-expiry',sourceKey:'expiry-fixture',title:'Membership expires soon',level:'persistent'},
    {userId:restricted.id,kind:'administrator',sourceKey:'other-fixture',title:'Other notice'},
  ]);
  expect((await notificationToasts(restricted)).map(item=>item.id)).toEqual([renewal]);
  expect((await notificationInbox(restricted)).items.map(item=>item.id)).toEqual([renewal]);
  await expect(markNotification(restricted,other,'dismiss')).rejects.toThrow('no longer available');
  expect(await markNotification(restricted,renewal,'dismiss')).toMatchObject({updated:1});
  expect(managedRoute('/api/v1/notifications/broadcast','POST')).toBe(false);
});

run('Library-only browse and details admit only verified personal observations and accessible episodes',async()=>{
  const conn=crypto.randomUUID(), authority=crypto.randomUUID(), generation=crypto.randomUUID(), source=crypto.randomUUID();
  const show=crypto.randomUUID(), allowed=crypto.randomUUID(), hidden=crypto.randomUUID(), providerItem=crypto.randomUUID(), otherItem=crypto.randomUUID();
  const remote='a'.repeat(32);
  const db=getSql();
  await db`insert into provider_instances(id,provider,name,base_url) values(${source},'jellyfin','Source','https://fixture.invalid')`;
  await db`insert into provider_connections(id,user_id,instance_id,status,account_generation,external_user_id)
    values(${authority},${admin.id},${source},'connected',${generation},${'b'.repeat(32)}),
    (${conn},${member.id},${source},'connected',${generation},${remote})`;
  await db`insert into onboarding_provisioning(user_id,connection_id,account_generation,folders,remote_id,state)
    values(${member.id},${authority},${generation},'[]',${remote},'complete')`;
  await db`insert into sync_checkpoints(connection_id,kind,cursor,completed_at) values(${conn},'jellyfin-seed',${generation},now())`;
  await db`insert into media(id,kind,title) values(${show},'show','Shared title'),(${allowed},'episode','Visible episode'),(${hidden},'episode','A withheld episode')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${allowed},${show},1,1),(${hidden},${show},1,2)`;
  await db`insert into provider_items(id,instance_id,media_id,external_id,kind) values
    (${providerItem},${source},${allowed},${'c'.repeat(32)},'episode'),(${otherItem},${source},${hidden},${'d'.repeat(32)},'episode')`;
  await db`insert into availability(user_id,connection_id,media_id,provider_item_id,verified_at) values
    (${member.id},${conn},${allowed},${providerItem},now()),(${member.id},${conn},${hidden},${otherItem},now()-interval '25 hours')`;
  const reconnected=await saveConnection(member.id,source,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','invite-member',{accessToken:'test-only'}, {}, true);
  expect(reconnected.id).toBe(conn);
  const [reloaded]=await db`select account_generation from provider_connections where id=${conn}`;
  expect(reloaded.account_generation).toBe(generation);
  expect((await managedLibrary(member.id,new URLSearchParams())).items.map(item=>item.id)).toEqual([show]);
  expect((await managedDetails(member.id,show,null)).episodes.map(item=>item.id)).toEqual([allowed]);
  expect((await managedLibrary(member.id,new URLSearchParams({q:'Withheld'}))).items).toEqual([]);
  expect((await managedLibrary(member.id,new URLSearchParams({after:hidden}))).items).toEqual([]);
  await expect(managedDetails(member.id,hidden,null)).rejects.toThrow('unavailable');
  const [schedule]=await db`select coast_managed_schedule_open(${{jellyfin:{AccessSchedules:[{DayOfWeek:'Everyday',StartHour:0,EndHour:24}]},jellyfinTimeZone:'Europe/London'}}::jsonb) as open,
    coast_managed_schedule_open(${{jellyfin:{AccessSchedules:[{DayOfWeek:'Everyday',StartHour:0,EndHour:24}]},jellyfinTimeZone:'Unknown/Zone'}}::jsonb) as invalid`;
  expect(schedule).toEqual({open:true,invalid:false});
  expect(managedRoute('/api/v1/artwork/tmdb/poster/path','GET')).toBe(false);
  expect(managedRoute('/api/v1/media/'+hidden+'/insights','GET')).toBe(false);
  expect(managedRoute('/discover','GET')).toBe(false);
});
