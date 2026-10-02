import {mkdtemp,cp,rm} from 'node:fs/promises';
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw Error('Set TEST_DATABASE_URL to an account allowed to create disposable databases.');
const target=new URL(databaseUrl),admin=new Bun.SQL(databaseUrl);
const source='coast_settings_test_backup_'+crypto.randomUUID().replaceAll('-',''),restored='coast_settings_test_restore_'+crypto.randomUUID().replaceAll('-','');
const directory=await mkdtemp('/tmp/coast-recovery-drill-'),restoreDir=await mkdtemp('/tmp/coast-recovery-restored-');
const env={...process.env,COAST_DATA_DIR:directory};
// Optional local Apple Container test PostgreSQL. Otherwise use installed PostgreSQL tools.
const container=process.env.COAST_TEST_PG_CONTAINER,containerTool=process.env.COAST_TEST_CONTAINER_TOOL||'container';
const role=decodeURIComponent(target.username);
const tool=(command:string,args:string[])=>container?[containerTool,'exec',container,command,...args]:[command,...args];
const pgEnv={...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',PGUSER:role,PGPASSWORD:decodeURIComponent(target.password)};
const dumpPath=container?'/tmp/'+source+'.dump':directory+'/database.dump';
let sourceDb:Bun.SQL|undefined,restoreDb:Bun.SQL|undefined;
async function child(args:string[],options:any={}){const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe',...options});const output=await new Response(p.stdout).text(),err=await new Response(p.stderr).text();if(await p.exited)throw Error('Recovery drill step failed: '+err.replaceAll(target.password,'[redacted]'));return output;}
try{
 await admin.unsafe(`create database ${source}`);await admin.unsafe(`create database ${restored}`);
 target.pathname='/'+source;await child([process.execPath,'scripts/migrate.ts'],{env:{...env,DATABASE_URL:target.toString()}});sourceDb=new Bun.SQL(target.toString());
 const credential=await child([process.execPath,'--eval',`import {encryptCredential} from './src/lib/server/security/credentials.ts';console.log(await encryptCredential('restore-fixture-only'));`],{env});
 const user=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await sourceDb`insert into users(id,username) values(${user},'recovery-fixture')`;
 await sourceDb`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Fixture','https://fixture.invalid')`;
 await sourceDb`insert into provider_connections(id,user_id,instance_id,credentials) values(${connection},${user},${instance},${credential.trim()})`;
 await sourceDb`insert into outbox_actions(user_id,connection_id,kind,payload,state) values(${user},${connection},'jellyfin.sync',${{fixture:true}},'pending')`;
 await child(tool('pg_dump',['-U',role,'-Fc','-f',dumpPath,source]),{env:pgEnv});
 await child(tool('pg_restore',['-U',role,'--exit-on-error','-d',restored,dumpPath]),{env:pgEnv});
 await cp(directory+'/secrets',restoreDir+'/secrets',{recursive:true});target.pathname='/'+restored;restoreDb=new Bun.SQL(target.toString());
 const [row]=await restoreDb`select credentials from provider_connections where id=${connection}`;
 const verified=await child([process.execPath,'--eval',`import {decryptCredential} from './src/lib/server/security/credentials.ts';console.log(await decryptCredential(process.env.DRILL_CIPHER!)==='restore-fixture-only'?'verified':'failed');`],{env:{...env,COAST_DATA_DIR:restoreDir,DRILL_CIPHER:row.credentials}});
 if(verified.trim()!=='verified'||(await restoreDb`select count(*)::int as n from outbox_actions where state='pending'`)[0].n!==1)throw Error('Restore verification failed');
 const wrongDir=await mkdtemp('/tmp/coast-recovery-wrong-key-');try{
 const rejected=await child([process.execPath,'--eval',`import {decryptCredential} from './src/lib/server/security/credentials.ts';try{await decryptCredential(process.env.DRILL_CIPHER!);console.log('failed');}catch{console.log('rejected');}`],{env:{...env,COAST_DATA_DIR:wrongDir,DRILL_CIPHER:row.credentials}});if(rejected.trim()!=='rejected')throw Error('Missing-key restore was accepted');
 }finally{await rm(wrongDir,{recursive:true,force:true});}
 console.log('PASS PostgreSQL 17 logical dump/restore, copied key decrypts in a fresh process, missing key rejected, queued work retained');
}finally{
 await sourceDb?.close();await restoreDb?.close();
 for(const name of [source,restored]){await admin.unsafe(`drop database if exists ${name} with (force)`);if(container&&name===source)await child(tool('rm',['-f',dumpPath]));}
 await admin.close();await rm(directory,{recursive:true,force:true});await rm(restoreDir,{recursive:true,force:true});
}
