/** Coordinator-only probe. Production read functions on an actual-data clone. */
import {getDb,getSql,closeDb} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/db';
import {withRequestConfig} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/config';
import {getFeatureConfig} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/features';
import {workCards,collectionData} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/collection/query.server';
import {progressData} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/queries/progress';
import {listsData} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/queries/lists';
import {detailsData} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/queries/media';
import {dynamicFeed} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/recommendations/feed.server';
import {BunSQLPreparedQuery} from '/Users/admin/Documents/ChatGPT/coast-new/node_modules/drizzle-orm/bun-sql/session.js';
import {createHash} from 'node:crypto';
import {notificationInbox} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/notifications/inbox';
const destination=process.argv[2];
if(!destination)throw Error('Provide aggregate-only output path');
if(process.env.COAST_AUDIT_REAL_DATA_CLONE!=='1')throw Error('Coordinator must explicitly assert actual-data disposable clone');
const dbname=new URL(process.env.DATABASE_URL!).pathname.slice(1);
if(!/audit|clone/.test(dbname))throw Error('Refusing a database whose name lacks audit/clone');
const db=getSql();
const result:any={instrumentationVersion:2,boundary:'actual-data clone; local read functions only; no providers; aggregate-only output; ORM count excludes raw Bun SQL',samples:[],gaps:[]};
const [owner]=await db`select id,username,email,role,settings from users where not disabled order by (select count(*) from tracking_state t where t.user_id=users.id) desc,id limit 1`;
if(!owner)throw Error('No actual user');
const config=await getFeatureConfig(owner.id);
const session=(getDb() as any).session;
const originalExecute=BunSQLPreparedQuery.prototype.execute;let currentQueries:any[]|null=null;
BunSQLPreparedQuery.prototype.execute=async function(...args:any[]){const active=currentQueries,started=performance.now();const rows=await originalExecute.apply(this,args);if(active)active.push({queryString:this.queryString,params:this.params,elapsedMs:performance.now()-started,rows:Array.isArray(rows)?rows.length:null});return rows;};
const planCandidates:any[]=[];
async function read(name:string,work:()=>Promise<any>,shape:(value:any)=>any){
 try{
  await withRequestConfig(work); // untimed warm-up
  for(let repeat=0;repeat<3;repeat++){
   const queries:string[]=[];const previous=session.logger,previousOptions=session.options.logger;const logger={logQuery:(query:string)=>queries.push(query)};session.logger=logger;session.options.logger=logger;const timings:any[]=[];currentQueries=timings;
   const before=process.memoryUsage(),cpu=process.cpuUsage(),started=performance.now();
   let value:any;try{value=await withRequestConfig(work);}finally{session.logger=previous;session.options.logger=previousOptions;currentQueries=null;}
   const elapsedMs=performance.now()-started,deltaCpu=process.cpuUsage(cpu),after=process.memoryUsage();
   if(repeat===1)for(const query of [...timings].sort((a,b)=>b.elapsedMs-a.elapsedMs).slice(0,2))planCandidates.push({...query,name});
   result.samples.push({name,repeat,elapsedMs,cpuUserMicros:deltaCpu.user,cpuSystemMicros:deltaCpu.system,heapDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss,ormStatements:queries.length,ormReadStatements:queries.filter(q=>/^\s*(select|with)\b/i.test(q)).length,ormDriverRows:timings.reduce((sum:number,q:any)=>sum+(q.rows??0),0),slowestOrmMs:Math.max(0,...timings.map((q:any)=>q.elapsedMs)),responseJsonBytes:Buffer.byteLength(JSON.stringify(value)),...shape(value)});
  }
 }catch(error:any){result.gaps.push({name,errorCode:typeof error?.code==='string'?error.code:'unclassified',errorType:error?.constructor?.name??'unknown'});}
}
try{
 const inventory=await db`select (select count(*)::int from works) as works,(select count(*)::int from tracking_state where user_id=${owner.id}) as owner_tracking,(select count(*)::int from lists where user_id=${owner.id}) as owner_lists,(select count(*)::int from social_recommendations where recipient_id=${owner.id} and state='pending') as owner_pending_recommendations,(select max(n)::int from(select count(*) n from list_items i join lists l on l.id=i.list_id where l.user_id=${owner.id} group by i.list_id) s) as largest_owner_list,(select count(*)::int from notifications where user_id=${owner.id}) as owner_notifications`;
 result.dataset=inventory[0];
 const cards=await db`select media_id as id from tracking_state t join works w on w.id=t.media_id where t.user_id=${owner.id} and w.category='screen' order by t.updated_at desc,t.media_id limit 60`;
 if(cards.length)await read('workCards:actual-screen-page',()=>workCards(owner.id,owner.id,cards.map((r:any)=>r.id)),v=>({cards:v.length}));
 await read('collection:personal:first',()=>collectionData(owner.id,{category:'screen'}),v=>({cards:v.items.length,total:v.total}));
 await read('continue:screen:first',()=>progressData(owner.id,{category:'screen',view:'watching'}),v=>({cards:v.items.length,total:v.total}));
 await read('recommendations:screen:all:first',()=>progressData(owner.id,{category:'screen',view:'recommendations',scope:'all'}),v=>({cards:v.items.length,total:v.total}));
 await read('recommendations:screen:available:first',()=>progressData(owner.id,{category:'screen',view:'recommendations',scope:'available'}),v=>({cards:v.items.length,total:v.total}));
 await read('lists:watchlist:first',()=>listsData(owner.id,{view:'watchlist'}),v=>({cards:v.items.length,total:v.total,lists:v.lists?.length??null}));
 if(config.features.personalisation)await read('feed:definition-census',()=>dynamicFeed(owner.id,new URL('http://coast.invalid/api/v1/experiments/feed')),v=>({rows:v.rows.length}));
 await read('notifications:inbox:first',()=>notificationInbox(owner),v=>({items:v.items.length,unread:v.unread}));
 const [season]=await db`select season_id as id,count(*)::int as n from episodes where season_id is not null group by season_id order by count(*) desc,season_id limit 1`;
 if(season)await read('details:actual-largest-season',()=>detailsData(owner.id,season.id),v=>({episodes:v.episodes.length,seasons:v.seasons.length,related:v.related.length,parentCollections:v.collections.length,collectionCards:v.collections.reduce((n:number,c:any)=>n+c.items.length,0),sourceEpisodes:season.n}));
 const [collection]=await db`select r.parent_id as id,count(*)::int as n from media_relationships r join media m on m.id=r.parent_id where m.kind='collection' group by r.parent_id order by count(*) desc,r.parent_id limit 1`;
 if(collection)await read('details:actual-largest-collection',()=>detailsData(owner.id,collection.id),v=>({members:v.members.length,seasons:v.seasons.length,related:v.related.length,parentCollections:v.collections.length,collectionCards:v.collections.reduce((n:number,c:any)=>n+c.items.length,0),sourceDirectMembers:collection.n}));
 if(process.env.COAST_AUDIT_EXPLAIN==='1'){
  result.plans=[];const selected=planCandidates.filter(q=>q.name==='collection:personal:first'||q.name==='notifications:inbox:first'||q.name==='continue:screen:first');
  const safeStrings=new Set(['Node Type','Parent Relationship','Relation Name','Schema','Alias','Index Name','CTE Name','Subplan Name','Join Type','Strategy','Operation','Scan Direction','Sort Method','Sort Space Type','Partial Mode','Conflict Resolution','Trigger Name']);
  const safePlan=(value:any):any=>Array.isArray(value)?value.filter(v=>v&&typeof v==='object').map(safePlan):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key,v])=>typeof v!=='string'||safeStrings.has(key)).map(([key,v])=>[key,safePlan(v)])):value;
  for(const query of selected){try{const plan=await db.begin(async tx=>{await tx`set local statement_timeout='30s'`;await tx`set local jit=off`;await tx`set local recursive_worktable_factor=0.01`;return tx.unsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query.queryString,query.params);});result.plans.push({name:query.name,querySha256:createHash('sha256').update(query.queryString).digest('hex'),ormElapsedMs:query.elapsedMs,driverRows:query.rows,plan:safePlan(plan)});}catch(error:any){result.plans.push({name:query.name,errorCode:error?.errno??error?.code??'unclassified'});}}
 }
 await Bun.write(destination,JSON.stringify(result,null,2));
 console.log(JSON.stringify({output:destination,samples:result.samples.length,gaps:result.gaps.length}));
}finally{BunSQLPreparedQuery.prototype.execute=originalExecute;await closeDb();}
