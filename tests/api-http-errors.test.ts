import {expect,test} from 'bun:test';
import {error,isHttpError,json} from '@sveltejs/kit';
import * as v from 'valibot';
import {AppError} from '../src/lib/server/security/errors';
import {DomainError} from '../src/lib/core/errors';
import {ProviderActionError} from '../src/lib/providers/contracts';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';
import {providerApiError} from '../src/lib/server/security/provider-api-error';
import {classifyFailure} from '../src/lib/server/diagnostics';

// Exercise the current catch owners with real installed error classes. Only the
// diagnostic write is inert; these authored cases do not exercise HTTP or data.
const dependencies={json,isHttpError,v,AppError,DomainError,ProviderActionError,ProviderHttpError,
  providerApiError,classifyFailure,logDiagnostic:async()=>{}};
const owners={central:'../src/lib/server/api/index.server.ts',
  insights:'../src/routes/api/v1/media/[id]/insights/+server.ts'} as const;
const catches=Object.fromEntries(await Promise.all(Object.entries(owners).map(async([owner,path])=>{
  const source=await Bun.file(new URL(path,import.meta.url)).text();
  const marker=owner==='central'?'  } catch (error) {':'  } catch(cause) {';
  const start=source.indexOf(marker),end=source.lastIndexOf('\n  }\n};');
  if(start<0||end<start||source.indexOf(marker,start+1)>=0)
    throw Error('Review the API catch owner before updating its error contract.');
  const body=source.slice(start+marker.length,end);
  return [owner,new Function(...Object.keys(dependencies),owner==='central'?'error':'cause',
    'request','path','source',`return (async()=>{${body}})();`) as (...args:unknown[])=>Promise<Response>];
}))) as Record<keyof typeof owners,(...args:unknown[])=>Promise<Response>>;
async function invoke(owner:keyof typeof owners,cause:unknown,aborted=false,path='library',source='tmdb'){
  const controller=new AbortController();if(aborted)controller.abort();
  const response=await catches[owner](...Object.values(dependencies),cause,{signal:controller.signal},[path],source);
  return {status:response.status,body:await response.text(),retryAfter:response.headers.get('retry-after')};
}
const known=(status:number)=>{try{error(status,'Known request failure.');}catch(cause){return cause;}};

test('API catch owners trust Kit errors while preserving redaction, provider mapping and cancellation',async()=>{
  for(const owner of ['central','insights'] as const)for(const status of [400,404,503]){
    const cause=known(status);expect(isHttpError(cause,status)).toBe(true);
    const result=await invoke(owner,cause);
    expect(result.status).toBe(status);
    expect(JSON.parse(result.body)).toEqual({error:'Known request failure.',code:'request_failed'});
  }
  const secret='private upstream detail';
  for(const owner of ['central','insights'] as const)
    for(const cause of [new Error(secret),new DOMException(secret,'OperationError'),{status:404,body:{message:secret}}]){
      const result=await invoke(owner,cause);
      expect(result.status).toBe(503);
      expect(JSON.parse(result.body)).toEqual(owner==='central'
        ?{code:'service_unavailable',error:'This action could not be completed. Please try again.'}
        :{error:'TMDB details are temporarily unavailable.'});
      expect(result.body).not.toContain(secret);
    }
  expect(JSON.parse((await invoke('central',new Error(secret),false,'playback')).body))
    .toEqual({code:'service_unavailable',error:'Playback could not start. Please try again.'});
  expect(JSON.parse((await invoke('insights',new Error(secret),false,'media','trakt')).body))
    .toEqual({error:'Trakt details are temporarily unavailable.'});
  for(const owner of ['central','insights'] as const){
    const result=await invoke(owner,new AppError(403,'Feature disabled.','feature_disabled'));
    expect(result.status).toBe(403);expect(JSON.parse(result.body)).toEqual({error:'Feature disabled.',code:'feature_disabled'});
  }
  const domain=await invoke('central',new DomainError('Missing work.',404,'not_found'));
  expect(domain.status).toBe(404);expect(JSON.parse(domain.body)).toEqual({error:'Missing work.',code:'not_found'});
  const invalid=v.safeParse(v.string(),42);if(invalid.success)throw Error('Expected invalid input.');
  const validation=await invoke('central',new v.ValiError(invalid.issues));
  expect(validation.status).toBe(400);expect(JSON.parse(validation.body)).toEqual({error:invalid.issues[0].message,code:'invalid_input'});
  const permission=await invoke('central',new ProviderActionError('Access denied.','permission'));
  expect(permission.status).toBe(403);expect(JSON.parse(permission.body)).toEqual({error:'Access denied.',code:'permission'});
  for(const status of [401,403,503]){
    const result=await invoke('central',new ProviderHttpError(status,null,{error:secret}));
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({code:status===503?'provider_unavailable':'provider_rejected',
      error:status===503?'The connected service could not complete this request. Try again later.'
        :'The connected service rejected this request. Check its credentials and permissions.'});
  }
  const limited=await invoke('central',new ProviderHttpError(429,60,{error:secret}));
  expect(limited.status).toBe(429);expect(limited.retryAfter).toBe('60');
  expect(JSON.parse(limited.body)).toEqual({code:'provider_rate_limited',error:'The connected service is limiting requests. Try again later.'});
  const abort=new DOMException('Player replaced','AbortError');
  expect(await invoke('central',abort,true)).toEqual({status:499,body:'',retryAfter:null});
  expect((await invoke('central',abort)).status).toBe(503);
  expect((await invoke('central',new Error(secret),true)).status).toBe(503);
  expect((await invoke('central',known(404),true)).status).toBe(404);
});
