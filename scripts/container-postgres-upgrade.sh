#!/bin/bash
# Internal startup child. The supervisor owns the installation lock and shutdown.
set -Eeuo pipefail
umask 077
export LC_ALL=C
source /usr/local/lib/coast-container-storage.sh
[[ $# == 0 && -z "${DATABASE_URL:-}" ]] || storage_error 'Only bundled PostgreSQL startup can perform this upgrade.'
data_dir="$(readlink -f -- "${COAST_DATA_DIR:-/data}")"
[[ -d "$data_dir" ]] || storage_error 'the existing data directory must be mounted.'
# Inherit the same locked open-file description; do not reacquire a second lock.
flock -n 9 || storage_error 'the supervisor must hold the installation maintenance lock.'
old="$data_dir/postgres"
rollback="$data_dir/postgres-15"
work="$data_dir/postgres-upgrade"
new="$work/new"
old_bin=/usr/lib/postgresql/15/bin
new_bin=/usr/lib/postgresql/17/bin
[[ -f "$old/PG_VERSION" && "$(cat "$old/PG_VERSION")" == 15 ]] || storage_error 'expected an existing PostgreSQL 15 cluster at postgres/; nothing was upgraded.'
[[ ! -e "$work" && ! -e "$rollback" ]] || storage_error 'upgrade artifacts already exist; see docs/postgresql-17.md for recovery.'
[[ ! -e "$old/postmaster.pid" ]] || storage_error 'PostgreSQL has a postmaster.pid; stop the old container cleanly before upgrading. Do not delete a live server PID file.'
# The bundled layout has no external tablespaces/WAL. Refuse them rather than
# make a backup or rollback promise about files outside this volume.
[[ ! -L "$old" ]] || storage_error 'the PostgreSQL data directory must not be a symbolic link.'
[[ -z "$(find "$old" -type l -print -quit)" ]] || storage_error 'external tablespaces or linked PostgreSQL files require an administrator-managed upgrade.'
[[ -x "$old_bin/postgres" && -x "$new_bin/pg_upgrade" ]] || storage_error 'PostgreSQL 15 and 17 upgrade tools are required.'
state="$(gosu postgres "$old_bin/pg_controldata" "$old" | sed -n 's/^Database cluster state: *//p')"
[[ "$state" == 'shut down' ]] || storage_error 'PostgreSQL 15 must be shut down cleanly; use the previous image for crash recovery and a clean stop first.'
[[ -s "$data_dir/secrets/database-password" ]] || storage_error 'restore the original secrets/database-password before upgrading.'
[[ "$(cat "$data_dir/secrets/database-password")" =~ ^[a-f0-9]{64}$ ]] || storage_error 'the original database-password is invalid; restore the original secrets directory.'
[[ -z "$(find "$data_dir/secrets" -type l -print -quit)" ]] || storage_error 'the secrets directory must not contain symbolic links.'
required=$(( $(du -sk "$old" "$data_dir/secrets" | awk '{total+=$1} END {print total}') * 2 + 65536 ))
free="$(df -Pk "$data_dir" | awk 'END {print $4}')"
((free >= required)) || storage_error "automatic PostgreSQL upgrade needs at least $required KiB free for the verified backup and independent new cluster; no data was changed."

mkdir -m 700 "$work"
# A marker survives failures/signals, including interruption between renames.
# No automatic cleanup removes the backup or either cluster.
touch "$work/in-progress"
cleanup() {
  local status=$?
  trap - EXIT
  if ((status != 0)); then
    # pg_upgrade normally stops its temporary servers itself. This also handles
    # interrupted runs; the source had no PID file when maintenance acquired it.
    for spec in "$old_bin:$old" "$new_bin:$new"; do
      bin="${spec%%:*}"; cluster="${spec#*:}"
      if [[ -f "$cluster/postmaster.pid" ]]; then
        timeout --kill-after=1 2 gosu postgres "$bin/pg_ctl" -D "$cluster" -m immediate -w -t 1 stop >/dev/null 2>&1 || true
      fi
    done
    echo "Automatic PostgreSQL upgrade incomplete. Original data and backup/staging files are retained in $data_dir. See docs/postgresql-17.md for recovery; the application was not started." >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# A cold backup includes the database role hashes and the exact provider key and
# bundled password. Keep a separate off-volume backup as documented.
tar -C "$data_dir" -cpf "$work/postgres-15-and-secrets.tar" postgres secrets
tar -C "$data_dir" -dpf "$work/postgres-15-and-secrets.tar"
(cd "$work" && sha256sum postgres-15-and-secrets.tar > postgres-15-and-secrets.tar.sha256)
sync -f "$work/postgres-15-and-secrets.tar"
sync -f "$work"
mkdir -m 700 "$work/run" "$work/socket"
chown postgres:postgres "$work" "$work/run" "$work/socket"
gosu postgres "$new_bin/initdb" -D "$new" --username=postgres --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256 > "$work/initdb.log"
# Carry installation-specific authentication and settings forward; incompatible
# settings fail the preflight instead of silently reverting to new defaults.
for config in postgresql.conf postgresql.auto.conf pg_hba.conf pg_ident.conf; do
  cp -p -- "$old/$config" "$new/$config"
done
cd "$work/run"
upgrade=(gosu postgres "$new_bin/pg_upgrade" --copy --old-bindir="$old_bin" --new-bindir="$new_bin" --old-datadir="$old" --new-datadir="$new" --username=postgres --socketdir="$work/socket" --old-options='-c listen_addresses=' --new-options='-c listen_addresses=')
"${upgrade[@]}" --check > "$work/check.log" 2>&1
# Default pg_upgrade mode COPIES files. Never use --link: the old cluster must
# remain independently restartable after 17 has accepted writes.
"${upgrade[@]}" > "$work/upgrade.log" 2>&1
# Prove the staged cluster starts and the existing Coast database/owner survive,
# before the only path the application uses is changed.
gosu postgres "$new_bin/pg_ctl" -D "$new" -l "$work/validation.log" -o "-c listen_addresses= -c unix_socket_directories=$work/socket" -w start >/dev/null
[[ "$(gosu postgres "$new_bin/psql" -XAt -v ON_ERROR_STOP=1 -h "$work/socket" -U postgres -d coast -c "select current_setting('server_version_num')::int/10000=17 and exists(select 1 from pg_roles where rolname='coast')")" == t ]]
gosu postgres "$new_bin/pg_ctl" -D "$new" -m fast -w stop >/dev/null
sync -f "$new"
mv -- "$old" "$rollback"
mv -- "$new" "$old"
sync -f "$data_dir"
rm -- "$work/in-progress"
sync -f "$work"
echo 'Automatic PostgreSQL 15 to 17 upgrade complete. The original cluster remains at postgres-15/; a verified database + secrets backup and private logs remain in postgres-upgrade/.'
