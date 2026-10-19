/** Uses actual catalogue/user rows; all domain mutations rollback. No providers/exports. */
import {getDb,getSql,closeDb} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/db';
import {bulkTrackInTransaction} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/core/tracking/service.server';
import {withRequestConfig} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/config';
import {sql as query} from '/Users/admin/Documents/ChatGPT/coast-new/node_modules/drizzle-orm/index.js';
import {sequenceEntries} from '/Users/admin/Documents/ChatGPT/coast-new/src/lib/core/lists/sequence.server';
if(process.env.COAST_AUDIT_REAL_DATA_CLONE!=='1')throw Error('Requires actual-data clone');
const name=new URL(process.env.DATABASE_URL!).pathname.slice(1);if(!/audit|clone/.test(name))throw Error('Clone name required');
const sql=getSql(),db=getDb(),session=(db as any).session,output:any={instrumentationVersion:2,boundary:'actual persisted user and collection; core bulk operation inside rolled-back transaction; no exports/providers',samples:[]};
const [owner]=await sql`select id from users where not disabled and coast_feature_enabled(id,'screen') order by (select count(*) from tracking_state t where t.user_id=users.id) desc,id limit 1`;
const available=await sql`select distinct on(members) id,members from (select m.id,count(*)::int as members from media m join media_relationships r on r.parent_id=m.id and r.kind in ('collection','franchise') where m.kind='collection' group by m.id having count(*) between 2 and 60) counts order by members,id`;
const candidates=[available[0],available[Math.floor(available.length/2)],available.at(-1)].filter((row,index,all)=>row&&all.findIndex(x=>x?.id===row.id)===index);
try{
 for(const row of candidates){
  const entries=await sequenceEntries(owner.id,{kind:'collection',id:row.id});
  if(entries.length<2||entries.length>150)continue;
  let result:any;const queries:string[]=[];const previous=session.logger,previousOptions=session.options.logger;const logger={logQuery:(q:string)=>queries.push(q)};session.logger=logger;session.options.logger=logger;
  const started=performance.now();
  try{await withRequestConfig(()=>db.transaction(async tx=>{await tx.execute(query`set local statement_timeout='20s'`);result=await bulkTrackInTransaction(tx,owner.id,{mediaId:row.id,action:'watch',acknowledged:true});throw Error('AUDIT_ROLLBACK');}));}
  catch(error:any){if(error.message!=='AUDIT_ROLLBACK')throw error;}
  finally{session.logger=previous;session.options.logger=previousOptions;}
  output.samples.push({entries:entries.length,directMembers:row.members,elapsedMs:performance.now()-started,changed:result.changed,total:result.total,ormStatements:queries.length,sequenceExpansionStatements:queries.filter(q=>q.includes('source_kind')&&q.includes('from entries order by sort_path')).length,sequenceValidationStatements:queries.filter(q=>q.includes('with requested(kind,id) as')).length,trackingEventInsertStatements:queries.filter(q=>q.startsWith('insert into "tracking_events"')).length,rolledBack:true});
  if(output.samples.length>=3)break;
 }
 if(!output.samples.length)output.gap='No real collection with 2–150 expanded entries; no fabricated collection seeded';
 await Bun.write(process.argv[2],JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{await closeDb();}
