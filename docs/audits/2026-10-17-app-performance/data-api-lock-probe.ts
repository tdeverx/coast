/** Source-shaped lock graph, actual row, read/lock only. Run on disposable real-data clone. */
if(process.env.COAST_AUDIT_REAL_DATA_CLONE!=='1')throw Error('Requires actual-data clone');
const name=new URL(process.env.DATABASE_URL!).pathname.slice(1);if(!/audit|clone/.test(name))throw Error('Clone name required');
const sql=new Bun.SQL(process.env.DATABASE_URL!,{max:4,idleTimeout:0});
const [owner]=await sql`select id from users where not disabled order by id limit 1`;
if(!owner)throw Error('No actual user');
let aReady!:()=>void,bReady!:()=>void;const readyA=new Promise<void>(r=>aReady=r),readyB=new Promise<void>(r=>bReady=r);
const start=performance.now();
const a=sql.begin(async tx=>{
 await tx`set local lock_timeout='4s'`;
 await tx`select pg_advisory_xact_lock_shared(hashtextextended('coast:configuration',0))`;
 await tx`select id from users where id=${owner.id} for share`;
 aReady();await readyB;
 await tx`select pg_advisory_xact_lock(hashtextextended(${owner.id},0))`;
 return 'tracking-order-complete';
});
const b=sql.begin(async tx=>{
 await readyA;await tx`set local lock_timeout='4s'`;
 await tx`select pg_advisory_xact_lock(hashtextextended(${owner.id},0))`;
 bReady();
 // publicMutation's unqualified FOR UPDATE locks its joined users row, too.
 // Use the actual user row directly so an installation with zero API tokens is testable.
 await tx`select id from users where id=${owner.id} for update`;
 return 'public-api-order-complete';
});
const settled=await Promise.allSettled([a,b]);
const result={boundary:'actual user row; exact production lock orders; token join reduced to its users-row lock; transactions roll back/commit locks only; no data changes',elapsedMs:performance.now()-start,outcomes:settled.map(x=>x.status==='fulfilled'?{status:x.status,value:x.value}:{status:x.status,code:x.reason?.code??null,errno:x.reason?.errno??null,errorType:x.reason?.constructor?.name??null})};
await Bun.write(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result));await sql.close();
