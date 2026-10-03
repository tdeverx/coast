#!/bin/bash

# These helpers run in the root entrypoint before either service is started.
# A failed chown is tolerated only after permissions and the target process's
# actual access have been checked. PostgreSQL additionally requires its data
# directory to be owned by the postgres UID.

storage_error() {
  printf 'Coast storage: %s\n' "$1" >&2
  exit 1
}

path_mode() {
  stat -c '%a' -- "$1" 2>/dev/null
}

path_uid() {
  stat -c '%u' -- "$1" 2>/dev/null
}

postgres_storage_error() {
  storage_error "$1 Use a POSIX-compatible managed volume or set DATABASE_URL to an external PostgreSQL database."
}

secure_mode() {
  local path="$1" expected="$2" description="$3" actual
  if chmod "$expected" -- "$path" 2>/dev/null; then return 0; fi
  actual="$(path_mode "$path")" || storage_error "cannot verify permissions on $description ($path)."
  [[ "$actual" == "$expected" ]] || storage_error "$description ($path) must have mode $expected; chmod was denied and its current mode is $actual."
}

write_probe() {
  local user="$1" path="$2" description="$3"
  if ! gosu "$user" bash -c '
    set -e
    probe="$1/.coast-write-test-$$-${RANDOM}"
    (umask 077; : > "$probe")
    test -r "$probe" && test -w "$probe"
    rm -f -- "$probe"
  ' _ "$path"; then
    storage_error "$description ($path) is not readable and writable by $user. Correct the host ownership or permissions, or use a POSIX-compatible managed volume."
  fi
}

private_secret_tree() {
  local root="$1" path
  # A secret directory must not contain links that could escape its private
  # boundary. Tighten existing regular-file permissions as well as the root.
  if find "$root" -type l -print -quit | grep -q .; then
    storage_error "the secrets directory ($root) contains a symbolic link; remove it and restart."
  fi
  while IFS= read -r -d '' path; do
    secure_mode "$path" 700 "secrets directory"
  done < <(find "$root" -type d -print0)
  while IFS= read -r -d '' path; do
    secure_mode "$path" 600 "secret file"
    if ! gosu coast test -r "$path"; then
      storage_error "Coast cannot read the existing secret $path. Correct its host ownership to UID $(id -u coast) and restart."
    fi
  done < <(find "$root" -type f -print0)
}

prepare_coast_storage() {
  local data_dir="$1" path
  if ! mkdir -p -- "$data_dir" "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"; then
    storage_error "cannot create the required directories under $data_dir. Make the mount writable by the container administrator."
  fi

  # Probe each required path. A failed chown is an unsupported capability only
  # if the filesystem itself still meets the required mode and access checks.
  local ownership_supported=true
  for path in "$data_dir" "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"; do
    if ! chown coast:coast -- "$path" 2>/dev/null; then ownership_supported=false; fi
  done
  if ! chown -R coast:coast -- "$data_dir/secrets" 2>/dev/null; then ownership_supported=false; fi

  secure_mode "$data_dir" 755 'data directory'
  for path in "$data_dir/secrets" "$data_dir/artwork" "$data_dir/runtime"; do
    secure_mode "$path" 700 'private Coast directory'
    write_probe coast "$path" 'Coast data directory'
  done
  private_secret_tree "$data_dir/secrets"


}

prepare_postgres_storage() {
  local pg_data="$1" socket_dir="${2:-/var/run/postgresql}" expected_uid actual_uid
  expected_uid="$(id -u postgres)" || storage_error 'the bundled PostgreSQL user is missing from the image.'
  if ! mkdir -p -- "$pg_data" "$socket_dir"; then
    storage_error "bundled PostgreSQL cannot create its data or socket directory. Use a POSIX-compatible managed volume or set DATABASE_URL to an external PostgreSQL database."
  fi

  # Unlike Coast's files, PostgreSQL validates ownership itself. Writable
  # permissions alone are not enough to safely use PGDATA.
  if ! chown postgres:postgres -- "$pg_data" 2>/dev/null; then
    actual_uid="$(path_uid "$pg_data")" || actual_uid='unknown'
    [[ "$actual_uid" == "$expected_uid" ]] || storage_error "bundled PostgreSQL requires ownership of $pg_data by UID $expected_uid, but this mount does not permit it. Use a POSIX-compatible managed volume or set DATABASE_URL to an external PostgreSQL database."
  fi
  if ! chmod 700 -- "$pg_data" 2>/dev/null; then
    actual_uid="$(path_mode "$pg_data")" || actual_uid='unknown'
    [[ "$actual_uid" == 700 ]] || postgres_storage_error "bundled PostgreSQL cannot secure its data directory $pg_data (required mode 700; current mode $actual_uid)."
  fi
  actual_uid="$(path_uid "$pg_data")" || postgres_storage_error "cannot verify the owner of $pg_data."
  [[ "$actual_uid" == "$expected_uid" ]] || postgres_storage_error "bundled PostgreSQL data at $pg_data must be owned by UID $expected_uid."
  write_probe postgres "$pg_data" 'PostgreSQL data directory'

  if ! chown postgres:postgres -- "$socket_dir" 2>/dev/null; then
    actual_uid="$(path_uid "$socket_dir")" || actual_uid='unknown'
    [[ "$actual_uid" == "$expected_uid" ]] || storage_error "bundled PostgreSQL cannot own its socket directory $socket_dir. Use a POSIX-compatible managed volume or set DATABASE_URL to an external PostgreSQL database."
  fi
  write_probe postgres "$socket_dir" 'PostgreSQL socket directory'
}
