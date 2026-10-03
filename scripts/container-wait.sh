#!/bin/bash
# Sets the identity and status of the completed child. An interrupted wait has
# no child identity; the entrypoint records its independently trapped signal.
wait_for_coast_children() {
  completed_pid=""
  if [[ -n "$database_pid" ]]; then
    wait -n -p completed_pid "$database_pid" "$application_pid"
    exit_code=$?
  else
    wait "$application_pid"
    exit_code=$?
    if [[ -z "${termination_signal:-}" ]]; then completed_pid="$application_pid"; fi
  fi
  completed_pid="${completed_pid:-}"
}
