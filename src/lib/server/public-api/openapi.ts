import { apiScopes } from '$lib/public-api';
import { webhookEvents } from './webhooks.server';
const uuid={type:'string',format:'uuid'},boolean={type:'boolean'},seconds={type:'number',minimum:0,maximum:2592000};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',additionalProperties:false,properties,required});
const sequence=object({kind:{type:'string',enum:['collection','playlist']},id:uuid,entryId:{type:'string',minLength:1,maxLength:4000}},['kind','id','entryId']);
const tracking=object({mediaId:uuid,sequence,action:{type:'string',enum:['watch','unwatch','progress','drop','restore']},value:boolean,positionSeconds:seconds,durationSeconds:seconds,editionId:{type:'string',maxLength:300},rewatch:boolean,acknowledged:boolean,occurredAtKnown:boolean,occurredAt:{type:'string',format:'date-time'}},['mediaId','action']);
const responses={'200':{description:'Successful response'},'201':{description:'Created'},'400':{description:'Invalid input or missing idempotency key'},'401':{description:'Invalid or expired Bearer token'},'403':{description:'Insufficient scope'},'404':{description:'Not found or medium disabled'},'409':{description:'Conflicting idempotency key or domain state'},'429':{description:'Token quota exceeded; Retry-After: 60'},'503':{description:'Service unavailable'}};
const parameters=(path:string)=>[...Array.from(path.matchAll(/\{([^}]+)\}/g),match=>({name:match[1],in:'path',required:true,schema:uuid}))];
function write(path:string,scope:string,schema?:unknown){return {description:`Requires ${scope}. Owner is always the token account.`,security:[{bearer:[]}],parameters:[...parameters(path),{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9_.:-]+$'}}],...(schema?{requestBody:{required:true,content:{'application/json':{schema}}}}:{}),responses};}
function read(description:string,path='',query:string[]=[]){return {description,security:[{bearer:[]}],parameters:[...parameters(path),...query.map(name=>({name,in:'query',schema:name==='page'?{type:'integer',minimum:1,maximum:10000}:{type:'string'}}))],responses};}
export const openApi={openapi:'3.1.0',info:{title:'Coast public API',version:'1.0.0',description:'Scoped account reads and writes. Durable retries use Idempotency-Key. Webhooks are signed, at-least-once events.'},servers:[{url:'/api/public/v1'}],components:{securitySchemes:{bearer:{type:'http',scheme:'bearer',bearerFormat:'coast token'}},schemas:{Scopes:{type:'array',items:{type:'string',enum:apiScopes}},Tracking:tracking,Playthrough:object({status:{type:'string',enum:['planned','in-progress'],default:'planned'},platform:{type:'string',minLength:1,maxLength:250},repeat:boolean}),PlaythroughUpdate:object({status:{type:'string',enum:['planned','in-progress','completed','paused','dropped']},progressPercent:{type:'number',minimum:0,maximum:100}}),GameSession:object({id:uuid,minutesPlayed:{type:'integer',minimum:1,maximum:1440},playedAt:{type:'string',format:'date-time'},note:{type:'string',maxLength:2000}},['id','minutesPlayed','playedAt'])}},paths:{
 '/me':{get:read('Token owner and permissions.')},
 '/catalogue':{get:read('Requires catalogue:read. Registered shared works.','',['page','category','kind'])},
 '/catalogue/{workId}':{get:read('Requires catalogue:read. One work.','/catalogue/{workId}')},
 '/collection':{get:read('Requires collection:read. Personal membership and availability.','',['page','level','category','kind','relationship','activity','availability','source'])},
 '/library':{get:read('Requires library:read. Accessible server works.','',['page','category','kind','source'])},
 '/progress':{get:read('Requires progress:read. Concrete personal progress; excludes private notes.','',['page','view','category','kind','scope'])},
 '/tracking':{post:write('/tracking','tracking:write',tracking)},
 '/tracking/bulk':{post:write('/tracking/bulk','tracking:write',object({mediaId:uuid,sequence,action:{type:'string',enum:['watch','unwatch','progress']},occurredAt:{type:'string',format:'date-time'},rewatch:boolean,includeSpecials:boolean,onReleaseDate:boolean,acknowledged:boolean},['mediaId','action']))},
 '/relationships/{workId}':{put:write('/relationships/{workId}','relationships:write',object({relationship:{type:'string',enum:['collected','saved','favourite']},value:boolean},['relationship','value']))},
 '/ratings/{workId}':{put:write('/ratings/{workId}','ratings:write',object({value:{type:['number','null'],minimum:0.5,maximum:5,multipleOf:0.5}},['value']))},
 '/music/{workId}/listens':{post:write('/music/{workId}/listens','music:write',object({batchId:uuid,occurredAt:{type:'string',format:'date-time'}},['batchId']))},
 '/games/{gameId}/playthroughs':{post:write('/games/{gameId}/playthroughs','games:write',{$ref:'#/components/schemas/Playthrough'})},
 '/playthroughs/{playthroughId}':{patch:write('/playthroughs/{playthroughId}','games:write',{$ref:'#/components/schemas/PlaythroughUpdate'})},
 '/playthroughs/{playthroughId}/sessions':{post:write('/playthroughs/{playthroughId}/sessions','games:write',{$ref:'#/components/schemas/GameSession'})},
 '/webhooks':{get:read('Requires webhooks:manage. Subscriptions without secrets.'),post:write('/webhooks','webhooks:manage',object({url:{type:'string',format:'uri',description:'Public HTTPS endpoint on port 443; no credentials, query or fragment.'},events:{type:'array',minItems:1,maxItems:5,items:{type:'string',enum:webhookEvents}}},['url','events']))},
 '/webhooks/{webhookId}':{delete:write('/webhooks/{webhookId}','webhooks:manage')},
}};
