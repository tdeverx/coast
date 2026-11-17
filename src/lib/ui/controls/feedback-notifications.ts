export type FeedbackRecord={id:string;text:string;kind:'info'|'error';pending:boolean};
type Ports={
  viewer:()=>string|undefined;
  save:(viewerId:string,notices:FeedbackRecord[],signal:AbortSignal)=>Promise<unknown>;
  failure:(retry:()=>Promise<boolean>,full?:boolean)=>void;
  recovered:()=>void;
  changed:()=>unknown;
  online?:(retry:()=>void)=>(()=>void);
};

/** Tab-scoped inbox delivery survives toast removal, with one bounded write lane.
 * Owner replacement ends the old lane; no offline/reload durability is claimed. */
export function createFeedbackNotifications(ports:Ports){
 const pending=new Map<string,FeedbackRecord>();
 let viewer:string|undefined,epoch=0,flight:FeedbackRecord[]=[],request:AbortController|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 let refreshing=false,refreshAgain=false;
 let failed=false,scheduled=false,overflow=false;
 function reset(next?:string){epoch++;request?.abort();if(deadline)clearTimeout(deadline);deadline=undefined;request=undefined;pending.clear();flight=[];viewer=next;failed=false;scheduled=false;overflow=false;refreshing=false;refreshAgain=false;}
 function sync(){const current=ports.viewer();if(viewer!==current)reset(current);return current;}
 function schedule(){if(scheduled||failed||flight.length||!pending.size)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void flush();});}
 function refresh(){
  if(refreshing){refreshAgain=true;return;}
  const generation=epoch;refreshing=true;
  void Promise.resolve().then(()=>{if(generation===epoch)return ports.changed();}).catch(()=>{}).finally(()=>{
   if(generation!==epoch)return;refreshing=false;if(refreshAgain){refreshAgain=false;refresh();}
  });
 }
 async function flush():Promise<boolean>{
  const owner=sync();if(!owner||failed||flight.length||!pending.size)return false;
  const generation=epoch,batch=[...pending.values()].slice(0,20),controller=new AbortController();
  for(const record of batch)pending.delete(record.id);
  flight=batch;request=controller;
  const timeout=setTimeout(()=>controller.abort(new DOMException('Notification save timed out.','TimeoutError')),15000);
  deadline=timeout;
  try{
   await ports.save(owner,batch,controller.signal);
   if(generation!==epoch||ports.viewer()!==owner)return false;
   flight=[];overflow=false;ports.recovered();if(!pending.size)refresh();schedule();return true;
  }catch{
   if(generation!==epoch||ports.viewer()!==owner)return false;
   for(const record of batch)if(!pending.has(record.id))pending.set(record.id,record);
   flight=[];failed=true;ports.failure(retry);return false;
  }finally{clearTimeout(timeout);if(deadline===timeout)deadline=undefined;if(request===controller)request=undefined;}
 }
 async function retry(){if(!sync()||flight.length)return false;failed=false;return flush();}
 return {
  record(record:FeedbackRecord){
   if(!sync())return;
   if(!pending.has(record.id)&&!flight.some(value=>value.id===record.id)&&pending.size+flight.length>=200){if(!overflow){overflow=true;ports.failure(retry,true);}return;}
   pending.set(record.id,{...record,text:record.text.slice(0,2000)});schedule();
  },
  connect(){const owner=sync();const release=ports.online?.(()=>{void retry();});return()=>{release?.();if(viewer===owner)reset();};},
  retry,
  get pending(){return pending.size+flight.length;},
 };
}
