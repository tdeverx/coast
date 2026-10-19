import {expect,test} from 'bun:test';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {sql,type SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import * as v from 'valibot';
import {activityRelationships,relationshipEventFilter} from '../src/lib/social/relationships.server';
import {workFriendFilters} from '../src/lib/social/model';

// Actual persisted rows only. The ordinary authored-fixture DB suite deliberately
// skips this test; execute this file alone under an approved actual-clone lease.
const run=process.env.COAST_DB_TEST==='1'&&process.env.COAST_AUDIT_REAL_DATA_CLONE==='1'?test:test.skip;
type Scope={workId?:string;artistId?:string;readingGroupId?:string};
type Query={sql:string;params:unknown[]};
const dialect=new PgDialect();
class PolicyControlError extends Error{}
const check=(value:unknown,label:string)=>{if(!value)throw new PolicyControlError(label);};

// Compile the current canonical first statement without executing the owner.
// Named I/O seams stop before SQL, hydration, config or provider work.
function currentPolicy(source:string){
 const start=source.indexOf('const uuid='),end=source.indexOf('/** Compact media-card heads only;');
 check(start>=0&&end>start,'activity_policy_owner_extraction_changed');
 const body=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end)).replaceAll('export ','');
 return async(owner:string,scope:Scope,ids?:string[]):Promise<Query>=>{
  const stop=Symbol('captured_activity_primary');let captured:SQL|undefined;
  const feed=new Function('sql','v','getDb','activityRelationships','relationshipEventFilter','workFriendFilters',body+';return activityFeed;')(
   sql,v,()=>({execute(query:SQL){check(!captured,'multiple_primary_statements');captured=query;throw stop;}}),activityRelationships,relationshipEventFilter,workFriendFilters);
  try{await feed(owner,scope,ids);throw Error('activity_primary_was_not_intercepted');}catch(error){if(error!==stop)throw error;}
  const full=dialect.sqlToQuery(captured!),marker='visible_raw as (';
  const at=full.sql.indexOf(marker);check(at>=0&&full.sql.indexOf(marker,at+marker.length)<0,'activity_primary_boundary_changed');
  const selected=full.sql.slice(at).match(/\bfrom\s+(admitted_activity|social_activity)\s+a\s+join\s+works\b/)?.[1];
  check(selected,'activity_event_source_changed');
  const prefix=full.sql.slice(0,at),head=prefix.trim()==='with recursive'?'':prefix.replace(/,\s*$/,'');

  // Rebind only placeholders used by this exact prefix. Full primary parameters
  // for privacy/grouping/paging do not belong to an admission-only query.
  const params:unknown[]=[],positions=new Map<number,number>();
  const statement=`${head} select a.id from ${selected} a join works w on w.id=a.work_id join activity_policy policy on policy.user_id=a.user_id and policy.section is not distinct from a.section and policy.category is not distinct from w.category order by a.id`.replace(/\$(\d+)\b/g,(_match:string,n:string)=>{
   const old=Number(n)-1;check(old>=0&&old<full.params.length,'admission_placeholder_out_of_range');
   if(!positions.has(old)){params.push(full.params[old]);positions.set(old,params.length);}
   return '$'+positions.get(old);
  });
  return{sql:statement,params};
 };
}

// Independent original per-event visibility predicate and original scope OR.
// No deduplicated keys or activity_policy reference belongs in this oracle.
function originalPolicy(owner:string,scope:Scope,ids?:string[]):Query{
 const idFilter=sql`and (${ids===undefined} or a.id in (${ids?.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`}))`;
 return dialect.sqlToQuery(sql`select a.id from social_activity a join works w on w.id=a.work_id
  ${scope.workId?sql`left join episodes e on e.media_id=a.work_id left join seasons se on se.media_id=a.work_id`:sql``}
  where coast_category_enabled(${owner}::uuid,w.category)
   and (a.user_id=${owner}::uuid or coast_feature_enabled(a.user_id,'social') and coast_feature_enabled(${owner}::uuid,'social'))
   and (a.user_id=${owner}::uuid or exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${owner}::uuid,a.user_id) and f.user_b=greatest(${owner}::uuid,a.user_id)))
   and social_visible(a.user_id,${owner}::uuid,a.section,w.category) ${idFilter}
  ${scope.workId?sql`and (a.work_id=${scope.workId}::uuid or e.show_id=${scope.workId}::uuid or e.season_id=${scope.workId}::uuid or se.show_id=${scope.workId}::uuid or exists(select 1 from media_relationships member where member.parent_id=${scope.workId}::uuid and member.child_id in(a.work_id,e.show_id,e.season_id,se.show_id) and member.kind='contains'))`:sql``}
  ${scope.artistId?sql`and exists(select 1 from music_credits credit where credit.work_id=a.work_id and credit.artist_id=${scope.artistId}::uuid)`:sql``}
  ${scope.readingGroupId?sql`and exists(select 1 from reading_group_members member where member.group_id=${scope.readingGroupId}::uuid and member.work_id=a.work_id)`:sql``}
  order by a.id`);
}

run('Activity statement policy membership matches original per-event authority over real events',async()=>{
 let pool:Bun.SQL|undefined,client:any,began=false;const previousFetch=globalThis.fetch;
 const result:{cases:{label:string;rows:number;equal:boolean}[];gaps:string[];rolledBack?:boolean;poolClosed?:boolean}={cases:[],gaps:[]};
 try{
  check(process.env.COAST_AUDIT_ACTIVITY_POLICY_REGRESSION_LEASE==='1','explicit_actual_scope_regression_lease_required');
  const expected=process.env.COAST_AUDIT_EXPECTED_DATABASE;
  check(expected&&/^coast_audit_(?:fix_actual_[a-f0-9]{32}|final_ab_[a-f0-9]{32}_current)$/.test(expected),'designated_actual_database_required');
  check(process.env.DATABASE_URL,'database_environment_required');const target=new URL(process.env.DATABASE_URL!);
  check(target.hostname==='127.0.0.1'&&target.port==='55432'&&target.pathname==='/'+expected,'exact_designated_actual_clone_required');
  const denyTransport=()=>{throw Error('activity_policy_provider_transport_forbidden');};
  globalThis.fetch=Object.assign(async()=>denyTransport(),{preconnect:denyTransport});
  const source=await readFile(new URL('../src/lib/social/queries.server.ts',import.meta.url),'utf8'),capture=currentPolicy(source);
  pool=new Bun.SQL(target.href,{max:1,idleTimeout:0,connectionTimeout:10,connection:{jit:'off',statement_timeout:'30000',lock_timeout:'1000'}});client=await pool.reserve();
  await client`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;began=true;
  await client`SET LOCAL statement_timeout='30s'`;await client`SET LOCAL lock_timeout='1s'`;await client`SET LOCAL jit='off'`;await client`SET LOCAL work_mem='4MB'`;
  const [session]=await client`select pg_backend_pid() as pid,current_setting('transaction_read_only') as read_only,current_setting('transaction_isolation') as isolation,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout,current_setting('jit') as jit,current_setting('work_mem') as work_mem`;
  expect({read_only:session.read_only,isolation:session.isolation,statement_timeout:session.statement_timeout,lock_timeout:session.lock_timeout,jit:session.jit,work_mem:session.work_mem}).toEqual({read_only:'on',isolation:'repeatable read',statement_timeout:'30s',lock_timeout:'1s',jit:'off',work_mem:'4MB'});
  const [clients]=await client`select count(*)::int as count from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()`;expect(clients.count).toBe(0);
  const stability=await client`select p.proname as name,p.provolatile as volatility from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('coast_category_enabled','coast_feature_enabled','social_visible') order by p.proname`;
  expect(Array.from(stability,(row:any)=>[row.name,row.volatility])).toEqual([['coast_category_enabled','s'],['coast_feature_enabled','s'],['social_visible','s']]);
  const [owner]=await client`select id from users where not disabled and role='admin' and coast_feature_enabled(id,'screen') order by id limit 1`;check(owner,'existing_enabled_owner_required');
  const read=async(query:Query)=>Array.from(await client.unsafe(query.sql,query.params)).map((row:any)=>String(row.id));
  const compare=async(label:string,scope:Scope={},ids?:string[])=>{
   const actual=await read(await capture(owner.id,scope,ids)),oracle=await read(originalPolicy(owner.id,scope,ids));
   // Compare booleans/counts, never pass private ID arrays to a failing printer.
   const equal=isDeepStrictEqual(actual,oracle);result.cases.push({label,rows:actual.length,equal});
   check(equal,'activity_admission_mismatch_'+label);expect(actual.length).toBe(oracle.length);expect(new Set(actual).size).toBe(actual.length);return actual;
  };
  const all=await compare('all-current-policy');check(all.length>0,'existing_visible_activity_required');
  const [direct]=await client`select a.work_id from social_activity a join works w on w.id=a.work_id where coast_category_enabled(${owner.id}::uuid,w.category) and social_visible(a.user_id,${owner.id}::uuid,a.section,w.category) group by a.work_id order by count(*) desc,a.work_id limit 1`;
  check(direct,'existing_event_work_required');await compare('actual-work-policy',{workId:direct.work_id});
  await compare('explicit-real-ids-policy',{},all.slice(0,2));
  const [end]=await client`select pg_backend_pid() as pid,current_setting('transaction_read_only') as read_only,current_setting('transaction_isolation') as isolation,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`;
  expect(end.pid===session.pid).toBe(true);expect({read_only:end.read_only,isolation:end.isolation,statement_timeout:end.statement_timeout,lock_timeout:end.lock_timeout}).toEqual({read_only:'on',isolation:'repeatable read',statement_timeout:'30s',lock_timeout:'1s'});
  await client`ROLLBACK`;began=false;result.rolledBack=true;
 }catch(error){
  // Driver errors may include bound values. Preserve only an authored label or
  // native code here, with no raw message/stack/cause or ID-bearing assertions.
  const e=error as {message?:string;code?:string;errno?:string};
  const label=error instanceof PolicyControlError?error.message:'activity_policy_regression_failed';
  throw Error(label+(e?.errno&&/^[A-Z0-9_]+$/.test(e.errno)?'_'+e.errno:''));
 }finally{
  if(began)try{await client`ROLLBACK`;result.rolledBack=true;}catch{}
  globalThis.fetch=previousFetch;
  let cleanupFailed=false;
  try{client?.release();}catch{cleanupFailed=true;}
  try{await pool?.close();result.poolClosed=true;}catch{cleanupFailed=true;}
  console.log(JSON.stringify({activityPolicyRegression:result}));
  if(cleanupFailed)throw Error('activity_policy_pool_close_failed');
 }
},120000);
