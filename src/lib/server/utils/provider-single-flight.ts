import {providerResource,registerResourcePriority,promoteResourcePriority,releaseResourcePriority} from '../security/request-priority';

/** Share exact resource reads, promoting their queued requests when a more urgent caller joins. */
export function providerSingleFlight<T>(namespace:string) {
  const pending=new Map<string,Promise<T>>();
  return (key:string,work:()=>Promise<T>):Promise<T>=>{
    const resource=`${namespace}:${key}`;
    const existing=pending.get(key);
    if(existing){promoteResourcePriority(resource);return existing;}
    registerResourcePriority(resource);
    const result=Promise.resolve().then(()=>providerResource.run(resource,work)).finally(()=>{
      pending.delete(key);releaseResourcePriority(resource);
    });
    pending.set(key,result);
    return result;
  };
}
