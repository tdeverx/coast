#!/bin/bash
set -Eeuo pipefail
umask 077

data_dir="${COAST_DATA_DIR:-/data}"
source /usr/local/lib/coast-container-storage.sh
source /usr/local/lib/coast-container-shutdown.sh

database_pid=""
postgres_directory=""
application_pid=""
migration_pid=""
completed_pid=""
termination_signal=""
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
  timeout --signal=TERM --kill-after=.1 .25 gosu coast bun /app/scripts/container-child-exit.ts "$data_dir" "$child" "$pid" "$status" "$termination_signal" >/dev/null 2>&1 || true
  shutdown_coast_children "$status"
  exit "$status"
}
trap 'termination_signal="TERM"; exit 143' TERM
trap 'termination_signal="INT"; exit 130' INT
trap finish EXIT
prepare_coast_storage "$data_dir"
# Deadlines can be shortened, never extended beyond the 27-second cleanup budget.
for setting in COAST_SHUTDOWN_APP_SECONDS:5 COAST_SHUTDOWN_DATABASE_SECONDS:18 COAST_SHUTDOWN_IMMEDIATE_SECONDS:2; do
  name="${setting%:*}"; maximum="${setting#*:}"; value="${!name:-$maximum}"
  if [[ ! "$value" =~ ^[1-9][0-9]?$ ]] || ((value > maximum)); then echo 'Invalid Coast shutdown deadline.' >&2; exit 1; fi
  case "$name" in
    COAST_SHUTDOWN_APP_SECONDS) shutdown_app_seconds="$value";;
    COAST_SHUTDOWN_DATABASE_SECONDS) shutdown_database_seconds="$value";;
    COAST_SHUTDOWN_IMMEDIATE_SECONDS) shutdown_immediate_seconds="$value";;
  esac
done
command -v setsid >/dev/null

if [[ -z "${DATABASE_URL:-}" ]]; then
  lock_coast_storage "$data_dir"
  pg_bin=/usr/lib/postgresql/17/bin
  if [[ ! -x "$pg_bin/postgres" ]]; then echo 'Bundled PostgreSQL was not found.' >&2; exit 1; fi
  # Metadata only; audit failure must not interfere with startup.
  export COAST_POSTGRES_VERSION="$("$pg_bin/postgres" --version 2>/dev/null || true)"
  check_bundled_postgres_version "$data_dir"
  pg_data="$(bundled_postgres_directory "$data_dir")"
  prepare_postgres_storage "$pg_data"
  postgres_directory="$(readlink -f -- "$pg_data")"
  if [[ -f "$pg_data/PG_VERSION" && "$(cat "$pg_data/PG_VERSION")" == 15 ]]; then
    echo 'Existing PostgreSQL 15 data found; preparing a verified backup and automatic upgrade to 17 before starting Coast.'
    setsid /usr/local/lib/coast-container-postgres-upgrade.sh &
    migration_pid=$!
    track_child "$migration_pid"
    completed_pid="$migration_pid"
    if wait "$migration_pid"; then migration_pid=""; completed_pid=""; else exit "$?"; fi
    check_bundled_postgres_version "$data_dir"
    pg_data="$(bundled_postgres_directory "$data_dir")"
    prepare_postgres_storage "$pg_data"
    postgres_directory="$(readlink -f -- "$pg_data")"
  fi
  password_file="$data_dir/secrets/database-password"
  if [[ ! -s "$password_file" ]]; then
    if [[ -s "$pg_data/PG_VERSION" ]]; then storage_error 'existing bundled PostgreSQL is missing secrets/database-password; restore the original secrets directory.'; fi
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
  setsid bun /app/scripts/container-postgres.ts "$data_dir" gosu postgres "$pg_bin/postgres" -D "$pg_data" -c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql &
  database_pid=$!
  track_child "$database_pid"
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

setsid gosu coast bun /app/scripts/container-application.ts "$data_dir" --migration bun /app/scripts/migrate.ts &
migration_pid=$!
track_child "$migration_pid"
completed_pid="$migration_pid"
if wait "$migration_pid"; then
  # A successful migration process must not leave an inherited-pipe descendant.
  if children_running "$migration_pid"; then
    shutdown_event kill migration KILL
    signal_owned_children "$migration_pid" KILL
    sleep .1
    if children_running "$migration_pid"; then echo 'Migration descendant did not stop.' >&2; exit 1; fi
  fi
  migration_pid=""
  completed_pid=""
else
  exit "$?"
fi
setsid gosu coast bun /app/scripts/container-application.ts "$data_dir" bun /app/build/index.js &
application_pid=$!
track_child "$application_pid"
# If either child dies, stop the other and let the container restart as a unit.
set +e
source /usr/local/lib/coast-container-wait.sh
wait_for_coast_children
set -e
exit "$exit_code"
