import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { passwordSchema } from '$lib/auth/registration';
import { getJellyfin } from './connection.server';
import { connectJellyfin } from './connection.server';
import { AppError } from '$lib/server/security/errors';
import { randomToken } from '$lib/server/auth';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';

const remoteId=v.pipe(v.string(),v.regex(/^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/i));
export function provisionPolicy(policy:Record<string,unknown>,folders:string[]){
 return {...policy,IsAdministrator:false,IsDisabled:false,IsHidden:true,EnableAllFolders:false,EnabledFolders:folders,
  EnableContentDeletion:false,EnableContentDeletionFromFolders:[],EnableContentDownloading:false,EnablePublicSharing:false,
  EnableRemoteControlOfOtherUsers:false,EnableSharedDeviceControl:false,EnableLiveTvManagement:false,EnableCollectionManagement:false,
  EnableSubtitleManagement:false,EnableLyricManagement:false,EnableMediaConversion:false,EnableUserPreferenceAccess:true,EnableMediaPlayback:true};
}
export async function provisioningAuthority(userId:string,connectionId:string,generation?:string){
 const context=await getJellyfin(userId,connectionId);
 if(generation&&context.connection.accountGeneration!==generation)throw new AppError(409,'The provisioning account changed. Ask an administrator for a new invitation.');
 await context.adapter.identity(context.instance.serverIdentity??undefined);
 const policy=await context.adapter.userPolicy(context.connection.externalUserId!);
 if(!policy.administrator||policy.disabled)throw new AppError(403,'Provisioning requires an enabled Jellyfin administrator account.');
 return context;
}
export async function provisioningOffer(userId:string){
 const [offer]=await getSql()`select p.state,p.remote_id,c.instance_id,i.name from onboarding_provisioning p left join provider_connections c on c.id=p.connection_id left join provider_instances i on i.id=c.instance_id where p.user_id=${userId}`;
 return offer?{state:String(offer.state),name:String(offer.name??'Jellyfin')}:null;
}
export async function provisionOnboarding(userId:string,input:unknown){
 const data=v.parse(v.pipe(v.strictObject({password:passwordSchema,passwordConfirmation:v.string()}),v.check(input=>input.password===input.passwordConfirmation,'Passwords must match.')),input);
 const db=getSql();
 const [entry]=await db`select p.*,c.user_id as admin_id,u.username from onboarding_provisioning p join provider_connections c on c.id=p.connection_id join users u on u.id=p.user_id join users admin on admin.id=c.user_id where p.user_id=${userId} and not u.disabled and not admin.disabled and admin.role='admin' and exists(select 1 from user_onboarding o where o.user_id=p.user_id and o.completed_at is null)`;
 if(!entry)throw new AppError(403,'This invitation does not include Jellyfin provisioning.');
 if(['creating','uncertain'].includes(entry.state))throw new AppError(409,'The previous creation needs administrator review. Connect the reviewed Jellyfin account manually; Coast will not create a duplicate.');
 if(entry.state==='complete')throw new AppError(409,'Jellyfin is already provisioned.');
 const authority=await provisioningAuthority(entry.admin_id,entry.connection_id,entry.account_generation);
 const libraries=await authority.adapter.virtualFolders();
 if(!Array.isArray(entry.folders)||!entry.folders.length||entry.folders.some((id:string)=>!libraries.some(library=>library.ItemId===id)))throw new AppError(409,'The permitted libraries changed. Ask an administrator for a new invitation.');
 const [lease]=await db`update onboarding_provisioning set state='creating',updated_at=now() where user_id=${userId} and state=${entry.state} returning user_id`;
 if(!lease)throw new AppError(409,'Provisioning is already in progress.');
 let id=entry.remote_id as string|null;
 try{
  if(!id){
   // The user never sees the initial random password. Access is restricted before their chosen password is set.
   const created=await authority.adapter.createUser(entry.username,randomToken());
   id=v.parse(remoteId,created.Id);
   await db`update onboarding_provisioning set remote_id=${id},state='configuring',updated_at=now() where user_id=${userId}`;
  }
  const remote=await authority.adapter.userForProvisioning(id);
  if(remote.Name.toLowerCase()!==entry.username.toLowerCase())throw new AppError(409,'Provisioned account identity changed. Administrator review is required.');
  await authority.adapter.setProvisionPolicy(id,provisionPolicy(remote.Policy,entry.folders));
  await authority.adapter.setProvisionPassword(id,data.password);
  const connection=await connectJellyfin(userId,{instanceId:authority.instance.id,username:entry.username,password:data.password});
  await db`update user_onboarding o set connection_id=c.id,account_generation=c.account_generation,requested_at=now() from provider_connections c where o.user_id=${userId} and o.completed_at is null and c.id=${connection.id} and c.user_id=o.user_id`;
  await db`update onboarding_provisioning set state='complete',updated_at=now() where user_id=${userId}`;
 }catch(cause){
  // Lost create responses cannot safely be attributed to Coast. Never adopt an existing account by name.
  const state=id?'configuring':cause instanceof ProviderHttpError&&cause.status>=400&&cause.status<500?'pending':'uncertain';
  await db`update onboarding_provisioning set state=${state},updated_at=now() where user_id=${userId}`;
  throw new AppError(502,id?'Jellyfin was created but setup is incomplete. Retry with the same password or connect it manually.':'Jellyfin creation did not complete. If its outcome is uncertain, an administrator must review the server.');
 }
}
