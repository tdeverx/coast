#!/bin/bash
# Linux process groups are created by setsid when each child is launched.
# Never wait indefinitely for an unresponsive child or diagnostic writer.
shutdown_started=false
shutdown_app_seconds=5
shutdown_database_seconds=18
shutdown_immediate_seconds=2
declare -A owned_root=() owned_start=() root_start=()
read_process() {
  local line; local -a fields
  IFS= read -r line 2>/dev/null < "/proc/$1/stat" || return 1
  read -ra fields <<< "${line##*) }"
  ((${#fields[@]} >= 20)) || return 1
  proc_state="${fields[0]}"; proc_parent="${fields[1]}"; proc_group="${fields[2]}"; proc_start="${fields[19]}"
  proc_comm="${line#*(}"; proc_comm="${proc_comm%)*}"
}
track_child() {
  local pid="$1"
  if read_process "$pid"; then root_start[$pid]="$proc_start"; owned_root[$pid]="$pid"; owned_start[$pid]="$proc_start"; fi
}
remember_children() {
  local root="${1:-}" path pid parent group birth parent_owned postgres_owned cwd added pass group_safe=true
  [[ "$root" =~ ^[1-9][0-9]*$ ]] || return 0
  if read_process "$root"; then
    # Retry an initial observation only while this is still our direct child.
    if [[ -z "${root_start[$root]:-}" && "$proc_parent" == "$$" ]]; then track_child "$root"; fi
    [[ -n "${root_start[$root]:-}" && "$proc_start" == "${root_start[$root]}" ]] || group_safe=false
  else
    [[ -n "${root_start[$root]:-}" ]] || group_safe=false
  fi
  # Retain start times, so a reparented descendant can still be stopped safely.
  # PostgreSQL backends create their own groups; group-only KILL misses them.
  for pass in {1..8}; do
    added=false
    for path in /proc/[0-9]*/stat; do
      pid="${path#/proc/}"; pid="${pid%/stat}"
      read_process "$pid" || continue
      parent="$proc_parent"; group="$proc_group"; birth="$proc_start"
      if [[ "${owned_root[$pid]:-}" == "$root" && "${owned_start[$pid]:-}" == "$birth" ]]; then continue; fi
      parent_owned=false
      postgres_owned=false
      # A backend may already have reparented after postmaster death. Its comm
      # and cwd identify this bundled cluster without inspecting arguments or
      # credentials, or capturing another/external PostgreSQL installation.
      if [[ "$root" == "${database_pid:-}" && -n "${postgres_directory:-}" && "$proc_comm" == postgres ]]; then
        # Match the PG UID; root's default container capabilities need not
        # permit ptrace-sensitive /proc links belonging to another user.
        cwd="$(gosu postgres readlink -- "/proc/$pid/cwd" 2>/dev/null)" || cwd=""
        [[ "$cwd" != "$postgres_directory" ]] || postgres_owned=true
      fi
      if [[ "${owned_root[$parent]:-}" == "$root" ]] && read_process "$parent" && [[ "$proc_start" == "${owned_start[$parent]:-}" ]]; then parent_owned=true; fi
      if [[ "$postgres_owned" == true || "$parent_owned" == true || ( "$group_safe" == true && "$group" == "$root" ) ]]; then
        owned_root[$pid]="$root"; owned_start[$pid]="$birth"; added=true
      fi
    done
    [[ "$added" == true ]] || break
  done
}
shutdown_event() {
  timeout --signal=TERM --kill-after=.1 .25 gosu coast bun /app/scripts/container-shutdown-event.ts \
    "$data_dir" "$1" "$2" "${3:-}" "${shutdown_status:-0}" >/dev/null 2>&1 || true
}
children_running() {
  local root="${1:-}" pid
  [[ "$root" =~ ^[1-9][0-9]*$ ]] || return 1
  remember_children "$root"
  for pid in "${!owned_root[@]}"; do
    [[ "${owned_root[$pid]}" == "$root" ]] || continue
    read_process "$pid" || continue
    # Zombies cannot execute or hold a database/file descriptor open.
    if [[ "$proc_start" == "${owned_start[$pid]}" && "$proc_state" != Z && "$proc_state" != X ]]; then return 0; fi
  done
  return 1
}
wait_children() {
  local seconds="$1" deadline=$((SECONDS + $1)); shift
  ((deadline <= shutdown_deadline)) || deadline=$shutdown_deadline
  while ((SECONDS < deadline)); do
    local busy=false pid
    for pid in "$@"; do if children_running "$pid"; then busy=true; fi; done
    [[ "$busy" == true ]] || return 0
    sleep .1
  done
  return 0
}
signal_child() {
  local pid="${1:-}" signal="$2"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 0
  if [[ -n "${root_start[$pid]:-}" ]] && read_process "$pid" && [[ "$proc_start" == "${root_start[$pid]}" ]]; then kill -"$signal" "$pid" 2>/dev/null || true; fi
}
signal_owned_children() {
  local root="${1:-}" signal="$2" pid
  [[ "$root" =~ ^[1-9][0-9]*$ ]] || return 0
  remember_children "$root"
  for pid in "${!owned_root[@]}"; do
    [[ "${owned_root[$pid]}" == "$root" ]] || continue
    if read_process "$pid" && [[ "$proc_start" == "${owned_start[$pid]}" ]]; then kill -"$signal" "$pid" 2>/dev/null || true; fi
  done
}
shutdown_coast_children() {
  [[ "$shutdown_started" == false ]] || return 0
  shutdown_started=true
  shutdown_status="$1"
  shutdown_deadline=$((SECONDS + 27))
  shutdown_event start supervisor "${termination_signal:-}"
  remember_children "$application_pid"; remember_children "$migration_pid"; remember_children "$database_pid"
  local role pid
  for role in application migration; do
    if [[ "$role" == application ]]; then pid="$application_pid"; else pid="$migration_pid"; fi
    if children_running "$pid"; then
      shutdown_event drain "$role" TERM
      signal_child "$pid" TERM
      # A dead wrapper may leave descendants; signal the owned tree too.
      if ! kill -0 "$pid" 2>/dev/null; then signal_owned_children "$pid" TERM; fi
    fi
  done
  wait_children "$shutdown_app_seconds" "$application_pid" "$migration_pid"
  for role in application migration; do
    if [[ "$role" == application ]]; then pid="$application_pid"; else pid="$migration_pid"; fi
    if children_running "$pid"; then shutdown_event kill "$role" KILL; signal_owned_children "$pid" KILL; fi
  done
  if children_running "$database_pid"; then
    shutdown_event fast database INT
    # The wrapper translates TERM/INT to PostgreSQL fast shutdown (SIGINT).
    signal_child "$database_pid" TERM
    if ! kill -0 "$database_pid" 2>/dev/null; then signal_owned_children "$database_pid" INT; fi
    wait_children "$shutdown_database_seconds" "$database_pid"
  fi
  if children_running "$database_pid"; then
    shutdown_event immediate database QUIT
    if kill -0 "$database_pid" 2>/dev/null; then signal_child "$database_pid" QUIT
    else signal_owned_children "$database_pid" QUIT; fi
    wait_children "$shutdown_immediate_seconds" "$database_pid"
  fi
  if children_running "$database_pid"; then shutdown_event kill database KILL; signal_owned_children "$database_pid" KILL; fi
  wait_children 1 "$application_pid" "$migration_pid" "$database_pid"
  for role in application migration database; do
    case "$role" in application) pid="$application_pid";; migration) pid="$migration_pid";; database) pid="$database_pid";; esac
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
    if children_running "$pid"; then shutdown_event unreaped "$role" KILL
    elif ! kill -0 "$pid" 2>/dev/null; then wait "$pid" 2>/dev/null || true; fi
  done
  shutdown_event complete supervisor "${termination_signal:-}"
  return 0
}
