// Exercise the actual Bash5 wait helper with short-lived fixture children only.
const containerName=process.argv[2];
if(!containerName || !/^[a-zA-Z0-9_-]+$/.test(containerName))throw new Error("Pass a disposable test container name with Bash5.");
const helper=await Bun.file(new URL("./container-wait.sh",import.meta.url)).text();
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
const child=Bun.spawn(['container','exec',containerName,'/bin/bash','-c',helper+'\n'+tests],{stdout:'inherit',stderr:'inherit'});
process.exitCode=await child.exited;
