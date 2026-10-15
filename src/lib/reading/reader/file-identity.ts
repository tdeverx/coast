/** Hash outside the UI thread; only the digest, never file bytes, goes to Coast. */
export async function readingFileIdentity(file:File,signal?:AbortSignal):Promise<string>{
 signal?.throwIfAborted();
 const worker=new Worker(new URL('./hash.worker.ts',import.meta.url),{type:'module'});
 let cancelled:()=>void=()=>{};
 try{return await new Promise((resolve,reject)=>{cancelled=()=>reject(signal?.reason);signal?.addEventListener('abort',cancelled,{once:true});worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.digest);worker.onerror=()=>reject(new Error('This reading file could not be identified.'));worker.postMessage(file);});}
 finally{signal?.removeEventListener('abort',cancelled);worker.terminate();}
}
