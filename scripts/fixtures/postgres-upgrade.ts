// Fresh PostgreSQL clusters only, inside a dedicated Linux fixture container.
import {mkdirSync, chmodSync, statSync, readFileSync, existsSync, rmSync, renameSync, openSync, closeSync} from 'node:fs';
import {dirname} from 'node:path';
const root = dirname(import.meta.path), data = process.env.COAST_UPGRADE_TEST_DATA || root + '/data';
const {encryptCredential, decryptCredential} = await import(root + '/credentials.ts');
const pg15 = '/usr/lib/postgresql/15/bin', pg17 = '/usr/lib/postgresql/17/bin';
const servers = new Map<string, string>();
const apps = new Set<Bun.Subprocess>();
const origin='http://127.0.0.1:3974';
const password = 'a'.repeat(64);
function assert(ok: unknown, reason: string): asserts ok {if (!ok) throw Error(reason);}
async function run(args: string[], env: Record<string, string> = {}, success = true) {
  const child = Bun.spawn(args, {cwd: '/app', env: {...process.env, DATABASE_URL: '', ...env}, stdout: 'pipe', stderr: 'pipe'});
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (success && code) throw Error(`Fixture command failed (${args[0]}, ${code}):\n${output}\n${error}`);
  return {output: output.trim(), error, code};
}
async function sql(query: string, db = 'coast', bin = pg17) {
  return (await run(['gosu', 'postgres', bin + '/psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', db, '-c', query])).output;
}
async function start(directory: string, bin: string) {
  await run(['gosu', 'postgres', bin + '/pg_ctl', '-D', directory, '-l', directory + '/fixture.log', '-o', '-c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql', '-w', 'start']);
  servers.set(directory, bin);
}
async function stop(directory: string) {
  await run(['gosu', 'postgres', servers.get(directory)! + '/pg_ctl', '-D', directory, '-m', 'fast', '-w', 'stop']);
  servers.delete(directory);
}
function application(directory:string){
  const file=directory+'/supervisor.log',fd=openSync(file,'w',0o600);
  const child=Bun.spawn(['/usr/local/bin/coast-entrypoint'],{cwd:'/app',detached:true,env:{...process.env,COAST_DATA_DIR:directory,DATABASE_URL:'',HOST:'127.0.0.1',PORT:'3974',ORIGIN:origin},stdin:'ignore',stdout:fd,stderr:fd});
  apps.add(child);void child.exited.then(()=>{closeSync(fd);apps.delete(child);});return {child,file};
}
async function stopped(child:Bun.Subprocess){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const code=await Promise.race([child.exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('supervisor stop deadline exceeded')),30000);})]);assert(code===143,`supervisor returned ${code}`);}
  finally{if(timer)clearTimeout(timer);}
}
async function ready(item:ReturnType<typeof application>){
  for(let i=0;i<600;i++){
    if(item.child.exitCode!==null)throw Error(`startup failed (${item.child.exitCode}):\n${readFileSync(item.file,'utf8').slice(-18000)}`);
    try{if((await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(1000)})).status===200)return;}catch{}
    await Bun.sleep(100);
  }
  throw Error('automatic upgrade/application readiness deadline exceeded');
}
async function upgrade(directory: string, success = true) {
  if(!success)return run(['/usr/local/bin/coast-entrypoint'],{COAST_DATA_DIR:directory},false);
  // Exercise normal image startup, including schema migrations and HTTP readiness.
  const app=application(directory);await ready(app);app.child.kill('SIGTERM');await stopped(app.child);
  return {code:0};
}
async function startupRefused(directory: string, reason: string, env:Record<string,string>={}) {
  const result = await run(['/usr/local/bin/coast-entrypoint'], {COAST_DATA_DIR: directory,...env}, false);
  assert(result.code !== 0 && result.error.includes(reason), 'startup did not refuse ' + reason + ': ' + result.error);
}
async function login(db = 'coast') {
  return (await run([pg17 + '/psql', '-XAt', '-h', '127.0.0.1', '-U', 'coast', '-d', db, '-c', 'SELECT count(*) FROM upgrade_fixture'], {PGPASSWORD: password})).output;
}
function key(directory: string) {return readFileSync(directory + '/secrets/credentials.key').toString('hex');}
try {
  mkdirSync(data, {recursive: true});
  try {chmodSync(data, 0o755);} catch (error) {if ((statSync(data).mode & 0o777) !== 0o755) throw error;}
  mkdirSync(data + '/postgres', {mode: 0o700, recursive: true});
  // Use actual image identities rather than relying on Debian's allocation order.
  await run(['chown', 'postgres:postgres', data + '/postgres']);
  await run(['mkdir', '-p', '/var/run/postgresql']);
  await run(['chown', 'postgres:postgres', '/var/run/postgresql']);
  await run(['gosu', 'postgres', pg15 + '/initdb', '-D', data + '/postgres', '--data-checksums', '--username=postgres', '--encoding=UTF8', '--locale=C.UTF-8', '--auth-local=trust', '--auth-host=scram-sha-256']);
  mkdirSync(data + '/secrets', {mode: 0o700});
  await Bun.write(data + '/secrets/database-password', password + '\n');
  process.env.COAST_DATA_DIR = data;
  const cipher = await encryptCredential('upgrade-fixture-provider-token');
  const originalKey = key(data);
  await start(data + '/postgres', pg15);
  await sql(`CREATE ROLE coast LOGIN PASSWORD '${password}'`, 'postgres');
  await sql('CREATE DATABASE coast OWNER coast', 'postgres');
  await run(['bun', '/app/scripts/migrate.ts'], {COAST_DATA_DIR: data, DATABASE_URL: `postgresql://coast:${password}@127.0.0.1:5432/coast`});
  const userHash=await Bun.password.hash('synthetic-upgrade-password');
  await sql(`INSERT INTO users(username,password_hash,settings) SELECT 'upgrade-'||n,'${userHash}',jsonb_build_object('action','watch','profile',jsonb_build_object('bio','保存 🎵 '||n)) FROM generate_series(1,128) n`);
  const usersDigest=()=>sql("SELECT md5(string_agg(row_to_json(u)::text,'' ORDER BY id)) FROM users u");
  const usersBefore=await usersDigest();
  await sql('CREATE DATABASE coast_archive OWNER coast','postgres');
  await sql('SET ROLE coast; CREATE TABLE archive(id integer PRIMARY KEY, value text); INSERT INTO archive SELECT n,md5(n::text) FROM generate_series(1,1000) n','coast_archive');
  const archiveDigest=()=>sql("SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY id)) FROM archive a",'coast_archive');
  const archiveBefore=await archiveDigest();
  await sql(`SET ROLE coast; CREATE TABLE upgrade_fixture(id serial PRIMARY KEY, credential text, payload jsonb, payload_bytes bytea, numbers integer[]); INSERT INTO upgrade_fixture(credential,payload,payload_bytes,numbers) SELECT '${cipher}',jsonb_build_object('n',n,'text','保存 🎵','null',null),decode(md5(n::text),'hex'),ARRAY[n,n+1] FROM generate_series(1,2000) n`);
  const digest=()=>sql("SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM upgrade_fixture t");
  const before=await digest();
  const hash = await sql("SELECT rolpassword FROM pg_authid WHERE rolname='coast'");
  const migrations = await sql('SELECT count(*) FROM drizzle.__drizzle_migrations');
  await stop(data + '/postgres');
  renameSync(data+'/postgres/PG_VERSION',data+'/postgres/saved-version');
  await startupRefused(data,'existing PostgreSQL files have no PG_VERSION');
  renameSync(data+'/postgres/saved-version',data+'/postgres/PG_VERSION');
  const tools=root+'/tools';mkdirSync(tools);
  await Bun.write(tools+'/df',"#!/bin/bash\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 1 1 0 100%% /\\n'\n");chmodSync(tools+'/df',0o755);
  await startupRefused(data,'no data was changed',{PATH:tools+':'+process.env.PATH});
  assert(!existsSync(data+'/postgres-upgrade'),'capacity preflight changed upgrade state');
  assert(key(data) === originalKey, 'setup changed the key');
  // Existing credentials must never be silently replaced, including fresh 17 startup.
  renameSync(data + '/secrets/database-password', data + '/secrets/saved-password');
  assert((await upgrade(data, false)).code !== 0, 'missing credential accepted');
  renameSync(data + '/secrets/saved-password', data + '/secrets/database-password');
  assert(!existsSync(data + '/postgres-upgrade'), 'preflight created upgrade state');
  await Bun.write(data + '/postgres/postmaster.pid', '999999\n');
  assert((await upgrade(data, false)).code !== 0, 'running/stale PID accepted');
  rmSync(data + '/postgres/postmaster.pid');
  const lock = Bun.spawn(['flock', data + '/.postgres-maintenance.lock', 'bash', '-c', 'echo locked; read'], {stdin: 'pipe', stdout: 'pipe'});
  const reader = lock.stdout.getReader(); await reader.read(); reader.releaseLock();
  try {assert((await upgrade(data, false)).code !== 0, 'concurrent maintenance accepted');}
  finally {lock.stdin.end(); await lock.exited;}
  console.log('PASS missing metadata/secret/PID/concurrent-volume and insufficient-space preflight guards');

  // Real pg_upgrade check failure: incompatible server configuration, no mocks.
  const failed = root + '/failed';
  await run(['cp', '-a', data, failed]);
  const config = await Bun.file(failed + '/postgres/postgresql.conf').text();
  await Bun.write(failed + '/postgres/postgresql.conf', config + '\ncoast_invalid_setting = true\n');
  assert((await upgrade(failed, false)).code !== 0, 'invalid configuration accepted');
  assert(readFileSync(failed + '/postgres/15/PG_VERSION', 'utf8').trim() === '15', 'failure switched source');
  assert(existsSync(failed + '/postgres-upgrade/in-progress'), 'failure marker lost');
  await startupRefused(failed, 'upgrade is incomplete');
  await Bun.write(failed + '/postgres/15/postgresql.conf', config);
  await start(failed + '/postgres/15', pg15);
  assert(await login() === '2000' && await digest()===before, 'source changed after failure');
  await stop(failed + '/postgres/15');
  console.log('PASS real upgrade failure retains restartable PG15 and blocks partial startup');

  const interrupted=root+'/interrupted';await run(['cp','-a',data,interrupted]);
  const pending=application(interrupted);
  for(let i=0;i<3000&&!existsSync(interrupted+'/postgres-upgrade/in-progress');i++){
    assert(pending.child.exitCode===null,'upgrade exited before interruption point');await Bun.sleep(2);
  }
  assert(existsSync(interrupted+'/postgres-upgrade/in-progress'),'upgrade did not enter staging');
  pending.child.kill('SIGTERM');await stopped(pending.child);
  await startupRefused(interrupted,'upgrade is incomplete');
  await start(interrupted+'/postgres',pg15);assert(await digest()===before,'interruption changed source rows');await stop(interrupted+'/postgres');
  console.log('PASS actual supervisor interruption retains data and blocks incomplete restart');

  await upgrade(data);
  assert(readFileSync(data + '/postgres/17/PG_VERSION', 'utf8').trim() === '17', '17 not selected');
  assert(readFileSync(data + '/postgres/15/PG_VERSION', 'utf8').trim() === '15', '15 rollback missing');
  assert(key(data) === originalKey && readFileSync(data + '/secrets/database-password', 'utf8') === password + '\n', 'secrets changed');
  await upgrade(data);
  await start(data + '/postgres/17', pg17);
  assert((await sql('SHOW server_version_num')).startsWith('17'), 'server major not 17');
  assert(await sql('SHOW data_checksums') === 'on', 'upgrade lost source checksums');
  assert(await login() === '2000' && await digest()===before, 'original rows or TCP SCRAM credential changed');
  assert(await usersDigest()===usersBefore&&await archiveDigest()===archiveBefore,'accounts or additional database changed');
  assert(await Bun.password.verify('synthetic-upgrade-password',await sql("SELECT password_hash FROM users WHERE username='upgrade-1'")),'user login hash lost');
  assert(await sql("SELECT rolpassword FROM pg_authid WHERE rolname='coast'") === hash, 'role hash changed');
  assert(await sql('SELECT count(*) FROM drizzle.__drizzle_migrations') === migrations, 'migration history lost');
  assert(await sql("SELECT tableowner FROM pg_tables WHERE tablename='upgrade_fixture'") === 'coast', 'ownership lost');
  assert(await decryptCredential(await sql('SELECT credential FROM upgrade_fixture WHERE id=1')) === 'upgrade-fixture-provider-token', 'provider credential lost');
  assert(await sql("INSERT INTO upgrade_fixture(credential) VALUES ('after17') RETURNING id") === '2001', 'sequence lost');
  await run(['bun', '/app/scripts/migrate.ts'], {COAST_DATA_DIR: data, DATABASE_URL: `postgresql://coast:${password}@127.0.0.1:5432/coast`});
  // Logical backup restoration on 17, including encrypted content.
  const dump = data + '/postgres/logical.dump';
  await run(['gosu', 'postgres', pg17 + '/pg_dump', '-h', '/var/run/postgresql', '-U', 'postgres', '-Fc', '-f', dump, 'coast']);
  await sql('CREATE DATABASE coast_restored OWNER coast', 'postgres');
  await run(['gosu', 'postgres', pg17 + '/pg_restore', '-h', '/var/run/postgresql', '-U', 'postgres', '--exit-on-error', '-d', 'coast_restored', dump]);
  assert(await login('coast_restored') === '2001', 'logical restore lost rows');
  assert(await decryptCredential(await sql('SELECT credential FROM upgrade_fixture WHERE id=1', 'coast_restored')) === 'upgrade-fixture-provider-token', 'logical restore credential lost');
  await stop(data + '/postgres/17');
  await upgrade(data);
  await start(data + '/postgres/17', pg17); assert(await login() === '2001', '17 restart lost committed rows'); await stop(data + '/postgres/17');
  console.log('PASS automatic 15→17 HTTP readiness, exact rows/schema/role hash/ownership/sequences/provider key, logical restore, migrations and repeated startup');

  await start(data + '/postgres/15', pg15);
  assert(await login() === '2000' && await digest()===before, 'rollback copy changed after 17 writes');
  await stop(data + '/postgres/15');
  const restored = root + '/restored'; mkdirSync(restored, {mode: 0o755});
  await run(['bash', '-c', 'cd "$1"; sha256sum -c postgres-15-and-secrets.tar.sha256', '_', data + '/postgres-upgrade']);
  await run(['tar', '-C', restored, '-xpf', data + '/postgres-upgrade/postgres-15-and-secrets.tar']);
  assert(key(restored) === originalKey, 'cold backup key changed');
  await start(restored + '/postgres', pg15);
  assert(await digest()===before && await sql("SELECT rolpassword FROM pg_authid WHERE rolname='coast'") === hash, 'cold restore failed');
  await stop(restored + '/postgres');
  // An interruption between the two renames must never initialise an empty DB.
  renameSync(restored + '/postgres', restored + '/postgres-15');
  mkdirSync(restored + '/postgres-upgrade'); await Bun.write(restored + '/postgres-upgrade/in-progress', '');
  await startupRefused(restored, 'upgrade is incomplete');
  assert(!existsSync(restored + '/postgres'), 'interrupted switch initialised empty cluster');
  console.log('PASS independent PG15 rollback after PG17 writes, cold database+secrets restore and interrupted-switch guard');
  const fresh=root+'/fresh';mkdirSync(fresh,{mode:0o755});await upgrade(fresh);
  assert(readFileSync(fresh+'/postgres/PG_VERSION','utf8').trim()==='17'&&!existsSync(fresh+'/postgres-upgrade'),'fresh install did not directly initialize 17');
  console.log('PASS fresh PostgreSQL 17 ordinary startup');
  const unchecked=root+'/unchecked';mkdirSync(unchecked,{mode:0o755});mkdirSync(unchecked+'/postgres',{mode:0o700});
  await run(['chown','postgres:postgres',unchecked+'/postgres']);
  await run(['gosu','postgres',pg15+'/initdb','-D',unchecked+'/postgres','--username=postgres','--encoding=UTF8','--locale=C.UTF-8','--auth-local=trust','--auth-host=scram-sha-256']);
  mkdirSync(unchecked+'/secrets',{mode:0o700});await Bun.write(unchecked+'/secrets/database-password',password+'\n');
  await start(unchecked+'/postgres',pg15);await sql(`CREATE ROLE coast LOGIN PASSWORD '${password}'`,'postgres',pg15);await sql('CREATE DATABASE coast OWNER coast','postgres',pg15);await stop(unchecked+'/postgres');
  await upgrade(unchecked);await start(unchecked+'/postgres/17',pg17);assert(await sql('SHOW data_checksums')==='off','upgrade changed disabled checksums');await stop(unchecked+'/postgres/17');
  console.log('PASS checksum-enabled and checksum-disabled source upgrades');
  console.log('DISPOSABLE_POSTGRES_UPGRADE_PASSED');
} finally {
  for(const child of apps){child.kill('SIGTERM');await stopped(child).catch(()=>child.kill('SIGKILL'));}
  for (const [directory, bin] of servers) await run(['gosu', 'postgres', bin + '/pg_ctl', '-D', directory, '-m', 'immediate', '-w', 'stop'], {}, false);
}
