import {expect,test} from 'bun:test';
import {encodingBitrate} from '../src/lib/sharing/policy';
const requestSource=await Bun.file(new URL('../src/lib/sharing/request-leases.server.ts',import.meta.url)).text();
const compile=(text:string)=>new Bun.Transpiler({loader:'ts'}).transformSync(text.replace(/^import .*\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function'));
function requests(db:any,clock:{new(value?:any):Date;now():number}=Date,timer:typeof setTimeout=setTimeout,clear:typeof clearTimeout=clearTimeout){return new Function('getSql','AppError','Date','setTimeout','clearTimeout',compile(requestSource)+';return {withSharedRequest,waitSharedRequests,waitSharedRetry};')(()=>db,Error,clock,timer,clear);}
function virtualTime(){let now=0,sequence=0;const callbacks=new Map<number,{at:number;fn:()=>void}>();return {get now(){return now;},Date:class extends Date{constructor(value?:any){super(value===undefined?now:value);}static now(){return now;}},timer:((fn:()=>void,ms:number)=>{const id=++sequence;if(ms<=250){now+=ms;for(const [id,callback]of callbacks)if(callback.at<=now){callbacks.delete(id);callback.fn();}queueMicrotask(fn);}else callbacks.set(id,{at:now+ms,fn});return id;}) as unknown as typeof setTimeout,clear:((id:number)=>callbacks.delete(id)) as unknown as typeof clearTimeout};}

test('saturated admission backs off while preserving eight dispatch slots and bounded latency',async()=>{
 const time=virtualTime();let queries=0,transactions=0,dispatches=0;
 const tx=async(parts:TemplateStringsArray)=>{queries++;const sql=parts.join('?');if(sql.startsWith('select v.'))return [{state:'active',expires_at:new Date(1e9),ended_at:null,preparing_until:null}];if(sql.startsWith('select count'))return [{total:time.now<1000?8:0}];return [];};
 const db=Object.assign(tx,{begin:async(fn:any)=>{transactions++;return fn(tx);}}),api=requests(db,time.Date,time.timer,time.clear);
 await api.withSharedRequest('owner','viewer','playback',new Request('http://fixture.test'),async(_request:Request,headersReceived:()=>Promise<void>)=>{dispatches++;await headersReceived();return new Response('ok');});
 expect(dispatches).toBe(1);expect(time.now).toBeGreaterThanOrEqual(1000);expect(time.now).toBeLessThanOrEqual(1250);expect(transactions).toBeLessThan(10);expect(queries).toBeLessThan(30);
});
test('a crashed dispatch lease retains durable expiry while its drain uses bounded query work',async()=>{
 const time=virtualTime();let queries=0;
 const db=async(parts:TemplateStringsArray)=>{queries++;return parts.join('?').startsWith('select id')&&time.now<35000?[{id:'held'}]:[];};
 await requests(db,time.Date,time.timer,time.clear).waitSharedRequests('playback');
 expect(time.now).toBeGreaterThanOrEqual(35000);expect(time.now).toBeLessThanOrEqual(35250);expect(queries).toBeLessThan(300);
});
test('withdrawn dispatch waits abort without another database poll',async()=>{
 const abort=new AbortController();let queries=0,ready!:()=>void;const polling=new Promise<void>(resolve=>ready=resolve);
 const db=async()=>{queries++;ready();return [{id:'held'}];};const pending=requests(db).waitSharedRequests('playback',abort.signal);
 await polling;await Promise.resolve();abort.abort(new DOMException('closed','AbortError'));await expect(pending).rejects.toThrow('closed');const after=queries;await new Promise(resolve=>setTimeout(resolve,5));expect(queries).toBe(after);
});
const leaseSource=await Bun.file(new URL('../src/lib/sharing/leases.server.ts',import.meta.url)).text();
function encoding(db:any,wait:()=>Promise<void>,adapter:any){const body=leaseSource.slice(leaseSource.indexOf('export async function ensureSharedEncoding'),leaseSource.indexOf('type ReleasedSession'));return new Function('getSql','AppError','waitSharedRequests','waitSharedRetry','getJellyfin','encodingBitrate',compile(body)+'return ensureSharedEncoding;')(()=>db,Error,wait,requests(db).waitSharedRetry,async()=>({adapter}),encodingBitrate);}
const session={id:'session',connection_id:'connection',provider_device_id:'device',provider_session_id:'old',desired_bitrate:500000,max_bitrate:1000000};
test('cancelled quality waits release their preparation token without stopping the encoder',async()=>{
 const abort=new AbortController();let stopped=0,released=0,started!:()=>void,rejectWait!:(error:any)=>void;
 const waiting=new Promise<void>((_resolve,reject)=>rejectWait=reject),entered=new Promise<void>(resolve=>started=resolve);
 const db=async(parts:TemplateStringsArray)=>{const sql=parts.join('?');if(sql.startsWith('select v.'))return [session];if(sql.startsWith('update share_viewers set preparing_until=now()'))return [{preparation_token:'token'}];if(sql.startsWith('update share_viewers set preparing_until=null'))released++;return [];};
 const run=encoding(db,async()=>{started();await waiting;abort.signal.throwIfAborted();},{stopEncoding:async()=>{stopped++;}});
 const pending=run('owner','viewer',abort.signal);await entered;abort.abort(new DOMException('closed','AbortError'));rejectWait(abort.signal.reason);
 await expect(pending).rejects.toThrow('closed');expect(stopped).toBe(0);expect(released).toBe(1);
});
test('cancellation during destructive encoder stop still publishes a recoverable replacement generation',async()=>{
 const abort=new AbortController();let published=0,released=0;
 const db=async(parts:TemplateStringsArray)=>{const sql=parts.join('?');if(sql.startsWith('select v.'))return [session];if(sql.startsWith('update share_viewers set preparing_until=now()'))return [{preparation_token:'token'}];if(sql.startsWith('update playback_sessions p set provider_session_id=')){published++;return [{id:'session'}];}if(sql.startsWith('update share_viewers set preparing_until=null'))released++;return [];};
 const run=encoding(db,async()=>{}, {stopEncoding:async()=>{abort.abort(new DOMException('closed','AbortError'));}});
 await expect(run('owner','viewer',abort.signal)).rejects.toThrow('closed');expect(published).toBe(1);expect(released).toBe(1);
});
test('an already withdrawn shared delivery performs no reservation or quality preparation',async()=>{
 const source=await Bun.file(new URL('../src/lib/sharing/service.server.ts',import.meta.url)).text(),body=source.slice(source.indexOf('export async function streamForViewer'));
 const calls:string[]=[];const run=new Function('requestPriority','v','uuid','AppError','assertShare','reserveViewer','ensureSharedEncoding','withSharedRequest','streamPlayback',compile(body)+'return streamForViewer;')({run:(_priority:any,fn:any)=>fn()},{parse:(_schema:any,value:any)=>value},null,Error,async()=>calls.push('assert'),async()=>calls.push('reserve'),async()=>calls.push('encoding'),async()=>calls.push('dispatch'),()=>{});
 const abort=new AbortController();abort.abort(new DOMException('closed','AbortError'));
 await expect(run({playback_id:'session'},'session',new Request('http://fixture.test',{signal:abort.signal}))).rejects.toThrow('closed');expect(calls).toEqual([]);
});
