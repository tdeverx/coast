import * as v from 'valibot';
import { getSql } from '#lib/server/db/index.js';
import { jellyfinUserId, provisioningAccessWindows, type JellyfinSettings } from '#lib/auth/invites.js';
import { passwordSchema } from '#lib/auth/registration.js';
import { connectJellyfin, getJellyfin } from './connection.server';
import { AppError } from '#lib/server/security/errors.js';
import { checkLoginRate, randomToken } from '#lib/server/auth/index.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';

export function provisionPolicy(policy:Record<string,unknown>,folders:string[],settings:JellyfinSettings={}){
 return {...policy,IsAdministrator:false,IsDisabled:false,IsHidden:true,EnableAllFolders:false,EnabledFolders:folders,
  EnableContentDeletion:false,EnableContentDeletionFromFolders:[],EnableContentDownloading:false,EnablePublicSharing:false,
  EnableRemoteControlOfOtherUsers:false,EnableSharedDeviceControl:false,EnableLiveTvManagement:false,EnableLiveTvAccess:false,EnableAllChannels:false,EnabledChannels:[],EnableCollectionManagement:false,
  EnableSubtitleManagement:false,EnableLyricManagement:false,EnableMediaConversion:false,EnableUserPreferenceAccess:true,EnableMediaPlayback:true,...settings};
}
export function verifyProvisionPolicy(applied:Record<string,unknown>,expected:Record<string,unknown>,settings:JellyfinSettings) {
 function normalize(key:string,value:unknown) {
  const normalized=key==='AccessSchedules' ? provisioningAccessWindows(value) : value;
  return Array.isArray(normalized) ? normalized.map(item=>JSON.stringify(item)).sort() : normalized ?? null;
 }
 const keys=['IsAdministrator','IsDisabled','EnableAllFolders','EnabledFolders','EnableLiveTvAccess','EnableAllChannels',...Object.keys(settings ?? {})];
 if(keys.some(key=>JSON.stringify(normalize(key,applied[key]))!==JSON.stringify(normalize(key,expected[key]))))
   throw new Error('Jellyfin did not confirm the requested policy.');
}
export async function provisioningAuthority(userId:string,connectionId:string,generation?:string){
 const [admin]=await getSql()`select 1 from users where id=${userId} and role='admin' and not disabled`;
 if(!admin)throw new AppError(403,'Provisioning requires an active Coast administrator.');
 const context=await getJellyfin(userId,connectionId);
 if(generation&&context.connection.accountGeneration!==generation)throw new AppError(409,'The provisioning account changed. Ask an administrator for a new invitation.');
 await context.adapter.identity(context.instance.serverIdentity??undefined);
 const policy=await context.adapter.userPolicy(context.connection.externalUserId!);
 if(!policy.administrator||policy.disabled)throw new AppError(403,'Provisioning requires an enabled Jellyfin administrator account.');
 return context;
}
export async function provisioningOffer(userId:string){
 const [offer]=await getSql()`select p.state,p.remote_id,p.updated_at,c.instance_id,i.name from onboarding_provisioning p left join provider_connections c on c.id=p.connection_id left join provider_instances i on i.id=c.instance_id where p.user_id=${userId}`;
 return offer ? {state:String(offer.state),name:String(offer.name??'Jellyfin'),
  canRetry:!!offer.remote_id && Date.now()-new Date(offer.updated_at).getTime()>120000} : null;
}
export async function provisionOnboarding(userId:string,input:unknown){
 checkLoginRate('provision:'+userId);
 const password=v.parse(passwordSchema,typeof input==='string'?input:v.parse(v.pipe(v.strictObject({password:passwordSchema,passwordConfirmation:v.string()}),v.check(data=>data.password===data.passwordConfirmation,'Passwords must match.')),input).password);
 const db=getSql();
 const [entry]=await db`select p.*,c.user_id as admin_id,u.username,u.password_hash,i.defaults from onboarding_provisioning p left join invite_claims claim on claim.user_id=p.user_id left join registration_invites i on i.id=claim.invite_id join provider_connections c on c.id=p.connection_id join users u on u.id=p.user_id join users admin on admin.id=c.user_id where p.user_id=${userId} and not u.disabled and not admin.disabled and admin.role='admin' and exists(select 1 from user_onboarding o where o.user_id=p.user_id and o.completed_at is null)`;
 if(!entry)throw new AppError(403,'This invitation does not include Jellyfin provisioning.');
 if(entry.defaults && (!entry.password_hash || !await Bun.password.verify(password,entry.password_hash))) throw new AppError(403,'Enter your Coast password to finish setting up Jellyfin.');
 if(['creating','uncertain'].includes(entry.state) && !(entry.remote_id && Date.now()-new Date(entry.updated_at).getTime()>120000))throw new AppError(409,'The previous creation needs administrator review. Connect again after an administrator reviews this claim.');
 if(entry.state==='complete')throw new AppError(409,'Jellyfin is already provisioned.');
 const authority=await provisioningAuthority(entry.admin_id,entry.connection_id,entry.account_generation);
 const libraries=await authority.adapter.virtualFolders();
 if(!Array.isArray(entry.folders)||!entry.folders.length||entry.folders.some((id:string)=>!libraries.some(library=>library.ItemId===id)))throw new AppError(409,'The permitted libraries changed. Ask an administrator for a new invitation.');
 const [lease]=await db`update onboarding_provisioning set state='creating',updated_at=now() where user_id=${userId} and state=${entry.state} and date_trunc('milliseconds',updated_at)=${entry.updated_at} returning user_id`;
 if(!lease)throw new AppError(409,'Provisioning is already in progress.');
 let id=entry.remote_id as string|null;
 try{
  if(!id){
   const [current]=await db`select 1 from provider_connections c join users admin on admin.id=c.user_id
     where c.id=${entry.connection_id} and c.account_generation=${entry.account_generation} and c.status='connected' and not admin.disabled and admin.role='admin'`;
   if(!current)throw new AppError(409,'The provisioning account changed.');
   // The user never sees the initial random password. Access is restricted before their chosen password is set.
   const created=await authority.adapter.createUser(entry.username,randomToken());
   id=v.parse(jellyfinUserId,created.Id);
   await db`update onboarding_provisioning set remote_id=${id},updated_at=now() where user_id=${userId}`;
  }
  const remote=await authority.adapter.userForProvisioning(id);
  if(remote.Name.toLowerCase()!==entry.username.toLowerCase())throw new AppError(409,'Provisioned account identity changed. Administrator review is required.');
  const expected=provisionPolicy(remote.Policy,entry.folders,entry.defaults?.jellyfin);
  await authority.adapter.setProvisionPolicy(id,expected);
  if (entry.defaults) {
    const applied=(await authority.adapter.userForProvisioning(id)).Policy;
    verifyProvisionPolicy(applied,expected,entry.defaults.jellyfin);
  }
  await authority.adapter.setProvisionPassword(id,password);
  const started=new Date();
  const connection=await connectJellyfin(userId,{instanceId:authority.instance.id,username:entry.username,password},entry.defaults ? id : undefined);
  await db.begin(async tx=>{
   await tx`update user_onboarding o set connection_id=c.id,account_generation=c.account_generation,requested_at=${started}
     from provider_connections c where o.user_id=${userId} and o.completed_at is null and c.id=${connection.id} and c.user_id=o.user_id`;
   await tx`update onboarding_provisioning set state='complete',active_defaults=${entry.defaults ?? null}::jsonb,updated_at=now() where user_id=${userId}`;
  });
 }catch(cause){
  // Lost create responses cannot safely be attributed to Coast. Never adopt an existing account by name.
  const state=id?'configuring':cause instanceof AppError || cause instanceof ProviderHttpError&&cause.status>=400&&cause.status<500?'pending':'uncertain';
  await db`update onboarding_provisioning set state=${state},updated_at=now() where user_id=${userId}`;
  if(entry.defaults)await db`insert into account_audit(event,subject_id) values('invite.provisioning-failed',${userId})`;
  throw new AppError(502,id?'Jellyfin was created but setup is incomplete. Retry with your Coast password.':'Jellyfin creation did not complete. If its outcome is uncertain, an administrator must review the server.');
 }
}
