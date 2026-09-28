#!/bin/bash
set -Eeuo pipefail
umask 077

data_dir="${COAST_DATA_DIR:-/data}"
mkdir -p "$data_dir" "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"
chown coast:coast "$data_dir" "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"
chmod 755 "$data_dir"
chmod 700 "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"
chown -R coast:coast "$data_dir/secrets"
if [[ -e "$data_dir/recovery-credential" ]]; then
  chown coast:coast "$data_dir/recovery-credential"
  chmod 600 "$data_dir/recovery-credential"
fi

database_pid=""
application_pid=""
shutdown() {
  trap - TERM INT
  if [[ -n "$application_pid" ]]; then kill -TERM "$application_pid" 2>/dev/null || true; fi
  if [[ -n "$database_pid" ]]; then kill -TERM "$database_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap shutdown TERM INT EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  pg_bin="$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin | sort -V | tail -1)"
  if [[ -z "$pg_bin" ]]; then echo 'Bundled PostgreSQL was not found.' >&2; exit 1; fi
  pg_data="$data_dir/postgres"
  mkdir -p "$pg_data" /var/run/postgresql
  chown postgres:postgres "$pg_data" /var/run/postgresql
  chmod 700 "$pg_data"
  password_file="$data_dir/secrets/database-password"
  if [[ ! -s "$password_file" ]]; then
    bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))' > "$password_file"
    chown coast:coast "$password_file"
    chmod 600 "$password_file"
  fi
  database_password="$(cat "$password_file")"
  # The locally generated password is also safe for SQL and URL embedding.
  if [[ ! "$database_password" =~ ^[a-f0-9]{64}$ ]]; then echo 'The bundled database credential file is invalid.' >&2; exit 1; fi
  if [[ ! -s "$pg_data/PG_VERSION" ]]; then
    init_password="$(mktemp)"
    printf '%s\n' "$database_password" > "$init_password"
    chown postgres:postgres "$init_password"
    gosu postgres "$pg_bin/initdb" -D "$pg_data" --username=postgres --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256 --pwfile="$init_password" > /dev/null
    rm -f "$init_password"
  fi
  gosu postgres "$pg_bin/postgres" -D "$pg_data" -c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql &
  database_pid=$!
  database_ready=false
  for attempt in {1..60}; do
    if gosu postgres "$pg_bin/pg_isready" -q -h /var/run/postgresql -U postgres; then database_ready=true; break; fi
    if ! kill -0 "$database_pid" 2>/dev/null; then echo 'Bundled PostgreSQL exited during startup.' >&2; exit 1; fi
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

gosu coast bun /app/scripts/migrate.ts
gosu coast bun /app/build/index.js &
application_pid=$!
# If either child dies, stop the other and let the container restart as a unit.
set +e
if [[ -n "$database_pid" ]]; then wait -n "$database_pid" "$application_pid"; else wait "$application_pid"; fi
exit_code=$?
set -e
exit "$exit_code"
