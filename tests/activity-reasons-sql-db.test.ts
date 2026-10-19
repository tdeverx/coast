import {expect,test} from 'bun:test';
import {isDeepStrictEqual} from 'node:util';
import {PgDialect} from 'drizzle-orm/pg-core';
import {activityRelationships} from '../src/lib/social/relationships.server';

// Compile-only CTE contracts using identities from the approved actual clone.
// No activity feed, hydration, provider call or compiled statement is executed.
const run=process.env.COAST_DB_TEST==='1'&&process.env.COAST_AUDIT_REAL_DATA_CLONE==='1'?test:test.skip;
type Scope=Parameters<typeof activityRelationships>[1];
class ReasonsControlError extends Error{}
const check=(value:unknown,label:string)=>{if(!value)throw new ReasonsControlError(label);};
const dialect=new PgDialect(),marker='reasons as materialized (';

run('Activity reasons preserves baseline SQL for filters and friends and fences the unfiltered view',async()=>{
 let pool:Bun.SQL|undefined,client:any,began=false;const previousFetch=globalThis.fetch;
 const result:{roots:string[];activeCases:number;helperAbsentCases:number;materializedCases:number;gaps:string[];rolledBack?:boolean;poolClosed?:boolean}={roots:[],activeCases:0,helperAbsentCases:0,materializedCases:0,gaps:[]};
 try{
  check(process.env.COAST_AUDIT_ACTIVITY_REASONS_REGRESSION_LEASE==='1','explicit_actual_reasons_regression_lease_required');
  const expected=process.env.COAST_AUDIT_EXPECTED_DATABASE;
  check(expected&&/^coast_audit_fix_actual_[a-f0-9]{32}$/.test(expected),'designated_actual_database_required');
  const target=new URL(process.env.DATABASE_URL??'http://invalid');
  check(target.hostname==='127.0.0.1'&&target.port==='55432'&&target.pathname==='/'+expected,'exact_designated_actual_clone_required');
  const deny=()=>{throw Error('reasons_regression_transport_forbidden');};globalThis.fetch=Object.assign(async()=>deny(),{preconnect:deny});
  pool=new Bun.SQL(target.href,{max:1,idleTimeout:0,connectionTimeout:5,connection:{default_transaction_read_only:'on',jit:'off',statement_timeout:'5000',lock_timeout:'1000'}});client=await pool.reserve();
  await client`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;began=true;await client`SET LOCAL statement_timeout='5s'`;await client`SET LOCAL lock_timeout='1s'`;await client`SET LOCAL jit='off'`;await client`SET LOCAL work_mem='4MB'`;
  const settings=async()=>{const[s]=await client`SELECT pg_backend_pid() AS pid,current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout,current_setting('jit') AS jit,current_setting('work_mem') AS work_mem`;check(s.read_only==='on'&&s.isolation==='repeatable read'&&s.statement_timeout==='5s'&&s.lock_timeout==='1s'&&s.jit==='off'&&s.work_mem==='4MB','verified_readonly_reasons_session');return s;};
  const first=await settings();const[clients]=await client`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()`;check(clients.count===0,'exclusive_actual_reasons_lease_required');
  const owners=Array.from(await client`SELECT id FROM users WHERE NOT disabled ORDER BY id LIMIT 2`)as{id:string}[];check(owners.length===2,'two_existing_users_required');
  const[work]=await client`SELECT work_id AS id FROM social_activity GROUP BY work_id ORDER BY count(*) DESC,work_id LIMIT 1`;check(work,'existing_activity_work_required');
  const[artist]=await client`SELECT credit.artist_id AS id FROM music_credits credit WHERE EXISTS(SELECT 1 FROM social_activity a WHERE a.work_id=credit.work_id) ORDER BY credit.artist_id LIMIT 1`;
  const[group]=await client`SELECT member.group_id AS id FROM reading_group_members member WHERE EXISTS(SELECT 1 FROM social_activity a WHERE a.work_id=member.work_id) ORDER BY member.group_id LIMIT 1`;
  const viewer=owners[0].id,friend=owners[1].id,roots:{label:string;scope:Scope}[]=[{label:'work',scope:{workId:work.id}}];
  if(artist)roots.push({label:'artist',scope:{artistId:artist.id}});else result.gaps.push('event-bearing-artist');
  if(group)roots.push({label:'reading-group',scope:{readingGroupId:group.id}});else result.gaps.push('event-bearing-reading-group');
  if(artist&&group)roots.push({label:'mixed-roots',scope:{workId:work.id,artistId:artist.id,readingGroupId:group.id}});
  // Independent reference SHAPE: a consumed request must retain unfenced SQL.
  // All active scopes use the same parameterized CTE shape. No old runtime
  // snapshot or copied CTE body is retained as an oracle.
  const reference=dialect.sqlToQuery(activityRelationships(viewer,{workId:work.id,relationship:'consumed'}));
  check(!reference.sql.includes(marker),'filtered_reference_must_not_materialize');
  const cases:{label:string;relationship:Scope['relationship'];friendId?:string;fences:number}[]=[
   {label:'all',relationship:'all',fences:1},{label:'all-friend',relationship:'all',friendId:friend,fences:0},
   ...['consumed','progress','watchlist','lists','favourites'].flatMap(relationship=>[
    {label:relationship,relationship,fences:0},{label:relationship+'-friend',relationship,friendId:friend,fences:0},
   ]),
  ];
  for(const root of roots){result.roots.push(root.label);
   for(const row of cases){const scope={...root.scope,category:'all',relationship:row.relationship,friendId:row.friendId},actual=dialect.sqlToQuery(activityRelationships(viewer,scope));
    const fences=actual.sql.split(marker).length-1,normalized=actual.sql.replace(marker,'reasons as (');
    expect(fences).toBe(row.fences);check(normalized===reference.sql,'reasons_cte_shape_changed');
    // Original caller binding contract, independent of the optional fence.
    // Only these existing scalar scope values belong in the seventeen slots.
    const expectedParams=[scope.workId??null,scope.artistId??null,scope.readingGroupId??null,viewer,viewer,viewer,viewer,viewer,'all','all','all',scope.friendId??null,scope.friendId??null,viewer,scope.relationship,scope.relationship,scope.workId??null];
    check(isDeepStrictEqual(actual.params,expectedParams),'reasons_parameter_contract_changed');expect(actual.params.length).toBe(17);
    result.activeCases++;result.materializedCases+=fences;
   }
   for(const friendId of[undefined,friend]){const empty=dialect.sqlToQuery(activityRelationships(viewer,{...root.scope,friendId}));check(empty.sql===''&&empty.params.length===0,'absent_relationship_helper_changed');result.helperAbsentCases++;}
  }
  for(const scope of[{}, {friendId:friend}]){const empty=dialect.sqlToQuery(activityRelationships(viewer,scope));check(empty.sql===''&&empty.params.length===0,'unscoped_relationship_helper_changed');result.helperAbsentCases++;}
  expect(result.activeCases).toBe(roots.length*12);expect(result.materializedCases).toBe(roots.length);expect(result.helperAbsentCases).toBe(roots.length*2+2);
  const last=await settings();check(last.pid===first.pid,'same_reasons_backend_required');await client`ROLLBACK`;began=false;result.rolledBack=true;
 }catch(error){const e=error as{errno?:string};throw Error((error instanceof ReasonsControlError?error.message:'activity_reasons_regression_failed')+(e?.errno&&/^[A-Z0-9_]+$/.test(e.errno)?'_'+e.errno:''));}
 finally{
  globalThis.fetch=previousFetch;let cleanupFailed=false;
  if(began)try{await client`ROLLBACK`;result.rolledBack=true;}catch{cleanupFailed=true;}
  try{client?.release();}catch{cleanupFailed=true;}
  try{await pool?.close();result.poolClosed=true;}catch{cleanupFailed=true;}
  console.log(JSON.stringify({activityReasonsSqlRegression:result}));if(cleanupFailed)throw Error('activity_reasons_cleanup_failed');
 }
},30000);
