import {beforeAll,afterAll,test,expect,mock} from 'bun:test';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import {createApiToken,revokeApiToken} from '../src/lib/server/public-api/tokens.server';
import {createFirstAdmin} from '../src/lib/server/auth';
import {createWebhook,emitWebhook,deliverWebhook,removeWebhook,webhookSignature} from '../src/lib/server/public-api/webhooks.server';
import type {OutboxAction} from '../src/lib/server/queue';
import * as transport from '../src/lib/server/security/provider-fetch';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let status=204,calls:{url:string;headers:Headers;body:string}[]=[];
if(process.env.COAST_DB_TEST==='1')mock.module('../src/lib/server/security/provider-fetch',()=>({...transport,secureProviderFetch:async(config:transport.ProviderFetchConfig,path:string,init:RequestInit)=>{calls.push({url:config.baseUrl+path,headers:new Headers(init.headers),body:String(init.body)});return new Response(null,{status});}}));
let owner:Awaited<ReturnType<typeof createFirstAdmin>>['user'],credential:Awaited<ReturnType<typeof createApiToken>>,subscription:Awaited<ReturnType<typeof createWebhook>>,action:OutboxAction;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 owner=(await createFirstAdmin({username:'webhook-fixture',password:'Webhook-fixture-pass!'})).user;
 credential=await createApiToken(owner,{name:'Events',scopes:['webhooks:manage']});
 subscription=await getDb().transaction(tx=>createWebhook(tx,owner.id,credential.id,{url:'https://example.com/coast/events',events:['tracking.changed']}));
 await getDb().transaction(tx=>emitWebhook(tx,owner.id,'tracking.changed',{workId:crypto.randomUUID(),action:'watch'}));
 const [row]=await getSql()`select id,user_id as "userId",payload from outbox_actions where kind='webhook.deliver'`;
 action={...row,kind:'webhook.deliver',connectionId:null,attempts:1,correlationId:'fixture'};
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1'){await closeDb();mock.restore();}});
run('delivery signs the exact immutable envelope and uses the configured endpoint',async()=>{
 await deliverWebhook(action);expect(calls).toHaveLength(1);expect(calls[0].url).toBe('https://example.com/coast/events');
 const event=JSON.parse(calls[0].body);expect(event.id).toBe(calls[0].headers.get('x-coast-event-id'));expect(event.data.action).toBe('watch');
 expect(calls[0].headers.get('x-coast-signature')).toBe('sha256='+webhookSignature(subscription.secret,calls[0].headers.get('x-coast-timestamp')!,calls[0].body));
});
run('retryable failures retain the event; permanent rejection requires review',async()=>{
 status=429;await expect(deliverWebhook({...action,attempts:2})).rejects.toThrow('could not be completed');expect(calls[1].body).toBe(calls[0].body);
 status=400;await expect(deliverWebhook({...action,attempts:3})).rejects.toThrow('rejected');status=204;
 await expect(deliverWebhook({...action,attempts:9})).rejects.toThrow('repeatedly');
});
run('subscription removal, token revocation and account disablement prevent queued deliveries',async()=>{
 const before=calls.length;await getDb().transaction(tx=>removeWebhook(tx,owner.id,subscription.id));await deliverWebhook(action);expect(calls).toHaveLength(before);
 await getSql()`update api_webhooks set enabled=true where id=${subscription.id}`;await getSql()`update users set disabled=true where id=${owner.id}`;await deliverWebhook(action);expect(calls).toHaveLength(before);
 await getSql()`update users set disabled=false where id=${owner.id}`;await revokeApiToken(owner,credential.id);await deliverWebhook(action);expect(calls).toHaveLength(before);
});
