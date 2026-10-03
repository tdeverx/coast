#!/bin/bash
set -Eeuo pipefail
umask 077

data_dir="${COAST_DATA_DIR:-/data}"
source /usr/local/lib/coast-container-storage.sh
prepare_coast_storage "$data_dir"

database_pid=""
application_pid=""
migration_pid=""
completed_pid=""
termination_signal=""
shutdown() {
  if [[ -n "$application_pid" ]]; then kill -TERM "$application_pid" 2>/dev/null || true; fi
  if [[ -n "$migration_pid" ]]; then kill -TERM "$migration_pid" 2>/dev/null || true; fi
  if [[ -n "$database_pid" ]]; then kill -TERM "$database_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
finish() {
  local status=$? child="startup" pid="${completed_pid:-}"
  trap - EXIT
  trap '' TERM INT
  if [[ -n "$termination_signal" ]]; then child="termination"; pid=""
  elif [[ -n "$pid" && "$pid" == "$database_pid" ]]; then child="database"
  elif [[ -n "$pid" && "$pid" == "$migration_pid" ]]; then child="migration"
  elif [[ -n "$pid" && "$pid" == "$application_pid" ]]; then child="application"; fi
  # Record startup failures as well as completed children, without replacing the
  # original exit status when the independent diagnostic write fails. Persist
  # before waiting for shutdown, which may itself outlast the container grace.
  gosu coast bun /app/scripts/container-child-exit.ts "$data_dir" "$child" "$pid" "$status" "$termination_signal" || true
  shutdown
  exit "$status"
}
trap 'termination_signal="TERM"; exit 143' TERM
trap 'termination_signal="INT"; exit 130' INT
trap finish EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  pg_bin="$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin | sort -V | tail -1)"
  if [[ -z "$pg_bin" ]]; then echo 'Bundled PostgreSQL was not found.' >&2; exit 1; fi
  pg_data="$data_dir/postgres"
  prepare_postgres_storage "$pg_data"
  password_file="$data_dir/secrets/database-password"
  if [[ ! -s "$password_file" ]]; then
    gosu coast bash -c 'umask 077; bun -e '\''console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))'\'' > "$1"' _ "$password_file"
    chmod 600 "$password_file"
  fi
  if ! gosu coast test -r "$password_file"; then
    echo "Coast cannot read the bundled database credential at $password_file. Correct its host ownership and restart." >&2
    exit 1
  fi
  database_password="$(cat "$password_file")"
  # The locally generated password is also safe for SQL and URL embedding.
  if [[ ! "$database_password" =~ ^[a-f0-9]{64}$ ]]; then echo 'The bundled database credential file is invalid.' >&2; exit 1; fi
  if [[ ! -s "$pg_data/PG_VERSION" ]]; then
    init_password="$(mktemp)"
    printf '%s\n' "$database_password" > "$init_password"
    chown postgres:postgres "$init_password"
    chmod 600 "$init_password"
    gosu postgres "$pg_bin/initdb" -D "$pg_data" --username=postgres --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256 --pwfile="$init_password" > /dev/null
    rm -f "$init_password"
  fi
  gosu postgres "$pg_bin/postgres" -D "$pg_data" -c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql &
  database_pid=$!
  database_ready=false
  for attempt in {1..60}; do
    if gosu postgres "$pg_bin/pg_isready" -q -h /var/run/postgresql -U postgres; then database_ready=true; break; fi
    if ! kill -0 "$database_pid" 2>/dev/null; then
      completed_pid="$database_pid"
      if wait "$database_pid"; then exit_code=0; else exit_code=$?; fi
      echo 'Bundled PostgreSQL exited during startup.' >&2
      exit "$exit_code"
    fi
    sleep 1
  done
  if [[ "$database_ready" != true ]]; then echo 'Bundled PostgreSQL did not become ready.' >&2; exit 1; fi
  if [[ "$(gosu postgres "$pg_bin/psql" -h /var/run/postgresql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='coast'")" != '1' ]]; then
    gosu postgres "$pg_bin/psql" -h /var/run/postgresql -U postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE coast LOGIN PASSWORD '$database_password'" > /dev/null
  fi
  if [[ "$(gosu postgres "$pg_bin/psql" -h /var/run/postgresql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='coast'")" != '1' ]]; then
    gosu postgres "$pg_bin/createdb" -h /var/run/postgresql -U postgres -O coast coast
  fi
  export DATABASE_URL="postgresql://coast:$database_password@127.0.0.1:5432/coast"
  unset database_password
fi

gosu coast bun /app/scripts/migrate.ts &
migration_pid=$!
completed_pid="$migration_pid"
if wait "$migration_pid"; then
  migration_pid=""
  completed_pid=""
else
  exit "$?"
fi
gosu coast bun /app/scripts/container-application.ts "$data_dir" bun /app/build/index.js &
application_pid=$!
# If either child dies, stop the other and let the container restart as a unit.
set +e
source /usr/local/lib/coast-container-wait.sh
wait_for_coast_children
set -e
exit "$exit_code"
