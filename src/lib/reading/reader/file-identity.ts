/** Hash outside the UI thread; only the digest, never file bytes, goes to Coast. */
export async function readingFileIdentity(file:File):Promise<string>{
 const worker=new Worker(new URL('./hash.worker.ts',import.meta.url),{type:'module'});
 try{return await new Promise((resolve,reject)=>{worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.digest);worker.onerror=()=>reject(new Error('This reading file could not be identified.'));worker.postMessage(file);});}
 finally{worker.terminate();}
}
