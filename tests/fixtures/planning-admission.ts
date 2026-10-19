import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../..'),key=Symbol.for('coast.audit.planning-command-controls'),global=globalThis as any;
const {AppError}=await import(resolve(root,'src/lib/server/security/errors.ts'));
const assert=(v:unknown,label:string)=>{if(!v)throw Error(label);};
const report:any={status:'running',boundary:'Supplementary tableless command-protocol controls derived from current planning source. No database connection/rows/provider calls; not actual planning-enabled or admitted-party mutation acceptance.',cases:[]};
const owner='00000000-0000-4000-8000-000000000001',a='00000000-0000-4000-8000-00000000000a',b='00000000-0000-4000-8000-00000000000b',d='00000000-0000-4000-8000-00000000000c',work='00000000-0000-4000-8000-000000000005',plan='00000000-0000-4000-8000-000000000006';
const now=Date.UTC(2026,9,18,10),oldNow=Date.now;Date.now=()=>now;
const config={features:{planning:true,parties:true,screen:true,music:true,game:true,book:true,comic:true,social:true},experimentalParties:true,experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true};
function fixture(options:any={}){
 const state:any={allowed:new Set([a,b,d]),events:[],friendReads:{pre:0,tx:0},dml:[],transaction:false,firstInvalid:null,rolledBack:false};
 const deny=(id:string)=>{state.firstInvalid=id;throw new AppError(403,'This action is available between friends.');};
 const admitted=(id:string)=>{if(!state.allowed.has(id.toLowerCase()))deny(id);};
 const tx:any=async(strings:TemplateStringsArray,...values:any[])=>{
  const text=strings.join('');
  if(text.includes('from friendships')){state.friendReads.tx++;state.events.push('friend-tx');try{admitted(values[1]);return[{}];}catch(error){if((error as any).status===403)return[];throw error;}}
  if(text.includes('pg_advisory_xact_lock')){state.events.push('account-lock');return[];}
  if(text.includes('count(*)')){state.events.push('plan-cap');return[{total:options.full?100:0}];}
  if(text.includes('insert into media_plans')){state.events.push('plan-insert');state.dml.push({kind:'plan',userId:values[0],workId:values[1],startsAt:values[2],party:values[3],friends:JSON.parse(values[4])});return[{id:plan}];}
  if(text.includes('insert into outbox_actions')){state.events.push('outbox-insert');state.dml.push({kind:'outbox',userId:values[0],payload:values[1],at:values[2].toISOString()});return[];}
  throw Error('unexpected_control_transaction_query');
 };
 const db:any=async(strings:TemplateStringsArray,..._values:any[])=>{const text=strings.join('');if(text.includes('select category,kind from works')){state.events.push('work');return[{category:'screen',kind:'movie'}];}throw Error('unexpected_control_pool_query');};
 db.begin=async(fn:(tx:any)=>Promise<any>)=>{state.transaction=true;state.events.push('begin');if(options.withdraw)state.allowed.delete(a);try{const result=await fn(tx);state.events.push('commit');return result;}catch(error){state.rolledBack=true;state.events.push('rollback');state.dml=[];throw error;}};
 const requireFeature=async(_user:string,_feature:string,channel?:any)=>{if(channel){assert(channel===tx,'fresh_feature_uses_transaction');state.events.push('feature-tx');}else state.events.push('feature-pre');return options.partyWithdraw&&channel?{...config,features:{...config.features,parties:false}}:config;};
 const requireFriend=async(_user:string,id:string)=>{state.friendReads.pre++;state.events.push('friend-pre');admitted(id);};
 const requireFriends=async(_user:string,ids:string[],channel?:any)=>{if(!ids.length)return;const phase=channel?'tx':'pre';if(channel)assert(channel===tx,'fresh_friend_uses_transaction');state.friendReads[phase]++;state.events.push('friend-'+phase);for(const id of ids)admitted(id);};
 if(options.initialDenied)for(const id of options.initialDenied)state.allowed.delete(id);
 return{state,db,tx,requireFeature,requireFriend,requireFriends};
}
const module=async(source:string)=>{
 source=source.replace("import { requireFeature, getFeatureConfig } from '$lib/server/features';",`const requireFeature=(...args)=>globalThis[Symbol.for('coast.audit.planning-command-controls')].requireFeature(...args);const getFeatureConfig=()=>{throw Error('unrelated_reader');};`)
 .replace("import { getSql } from '$lib/server/db';",`const getSql=()=>globalThis[Symbol.for('coast.audit.planning-command-controls')].db;`)
 .replace(/import \{ requireFriend(?:, requireFriends)? \} from '\$lib\/social\/service.server';/,`const requireFriend=(...args)=>globalThis[Symbol.for('coast.audit.planning-command-controls')].requireFriend(...args);const requireFriends=(...args)=>globalThis[Symbol.for('coast.audit.planning-command-controls')].requireFriends(...args);`)
 .replace("import { workCards } from '$lib/collection/query.server';",`const workCards=()=>{throw Error('unrelated_hydration');};`)
 .replace("import { notify } from '$lib/server/notifications';",`const notify=()=>{throw Error('reminder_not_in_scope');};`);
 let code=new Bun.Transpiler({loader:'ts'}).transformSync(source);code=code.replace(/(^\s*import[^\n]*\bfrom\s+)(['"])([^'"\n]+)\2/gm,(_m:string,lead:string,_quote:string,spec:string)=>lead+JSON.stringify(spec.startsWith('$lib/')?resolve(root,'src/lib',spec.slice(5)):Bun.resolveSync(spec,root)));return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
};
try{
 const source=await Bun.file(resolve(root,'src/lib/experiments/planning.server.ts')).text(),candidate=await module(source);
 const cases=[
  {kind:'ordered-deduplicated-store',friends:[b,a,b]},
  {kind:'case-sensitive-string-set',friends:[a.toUpperCase(),a,b,a.toUpperCase()]},
  {kind:'empty-friends',friends:[]},
  {kind:'raw21-before-dedup',friends:Array(21).fill(a)},
  {kind:'first-invalid-input-order',friends:[a,d,b],options:{initialDenied:[b,d]}},
  {kind:'fresh-friend-withdrawal',friends:[a],options:{withdraw:true}},
  {kind:'fresh-party-withdrawal',friends:[a],options:{partyWithdraw:true}},
  {kind:'plan-cap-remains-before-insert',friends:[a],options:{full:true}},
 ];
 for(const scenario of cases){
  const f=fixture(scenario.options);global[key]=f;let outcome:any;
  try{outcome={ok:true,result:await candidate.createPlan(owner,{workId:work,startsAt:new Date(now+3600000).toISOString(),party:true,friends:scenario.friends})};}
  catch(error){const e=error as any;outcome={ok:false,error:{type:e.constructor?.name,status:e.status??null,code:e.code??null,message:e.message}};}
  const state=f.state,successful=['ordered-deduplicated-store','case-sensitive-string-set','empty-friends'].includes(scenario.kind);
  assert(outcome.ok===successful,'expected_creation_outcome');
  if(successful){
   const saved=state.dml.find((x:any)=>x.kind==='plan'),notice=state.dml.find((x:any)=>x.kind==='outbox');
   assert(JSON.stringify(saved?.friends)===JSON.stringify([...new Set(scenario.friends)]),'exact_string_set_order');
   assert(saved.userId===owner&&saved.workId===work&&saved.party&&saved.startsAt===new Date(now+3600000).toISOString(),'planned_fields_retained');
   assert(outcome.result.id===plan&&notice.userId===owner&&notice.payload.planId===plan&&notice.at===new Date(now+45*60000).toISOString(),'outbox_identity_and_due_time');
   assert(state.events.indexOf('feature-tx')<state.events.indexOf('account-lock')&&state.events.indexOf('account-lock')<state.events.indexOf('plan-insert'),'feature_account_write_order');
   assert(state.friendReads.pre===(scenario.friends.length?1:0)&&state.friendReads.tx===(scenario.friends.length?1:0),'separate_bounded_admissions');
  }else{
   assert(state.dml.length===0,'rejected_operation_has_no_committed_domain_fields');
   if(scenario.kind==='raw21-before-dedup')assert(outcome.error.type==='ValiError'&&!state.transaction&&state.friendReads.pre===0&&!state.events.includes('work'),'raw21_rejected_before_work');
   else if(scenario.kind==='plan-cap-remains-before-insert')assert(outcome.error.status===409&&state.rolledBack&&state.events.includes('account-lock')&&!state.events.includes('plan-insert'),'account_cap_before_insert');
   else if(scenario.kind==='fresh-party-withdrawal')assert(outcome.error.status===403&&outcome.error.code==='feature_disabled'&&state.rolledBack&&state.friendReads.tx===0,'party_withdrawal_precedes_admission_write');
   else{
    assert(outcome.error.status===403&&outcome.error.message==='This action is available between friends.'&&outcome.error.code==='request_failed','exact_friend_error');
    if(scenario.kind==='first-invalid-input-order')assert(state.firstInvalid===d&&!state.transaction,'first_invalid_identity');
    if(scenario.kind==='fresh-friend-withdrawal')assert(state.rolledBack&&state.friendReads.pre===1&&state.friendReads.tx===1&&!state.events.includes('account-lock'),'fresh_transaction_rejects_after_preflight');
   }
  }
  report.cases.push({kind:scenario.kind,allowed:outcome.ok,storedFriends:state.dml.find((x:any)=>x.kind==='plan')?.friends.length??null,modeledAdmissionQueries:state.friendReads});
 }
 report.modeledCounterBoundary='Friend query counters model command protocol through stubs, not PostgreSQL measurements; actual helper counts are a separate READ ONLY proof.';report.status='passed';report.databaseConnections=0;report.databaseWrites=0;report.providerCalls=0;
}catch(error){report.status='failed';report.failureCode=error instanceof Error?error.message:'unknown_control_error';process.exitCode=1;}
finally{Date.now=oldNow;delete global[key];if(report.status==='failed'){console.error(report.failureCode);process.exitCode=1;}else console.log(JSON.stringify({status:report.status,cases:report.cases,databaseConnections:0}));}
