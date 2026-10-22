// Actual supervisor/wrappers with synthetic children on Linux; never target live Coast.
const args=process.argv.slice(2), docker=args[0]==='--docker';
if(docker)args.shift();
const name=args[0];
if(!name||!/^coast-(?:shutdown-fixture|lifecycle-test|pr-smoke)[a-zA-Z0-9_-]*$/.test(name))throw Error('Pass a dedicated disposable lifecycle container name.');
const read=(file:string)=>Bun.file(new URL(file,import.meta.url)).text();
const entrypoint=(await read('./container-entrypoint.sh')).replaceAll('/usr/local/lib/coast-container-', '$fixture_dir/container-').replaceAll('/app/scripts/', '$fixture_dir/scripts/').replaceAll('/app/build/index.js', '$fixture_dir/build/index.js').replace('pg_bin=/usr/lib/postgresql/17/bin', 'pg_bin="$fixture_dir/pg-search/version/bin"');
let script=String.raw`
set -Eeuo pipefail
# Background fixtures must not inherit Bash async-list SIGINT suppression.
set -m
fixture_dir="$(mktemp -d /tmp/coast-lifecycle-fixture.XXXXXX)"
export fixture_dir
cleanup(){
 local result=$?
 if ((result));then cat "$fixture_dir/output" 2>/dev/null||true;cat "$fixture_dir/data/runtime/shutdown-events.jsonl" 2>/dev/null||true;fi
 for file in "$fixture_dir/"*.pid;do
  [[ -f "$file" ]] || continue
  local pid;read -r pid < "$file"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -KILL "$pid" 2>/dev/null || true
 done
 rm -rf -- "$fixture_dir"
}
trap cleanup EXIT
mkdir -p "$fixture_dir/scripts" "$fixture_dir/build" "$fixture_dir/bin"
export PATH="$fixture_dir/bin:$PATH" COAST_BUILD_ID=0000000000000000000000000000000000000000
export COAST_SHUTDOWN_APP_SECONDS=1 COAST_SHUTDOWN_DATABASE_SECONDS=1 COAST_SHUTDOWN_IMMEDIATE_SECONDS=1
`;
function file(path:string,source:string){script+=`cat > "$fixture_dir/${path}" <<'COAST_FIXTURE_SOURCE'\n${source}\nCOAST_FIXTURE_SOURCE\n`;}
file('entrypoint.sh',entrypoint);
file('container-wait.sh',await read('./container-wait.sh'));
file('container-shutdown.sh',(await read('./container-shutdown.sh')).replaceAll('/app/scripts/', '$fixture_dir/scripts/'));
file('container-storage.sh',String.raw`
prepare_coast_storage(){ [[ "$FIXTURE_SCENARIO" != storage-failed ]] || return 4; mkdir -p "$1/secrets" "$1/runtime";printf '%064d\n' 0 > "$1/secrets/database-password"; }
lock_coast_storage(){ :; }
check_bundled_postgres_version(){ :; }
prepare_postgres_storage(){ mkdir -p "$1";printf '17\n' > "$1/PG_VERSION"; }
`);
for(const name of ['container-application.ts','container-postgres.ts','container-stderr.ts','runtime-audit.ts','container-shutdown-event.ts'])file('scripts/'+name,await read('./'+name));
file('scripts/container-child-exit.ts',(await read('./container-child-exit.ts')).replace("import { serverBuildIdentity } from '../src/lib/server/build-identity';",'const serverBuildIdentity=async (_path:string)=>"unknown";'));
file('scripts/migrate.ts',"await import('../child.ts');");
file('build/index.js',"await import('../child.ts');");
file('child.ts',String.raw`
const role=process.argv[2]||(process.argv[1].includes('/build/')?'application':'migration');
const scenario=process.env.FIXTURE_SCENARIO, directory=process.env.fixture_dir!;
await Bun.write(directory+'/'+role+'.pid',String(process.pid)+String.fromCharCode(10));
const signal=(kind:string)=>{void Bun.write(directory+'/'+role+'.signal',kind);};
for(const kind of ['SIGTERM','SIGINT','SIGQUIT'] as const)process.on(kind,()=>{
 signal(kind);
 if((role==='application'&&['app-stuck','all-stuck'].includes(scenario!))||role==='orphan'||(role==='database'&&['database-stuck','all-stuck'].includes(scenario!)))return;
 if(role==='database'&&kind==='SIGINT'&&scenario==='database-immediate')return;
 process.exit(0);
});
if((role==='application'&&scenario==='inherited-pipe')||(role==='migration'&&scenario==='migration-pipe')) {
 const orphan=Bun.spawn([process.execPath,directory+'/child.ts','orphan'],{stdout:'ignore',stderr:'inherit'});orphan.unref();
 await Bun.sleep(50);process.exit(role==='application'?7:0);
}
if(role==='migration'&&!['migration-term','migration-stuck'].includes(scenario!))process.exit(scenario==='migration-failed'||scenario==='writer-stalled'?17:0);
if(role==='migration'&&scenario==='migration-stuck') {process.removeAllListeners('SIGTERM');process.on('SIGTERM',()=>{});process.removeAllListeners('SIGINT');process.on('SIGINT',()=>{});}
if(role==='application'&&['application-exit','application-success'].includes(scenario!))setTimeout(()=>process.exit(scenario==='application-exit'?7:0),30);
if(role==='database'&&scenario==='database-startup')setTimeout(()=>process.exit(9),30);
if(role==='database'&&scenario==='database-exit')setInterval(async()=>{if(await Bun.file(directory+'/application.pid').exists())process.exit(9);},10);
setTimeout(()=>process.exit(88),scenario==='all-stuck'?45000:20000);
setInterval(()=>{},1000);
`);
file('bin/gosu',String.raw`#!/bin/bash
shift
if [[ "$FIXTURE_SCENARIO" == writer-stalled && "$1" == bun && ( "$2" == */container-child-exit.ts || "$2" == */container-shutdown-event.ts ) ]];then trap '' TERM;exec sleep 20;fi
exec "$@"
`);
file('bin/postgres',String.raw`#!/bin/bash
if [[ "$1" == --version ]];then printf 'postgres (PostgreSQL) 17.11\n';else exec bun "$fixture_dir/child.ts" database;fi
`);
file('bin/pg_isready',String.raw`#!/bin/bash
[[ "$FIXTURE_SCENARIO" != database-startup && "$FIXTURE_SCENARIO" != startup-term && "$FIXTURE_SCENARIO" != readiness-timeout ]]
`);
file('bin/psql',"#!/bin/bash\nprintf '1\\n'\n");
script+=String.raw`
chmod +x "$fixture_dir/bin/"*
# Redirect only the fixed bundled PostgreSQL lookup; no installed files change.
mkdir -p "$fixture_dir/pg-search/version/bin"
for program in postgres pg_isready psql;do ln -s "$fixture_dir/bin/$program" "$fixture_dir/pg-search/version/bin/$program";done
source "$fixture_dir/container-shutdown.sh"
run_case(){
 export FIXTURE_SCENARIO="$1" COAST_DATA_DIR="$fixture_dir/data"
 [[ "$1" != default-deadline ]] || export FIXTURE_SCENARIO=all-stuck
 rm -rf "$fixture_dir/data";rm -f "$fixture_dir/"*.pid "$fixture_dir/"*.signal
 if [[ "$1" == external-term ]];then export DATABASE_URL='postgres://synthetic';else unset DATABASE_URL;fi
 local started=$SECONDS
 # Readiness polling is accelerated; actual shutdown polling is unchanged.
 /bin/bash -c 'sleep(){ if [[ "$1" == 1 ]];then command sleep .01;else command sleep "$@";fi; }; source "$fixture_dir/entrypoint.sh"' > "$fixture_dir/output" 2>&1 & local parent=$!
 case "$1" in
  startup-term) phase=database;; migration-term|migration-stuck) phase=migration;; clean-term|repeated-term|external-term|app-stuck|database-immediate|database-stuck|migration-pipe|default-deadline) phase=application;; *) phase='';;
 esac
 if [[ -n "$phase" ]];then
  for attempt in {1..300};do [[ ! -f "$fixture_dir/$phase.pid" ]] || break;sleep .01;done
  [[ -f "$fixture_dir/$phase.pid" ]] || { cat "$fixture_dir/output";exit 1;}
  kill -"${"${"}3:-TERM}" "$parent"
  if [[ "$1" == repeated-term ]];then sleep .02;kill -TERM "$parent" 2>/dev/null||true;kill -INT "$parent" 2>/dev/null||true;fi
 fi
 local status=0 limit=12
 [[ "$1" != default-deadline ]] || limit=32
 wait "$parent" || status=$?
 [[ "$status" == "$2" && $((SECONDS-started)) -lt "$limit" ]] || { cat "$fixture_dir/output";echo "case $1 status=$status";exit 1;}
 for path in "$fixture_dir/"*.pid;do
  [[ -f "$path" ]] || continue
  local pid state;read -r pid < "$path"
  if [[ -r /proc/$pid/stat ]];then read -r line < /proc/$pid/stat;read -r state rest <<< "${"${"}line##*) }";[[ "$state" == Z || "$state" == X ]] || { echo "child survived $1";exit 1;};fi
 done
 if [[ "$1" != writer-stalled ]];then
  bun -e 'const rows=(await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse);if(rows.filter(r=>r.kind==="supervisor.shutdown"&&r.detail.stage==="start").length!==1||rows.filter(r=>r.detail.stage==="complete").length!==1)process.exit(1)' "$fixture_dir/data/runtime/shutdown-events.jsonl"
 fi
 case "$1" in
  database-immediate) grep -q '"stage":"immediate"' "$fixture_dir/data/runtime/shutdown-events.jsonl";;
  database-stuck|app-stuck|migration-stuck|inherited-pipe|migration-pipe|default-deadline) grep -q '"stage":"kill"' "$fixture_dir/data/runtime/shutdown-events.jsonl";;
 esac
 printf '%s status=%s elapsed=%ss bounded/reaped passed\n' "$1" "$status" "$((SECONDS-started))"
}
run_case application-exit 7
run_case application-success 0
run_case migration-pipe 143
run_case database-exit 9
run_case database-startup 9
run_case readiness-timeout 1
run_case migration-failed 17
run_case startup-term 143
run_case migration-term 143
run_case migration-stuck 143
run_case clean-term 143
run_case clean-term 130 INT
run_case repeated-term 143
run_case external-term 143
run_case app-stuck 143
run_case database-immediate 143
run_case database-stuck 143
run_case inherited-pipe 7
run_case writer-stalled 17
run_case storage-failed 4
unset COAST_SHUTDOWN_APP_SECONDS COAST_SHUTDOWN_DATABASE_SECONDS COAST_SHUTDOWN_IMMEDIATE_SECONDS
run_case default-deadline 143
export COAST_SHUTDOWN_DATABASE_SECONDS=99
run_case invalid-deadline 1
export COAST_SHUTDOWN_DATABASE_SECONDS=invalid
run_case invalid-deadline 1
`;
const child=Bun.spawn([docker?'docker':'container','exec',name,'/bin/bash','-c',script],{stdout:'inherit',stderr:'inherit'});
process.exitCode=await child.exited;
