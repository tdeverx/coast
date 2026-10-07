import {expect,test} from 'bun:test';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';
import {providerApiError} from '../src/lib/server/security/provider-api-error';

test('upstream authentication and outages use safe integration failures rather than Coast auth statuses',()=>{
  for(const status of [401,403,503]){
    const error=new ProviderHttpError(status,null,{error:'secret upstream response'});
    const mapped=providerApiError(error);
    expect(mapped.status).toBe(502);expect(JSON.stringify(mapped)).not.toContain('secret');
    expect(error.status).toBe(status);expect(error.responseBody).toEqual({error:'secret upstream response'});
  }
});

test('rate-limit response bounds Retry-After without mutating internal provider retry metadata',()=>{
  for(const [delay,expected] of [[-5,'0'],[0,'0'],[1.2,'2'],[864000,'86400'],[null,'60'],[Infinity,'60']] as const){
    const error=new ProviderHttpError(429,delay),mapped=providerApiError(error);
    expect(mapped.status).toBe(429);expect(mapped.headers?.['Retry-After']).toBe(expected);
    expect(error.retryAfterSeconds).toBe(delay);
  }
});
