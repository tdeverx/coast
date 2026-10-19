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
class ScopeControlError extends Error{}
const check=(value:unknown,label:string)=>{if(!value)throw new ScopeControlError(label);};

// Compile the current canonical first statement without executing the owner.
// Named I/O seams stop before SQL, hydration, config or provider work.
function currentAdmission(source:string){
 const start=source.indexOf('const uuid='),end=source.indexOf('/** Compact media-card heads only;');
 check(start>=0&&end>start,'activity_scope_owner_extraction_changed');
 const body=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end)).replaceAll('export ','');
 return async(owner:string,scope:Scope,ids?:string[]):Promise<Query>=>{
  const stop=Symbol('captured_activity_primary');let captured:SQL|undefined;
  const feed=new Function('sql','v','getDb','activityRelationships','relationshipEventFilter','workFriendFilters',body+';return activityFeed;')(
   sql,v,()=>({execute(query:SQL){check(!captured,'multiple_primary_statements');captured=query;throw stop;}}),activityRelationships,relationshipEventFilter,workFriendFilters);
  try{await feed(owner,scope,ids);throw Error('activity_primary_was_not_intercepted');}catch(error){if(error!==stop)throw error;}
  const full=dialect.sqlToQuery(captured!),marker='activity_policy_keys as materialized (';
  const at=full.sql.indexOf(marker);check(at>=0&&full.sql.indexOf(marker,at+marker.length)<0,'activity_primary_boundary_changed');
  const visible=full.sql.indexOf('visible_raw as (',at);check(visible>at,'activity_visible_boundary_changed');
  const selected=full.sql.slice(visible).match(/\bfrom\s+(admitted_activity|social_activity)\s+a\s+join\s+works\b/)?.[1];
  check(selected,'activity_event_source_changed');
  const prefix=full.sql.slice(0,at),head=prefix.trim()==='with recursive'?'':prefix.replace(/,\s*$/,'');
  check(selected!=='social_activity'||!head,'unscoped_prefix_extraction_changed');
  // Rebind only placeholders used by this exact prefix. Full primary parameters
  // for privacy/grouping/paging do not belong to an admission-only query.
  const params:unknown[]=[],positions=new Map<number,number>();
  const statement=`${head} select a.id from ${selected} a order by a.id`.replace(/\$(\d+)\b/g,(_match:string,n:string)=>{
   const old=Number(n)-1;check(old>=0&&old<full.params.length,'admission_placeholder_out_of_range');
   if(!positions.has(old)){params.push(full.params[old]);positions.set(old,params.length);}
   return '$'+positions.get(old);
  });
  return{sql:statement,params};
 };
}

// Independent original persisted OR semantics. Do not express this oracle as
// the optimized root/allowed-ID expansion, or it would mirror the new algorithm.
function originalAdmission(scope:Scope,ids?:string[]):Query{
 const idFilter=sql`and (${ids===undefined} or a.id in (${ids?.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`}))`;
 return dialect.sqlToQuery(sql`select a.id from social_activity a
  ${scope.workId?sql`left join episodes e on e.media_id=a.work_id left join seasons se on se.media_id=a.work_id`:sql``}
  where true ${idFilter}
  ${scope.workId?sql`and (a.work_id=${scope.workId}::uuid or e.show_id=${scope.workId}::uuid or e.season_id=${scope.workId}::uuid or se.show_id=${scope.workId}::uuid or exists(select 1 from media_relationships member where member.parent_id=${scope.workId}::uuid and member.child_id in(a.work_id,e.show_id,e.season_id,se.show_id) and member.kind='contains'))`:sql``}
  ${scope.artistId?sql`and exists(select 1 from music_credits credit where credit.work_id=a.work_id and credit.artist_id=${scope.artistId}::uuid)`:sql``}
  ${scope.readingGroupId?sql`and exists(select 1 from reading_group_members member where member.group_id=${scope.readingGroupId}::uuid and member.work_id=a.work_id)`:sql``}
  order by a.id`);
}

run('Activity scope admission matches the original OR over persisted event identities',async()=>{
 let pool:Bun.SQL|undefined,client:any,began=false;const previousFetch=globalThis.fetch;
 const result:{cases:{label:string;rows:number;equal:boolean}[];gaps:string[];rolledBack?:boolean;poolClosed?:boolean}={cases:[],gaps:[]};
 try{
  check(process.env.COAST_AUDIT_ACTIVITY_SCOPE_REGRESSION_LEASE==='1','explicit_actual_scope_regression_lease_required');
  const expected=process.env.COAST_AUDIT_EXPECTED_DATABASE;
  check(expected&&/^coast_audit_(?:fix_actual_[a-f0-9]{32}|final_ab_[a-f0-9]{32}_current)$/.test(expected),'designated_actual_database_required');
  check(process.env.DATABASE_URL,'database_environment_required');const target=new URL(process.env.DATABASE_URL!);
  check(target.hostname==='127.0.0.1'&&target.port==='55432'&&target.pathname==='/'+expected,'exact_designated_actual_clone_required');
  const denyTransport=()=>{throw Error('activity_scope_provider_transport_forbidden');};
  globalThis.fetch=Object.assign(async()=>denyTransport(),{preconnect:denyTransport});
  const source=await readFile(new URL('../src/lib/social/queries.server.ts',import.meta.url),'utf8'),capture=currentAdmission(source);
  pool=new Bun.SQL(target.href,{max:1,idleTimeout:0,connectionTimeout:10,connection:{jit:'off',statement_timeout:'10000',lock_timeout:'1000'}});client=await pool.reserve();
  await client`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;began=true;
  await client`SET LOCAL statement_timeout='10s'`;await client`SET LOCAL lock_timeout='1s'`;await client`SET LOCAL jit='off'`;await client`SET LOCAL work_mem='4MB'`;
  const [session]=await client`select pg_backend_pid() as pid,current_setting('transaction_read_only') as read_only,current_setting('transaction_isolation') as isolation,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout,current_setting('jit') as jit,current_setting('work_mem') as work_mem`;
  expect({read_only:session.read_only,isolation:session.isolation,statement_timeout:session.statement_timeout,lock_timeout:session.lock_timeout,jit:session.jit,work_mem:session.work_mem}).toEqual({read_only:'on',isolation:'repeatable read',statement_timeout:'10s',lock_timeout:'1s',jit:'off',work_mem:'4MB'});
  const [clients]=await client`select count(*)::int as count from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()`;expect(clients.count).toBe(0);
  const [owner]=await client`select id from users where not disabled and coast_feature_enabled(id,'screen') order by id limit 1`;check(owner,'existing_enabled_owner_required');
  const read=async(query:Query)=>Array.from(await client.unsafe(query.sql,query.params)).map((row:any)=>String(row.id));
  const compare=async(label:string,scope:Scope={},ids?:string[])=>{
   const actual=await read(await capture(owner.id,scope,ids)),oracle=await read(originalAdmission(scope,ids));
   // Compare booleans/counts, never pass private ID arrays to a failing printer.
   const equal=isDeepStrictEqual(actual,oracle);result.cases.push({label,rows:actual.length,equal});
   check(equal,'activity_admission_mismatch_'+label);expect(actual.length).toBe(oracle.length);expect(new Set(actual).size).toBe(actual.length);return actual;
  };
  const all=await compare('unscoped-undefined');check(all.length>0,'existing_activity_events_required');await compare('unscoped-empty',{},[]);
  const [direct]=await client`select work_id from social_activity group by work_id order by count(*) desc,work_id limit 1`;
  const directIds=await compare('direct-work',{workId:direct.work_id});check(directIds.length>0,'existing_direct_work_events_required');
  await compare('work-empty',{workId:direct.work_id},[]);await compare('work-one',{workId:direct.work_id},[directIds[0]]);await compare('work-duplicate-id',{workId:direct.work_id},[directIds[0],directIds[0]]);
  if(directIds.length>1)await compare('distinct-events-same-work',{workId:direct.work_id},directIds.slice(0,2));else result.gaps.push('multiple-events-on-selected-work');
  const directSet=new Set(directIds),outside=all.find(id=>!directSet.has(id));if(outside)await compare('outside-event-and-work',{workId:direct.work_id},[directIds[0],outside]);else result.gaps.push('outside-event');
  const [show]=await client`select e.show_id as id from social_activity a join episodes e on e.media_id=a.work_id group by e.show_id order by count(*) desc,e.show_id limit 1`;
  if(show)await compare('active-show',{workId:show.id});else result.gaps.push('active-show');
  const [season]=await client`select e.season_id as id from social_activity a join episodes e on e.media_id=a.work_id where e.season_id is not null group by e.season_id order by count(*) desc,e.season_id limit 1`;
  if(season)await compare('active-season',{workId:season.id});else result.gaps.push('active-season');
  const [collection]=await client`select r.parent_id as id from media_relationships r join media m on m.id=r.parent_id and m.kind='collection' join social_activity a on a.work_id=r.child_id where r.kind='contains' group by r.parent_id order by count(*) desc,r.parent_id limit 1`;
  if(collection)await compare('direct-member-collection',{workId:collection.id});else result.gaps.push('collection-with-retained-direct-member-events');
  const [artist]=await client`select credit.artist_id,a.work_id from social_activity a join music_credits credit on credit.work_id=a.work_id group by credit.artist_id,a.work_id order by count(*) desc,credit.artist_id,a.work_id limit 1`;
  if(artist){await compare('artist',{artistId:artist.artist_id});await compare('artist-and-work',{artistId:artist.artist_id,workId:artist.work_id});}else result.gaps.push('event-bearing-artist');
  const [group]=await client`select member.group_id,a.work_id from social_activity a join reading_group_members member on member.work_id=a.work_id group by member.group_id,a.work_id order by count(*) desc,member.group_id,a.work_id limit 1`;
  if(group){await compare('reading-group',{readingGroupId:group.group_id});await compare('reading-group-and-work',{readingGroupId:group.group_id,workId:group.work_id});}else result.gaps.push('event-bearing-reading-group');
  if(artist&&group){const combined=await compare('artist-and-reading-group',{artistId:artist.artist_id,readingGroupId:group.group_id});await compare('artist-and-reading-group-and-work',{artistId:artist.artist_id,readingGroupId:group.group_id,workId:artist.work_id});if(!combined.length)result.gaps.push('positive-artist-reading-group-overlap');}
  const [end]=await client`select pg_backend_pid() as pid,current_setting('transaction_read_only') as read_only,current_setting('transaction_isolation') as isolation,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`;
  expect(end.pid===session.pid).toBe(true);expect({read_only:end.read_only,isolation:end.isolation,statement_timeout:end.statement_timeout,lock_timeout:end.lock_timeout}).toEqual({read_only:'on',isolation:'repeatable read',statement_timeout:'10s',lock_timeout:'1s'});
  await client`ROLLBACK`;began=false;result.rolledBack=true;
 }catch(error){
  // Driver errors may include bound values. Preserve only an authored label or
  // native code here, with no raw message/stack/cause or ID-bearing assertions.
  const e=error as {message?:string;code?:string;errno?:string};
  const label=error instanceof ScopeControlError?error.message:'activity_scope_regression_failed';
  throw Error(label+(e?.errno&&/^[A-Z0-9_]+$/.test(e.errno)?'_'+e.errno:''));
 }finally{
  if(began)try{await client`ROLLBACK`;result.rolledBack=true;}catch{}
  globalThis.fetch=previousFetch;
  let cleanupFailed=false;
  try{client?.release();}catch{cleanupFailed=true;}
  try{await pool?.close();result.poolClosed=true;}catch{cleanupFailed=true;}
  console.log(JSON.stringify({activityScopeRegression:result}));
  if(cleanupFailed)throw Error('activity_scope_pool_close_failed');
 }
},120000);
