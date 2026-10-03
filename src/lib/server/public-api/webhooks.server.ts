import * as v from 'valibot';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { and,eq,sql } from 'drizzle-orm';
import { getDb,type Database } from '$lib/server/db';
import { apiWebhooks,apiTokens,users,outboxActions } from '$lib/server/db/schema';
import { encryptCredential,decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch,validateProviderUrl,isAllowedAddress } from '$lib/server/security/provider-fetch';
import { randomToken } from '$lib/server/auth';
import { AppError } from '$lib/server/security/errors';
import { PermanentActionError,type OutboxAction } from '$lib/server/queue';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
export const webhookEvents=['tracking.changed','relationship.changed','rating.changed','music.listened','game.changed'] as const;
export type WebhookEvent=typeof webhookEvents[number];
export const webhookSchema=v.strictObject({url:v.pipe(v.string(),v.url(),v.maxLength(2048)),events:v.pipe(v.array(v.picklist(webhookEvents)),v.minLength(1),v.maxLength(webhookEvents.length))});
export function webhookSignature(secret:string,timestamp:string,body:string){return createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');}
export async function createWebhook(tx:Transaction,userId:string,tokenId:string,input:unknown){
 const data=v.parse(webhookSchema,input),url=new URL(data.url);
 if(url.protocol!=='https:'||url.search||url.hash||url.username||url.password)throw new AppError(400,'Use an HTTPS endpoint without credentials, query or fragment.','invalid_input');
 validateProviderUrl({baseUrl:data.url,approved:true,allowedPorts:[443]});
 const address=url.hostname.replace(/^\[|\]$/g,'');
 if(address==='localhost'||address.endsWith('.localhost')||isIP(address)&&!isAllowedAddress(address))throw new AppError(400,'Use a public webhook endpoint.','invalid_input');
 await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
 const existing=await tx.select({id:apiWebhooks.id}).from(apiWebhooks).where(and(eq(apiWebhooks.userId,userId),eq(apiWebhooks.enabled,true)));
 if(existing.length>=10)throw new AppError(409,'Remove an existing webhook before adding another.','webhook_limit');
 const secret=randomToken();
 const [row]=await tx.insert(apiWebhooks).values({userId,tokenId,url:data.url,events:[...new Set(data.events)],secret:await encryptCredential(secret)}).returning({id:apiWebhooks.id,url:apiWebhooks.url,events:apiWebhooks.events});
 return {...row,secret};
}
export async function emitWebhook(tx:Transaction,userId:string,type:WebhookEvent,data:Record<string,unknown>){
 const subscriptions=await tx.select({id:apiWebhooks.id}).from(apiWebhooks).innerJoin(apiTokens,eq(apiTokens.id,apiWebhooks.tokenId)).where(and(eq(apiWebhooks.userId,userId),eq(apiWebhooks.enabled,true),sql`${apiWebhooks.events} ? ${type}`,sql`${apiTokens.revokedAt} is null and ${apiTokens.expiresAt}>now()`));
 if(!subscriptions.length)return;
 const event={id:crypto.randomUUID(),type,occurredAt:new Date().toISOString(),data};
 await tx.insert(outboxActions).values(subscriptions.map(subscription=>({userId,kind:'webhook.deliver',payload:{subscriptionId:subscription.id,event}})));
}
export async function listWebhooks(userId:string){
 return getDb().select({id:apiWebhooks.id,url:apiWebhooks.url,events:apiWebhooks.events,enabled:apiWebhooks.enabled,createdAt:apiWebhooks.createdAt}).from(apiWebhooks).where(eq(apiWebhooks.userId,userId));
}
export async function removeWebhook(tx:Transaction,userId:string,id:string){
 const removed=await tx.update(apiWebhooks).set({enabled:false}).where(and(eq(apiWebhooks.id,id),eq(apiWebhooks.userId,userId))).returning({id:apiWebhooks.id});
 if(!removed.length)throw new AppError(404,'Webhook not found.','not_found');
 return {removed:true};
}
export async function deliverWebhook(action:OutboxAction){
 const subscriptionId=v.parse(v.pipe(v.string(),v.uuid()),action.payload.subscriptionId);
 const [entry]=await getDb().select({webhook:apiWebhooks,token:apiTokens,disabled:users.disabled}).from(apiWebhooks).innerJoin(apiTokens,eq(apiTokens.id,apiWebhooks.tokenId)).innerJoin(users,eq(users.id,apiWebhooks.userId)).where(and(eq(apiWebhooks.id,subscriptionId),eq(apiWebhooks.userId,action.userId)));
 if(!entry||!entry.webhook.enabled||entry.disabled||entry.token.revokedAt||entry.token.expiresAt<=new Date()||!entry.token.scopes.includes('webhooks:manage'))return;
 if(action.attempts>8)throw new PermanentActionError('Webhook delivery failed repeatedly. Review the endpoint before retrying.');
 const body=JSON.stringify(action.payload.event),timestamp=String(Math.floor(Date.now()/1000));
 const destination=new URL(entry.webhook.url);
 const response=await secureProviderFetch({baseUrl:destination.origin,approved:true,allowedPorts:[443],maxResponseBytes:65536,timeoutMs:10000},destination.pathname,{method:'POST',headers:{'content-type':'application/json','x-coast-event-id':String((action.payload.event as {id:string}).id),'x-coast-timestamp':timestamp,'x-coast-signature':`sha256=${webhookSignature(await decryptCredential(entry.webhook.secret),timestamp,body)}`},body});
 if(!response.ok){if(response.status>=400&&response.status<500&&![408,429].includes(response.status))throw new PermanentActionError('The webhook endpoint rejected delivery.');throw new Error('Webhook delivery could not be completed.');}
}
