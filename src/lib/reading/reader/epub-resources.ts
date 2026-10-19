type Archive={createUrl(url:string,options?:{base64:boolean}):Promise<string>};
type Resources={createCssFile(href:string):Promise<string|undefined>};
type ResourceBook={archive:Archive;resources:Resources;replacements():Promise<unknown>};

/** EPUB.js owns archive and rewritten CSS allocations but does not revoke both correctly. */
export function ownEpubResources(value:unknown){
 const book=value as ResourceBook,urls=new Set<string>(),wrapped=new WeakSet<object>();
 let closed=false;
 const cancelled=()=>new DOMException('This reader is closed.','AbortError');
 function retain<T extends string|undefined>(url:T):T{
  if(url?.startsWith('blob:')){
   if(closed){URL.revokeObjectURL(url);throw cancelled();}
   urls.add(url);
  }
  return url;
 }
 const replacements=book.replacements.bind(book);
 book.replacements=()=>{
  if(closed)return Promise.reject(cancelled());
  // This per-book boundary runs after Resources exists, before its first asset/CSS request.
  const archive=book.archive,resources=book.resources;
  if(!wrapped.has(archive)){
   wrapped.add(archive);const create=archive.createUrl.bind(archive);
   archive.createUrl=async(...args)=>{if(closed)throw cancelled();return retain(await create(...args));};
  }
  if(!wrapped.has(resources)){
   wrapped.add(resources);const create=resources.createCssFile.bind(resources);
   resources.createCssFile=async(...args)=>{if(closed)throw cancelled();return retain(await create(...args));};
  }
  return replacements();
 };
 return {destroy(){if(closed)return;closed=true;for(const url of urls)URL.revokeObjectURL(url);urls.clear();}};
}
