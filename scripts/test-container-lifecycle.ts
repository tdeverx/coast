// Exercise the actual Bash5 wait helper with short-lived fixture children only.
const containerName=process.argv[2];
if(!containerName || !/^[a-zA-Z0-9_-]+$/.test(containerName))throw new Error("Pass a disposable test container name with Bash5.");
const helper=await Bun.file(new URL("./container-wait.sh",import.meta.url)).text();
// Run the actual entrypoint with fake programs and a private temporary data tree.
// Only installed helper paths are redirected; no PostgreSQL or Coast service runs.
const entrypoint=(await Bun.file(new URL("./container-entrypoint.sh",import.meta.url)).text())
 .replace('/usr/local/lib/coast-container-storage.sh','"$fixture_dir/storage.sh"')
 .replace('/usr/local/lib/coast-container-wait.sh','"$fixture_dir/wait.sh"');
const tests=String.raw`
set -u
case_test(){
  termination_signal=''; database_pid='';
  if [[ "$1" == app ]]; then (sleep .03;exit 7)& application_pid=$!; (sleep 1;exit 0)& database_pid=$!; expected=7; expected_pid=$application_pid
  elif [[ "$1" == database ]]; then (sleep 1;exit 0)& application_pid=$!; (sleep .03;exit 9)& database_pid=$!; expected=9; expected_pid=$database_pid
  else (sleep .03;exit 11)& application_pid=$!; expected=11; expected_pid=$application_pid; fi
  wait_for_coast_children
  [[ "$exit_code" == "$expected" && "$completed_pid" == "$expected_pid" ]] || exit 1
  kill "$application_pid" "$database_pid" 2>/dev/null || true;wait 2>/dev/null || true
  printf '%s child/status passed\n' "$1"
}
case_test app;case_test database;case_test external
termination_signal='';database_pid='';(sleep 20)& application_pid=$!;parent=$BASHPID
shutdown(){ trap - TERM INT;kill -TERM "$application_pid" 2>/dev/null||true;wait 2>/dev/null||true; }
trap 'termination_signal=TERM;shutdown' TERM
(sleep .03;kill -TERM "$parent")&
wait_for_coast_children
[[ "$exit_code" == 143 && -z "$completed_pid" && "$termination_signal" == TERM ]] || exit 1
printf 'TERM preserved143 with no attributed child\n'
`;
const startupTests=String.raw`
set -eu
fixture_dir="$(mktemp -d /tmp/coast-lifecycle-fixture.XXXXXX)"
export fixture_dir
trap 'rm -rf -- "$fixture_dir"' EXIT
cat > "$fixture_dir/storage.sh" <<'COAST_STORAGE_FIXTURE'
prepare_coast_storage(){
 mkdir -p "$1/secrets" "$1/runtime"
 printf '%064d\n' 0 > "$1/secrets/database-password"
}
prepare_postgres_storage(){ mkdir -p "$1";printf '16\n' > "$1/PG_VERSION"; }
COAST_STORAGE_FIXTURE
cat > "$fixture_dir/child.sh" <<'COAST_CHILD_FIXTURE'
#!/bin/bash
printf '%s\n' "$$" > "$fixture_dir/$1.pid"
case "$1:$FIXTURE_SCENARIO" in
 database:database-startup) sleep .03;exit 9;;
 migration:migration-failed|migration:writer-failed) exit 17;;
 migration:migration-term|database:startup-term|database:readiness-timeout) exec sleep 20;;
 migration:*) exit 0;;
 application:*) exit 7;;
 *) exec sleep 20;;
esac
COAST_CHILD_FIXTURE
cat > "$fixture_dir/entrypoint.sh" <<'COAST_ENTRYPOINT_PRELUDE'
find(){ if [[ "$1" == /usr/lib/postgresql ]];then printf '%s\n' "$fixture_dir/bin";else command find "$@";fi; }
sleep(){ if [[ "$1" == 1 ]];then command sleep .01;else command sleep "$@";fi; }
gosu(){
 shift
 local program="$1";shift
 case "$program" in
  bun) case "$1" in
   /app/scripts/migrate.ts) exec /bin/bash "$fixture_dir/child.sh" migration;;
   /app/build/index.js) exec /bin/bash "$fixture_dir/child.sh" application;;
   /app/scripts/container-child-exit.ts)
    shift
    [[ "$FIXTURE_SCENARIO" != writer-failed ]] || return 1
    printf '%s|%s|%s|%s\n' "$2" "$3" "$4" "$5" >> "$fixture_dir/records";;
   *) return 1;;
  esac;;
  "$fixture_dir/bin/postgres") exec /bin/bash "$fixture_dir/child.sh" database;;
  "$fixture_dir/bin/pg_isready") [[ "$FIXTURE_SCENARIO" != database-startup && "$FIXTURE_SCENARIO" != startup-term && "$FIXTURE_SCENARIO" != readiness-timeout ]];;
  "$fixture_dir/bin/psql") printf '1\n';;
  *) command "$program" "$@";;
 esac
}
COAST_ENTRYPOINT_PRELUDE
`+`cat >> "$fixture_dir/entrypoint.sh" <<'COAST_ENTRYPOINT_SOURCE'\n${entrypoint}\nCOAST_ENTRYPOINT_SOURCE\ncat > "$fixture_dir/wait.sh" <<'COAST_WAIT_SOURCE'\n${helper}\nCOAST_WAIT_SOURCE\n`+String.raw`
export COAST_DATA_DIR="$fixture_dir/data"
unset DATABASE_URL
run_entrypoint(){
 export FIXTURE_SCENARIO="$1"
 rm -f "$fixture_dir/records" "$fixture_dir/"*.pid
 /bin/bash "$fixture_dir/entrypoint.sh" > "$fixture_dir/output" 2>&1 & entrypoint_pid=$!
 if [[ "$1" == migration-term || "$1" == startup-term ]];then
  local phase=migration
  [[ "$1" != startup-term ]] || phase=database
  for attempt in {1..100};do [[ ! -f "$fixture_dir/$phase.pid" ]] || break;sleep .01;done
  [[ -f "$fixture_dir/$phase.pid" ]] || { cat "$fixture_dir/output";exit 1; }
  kill -TERM "$entrypoint_pid"
 fi
 local status=0
 wait "$entrypoint_pid" || status=$?
 [[ "$status" == "$2" ]] || { cat "$fixture_dir/output";printf '%s returned %s, expected %s\n' "$1" "$status" "$2";exit 1; }
 if [[ "$1" == writer-failed ]];then
  [[ ! -e "$fixture_dir/records" ]] || exit 1
 else
  local expected="$3||$2|"
  if [[ "$3" == termination ]];then expected="$3||$2|TERM"
  elif [[ "$3" != startup ]];then expected="$3|$(cat "$fixture_dir/$3.pid")|$2|";fi
  [[ "$(wc -l < "$fixture_dir/records")" == 1 && "$(cat "$fixture_dir/records")" == "$expected" ]] || { cat "$fixture_dir/records";exit 1; }
 fi
 for phase in database migration application;do
  if [[ -f "$fixture_dir/$phase.pid" ]];then
   ! kill -0 "$(cat "$fixture_dir/$phase.pid")" 2>/dev/null || { printf '%s child survived shutdown\n' "$phase";exit 1; }
  fi
 done
 printf '%s startup record/status/shutdown passed\n' "$1"
}
run_entrypoint application-exit 7 application
run_entrypoint database-startup 9 database
run_entrypoint readiness-timeout 1 startup
run_entrypoint migration-failed 17 migration
run_entrypoint startup-term 143 termination
run_entrypoint migration-term 143 termination
run_entrypoint writer-failed 17 migration
`;
const child=Bun.spawn(['container','exec',containerName,'/bin/bash','-c',helper+'\n'+tests+'\n'+startupTests],{stdout:'inherit',stderr:'inherit'});
process.exitCode=await child.exited;
