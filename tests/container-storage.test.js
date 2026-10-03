import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storageScript = join(root, 'scripts/container-storage.sh');

/** @typedef {{ postgresUid?: number, denyMountChown?: boolean, denyMountChmod?: boolean, readOnlyMount?: boolean }} FixtureOptions */

/** @param {FixtureOptions} [options] */
async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'coast-storage-test-'));
  const mount = join(directory, 'data');
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  await mkdir(mount);
  await mkdir(bin);
  await mkdir(state);
  await writeFile(join(state, 'owners.tsv'), '');
  for (const name of ['secrets', 'artwork', 'runtime']) await mkdir(join(mount, name));

  /** @param {string} name @param {string} contents */
  const shim = async (name, contents) => {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/bash\n${contents}\n`, { mode: 0o755 });
    await chmod(path, 0o755);
  };

  await shim('id', `
case "$*" in
  '-u coast') printf '%s\\n' "$(/usr/bin/id -u)" ;;
  '-u postgres') printf '%s\\n' "${options.postgresUid ?? 5432}" ;;
  *) exec /usr/bin/id "$@" ;;
esac`);
  await shim('gosu', 'user="$1"; shift; exec "$@"');
  await shim('stat', `
format="$2"
path="$4"
if [[ "$format" == '%u' ]]; then
  while IFS=$'\\t' read -r mapped_path mapped_uid; do
    if [[ "$mapped_path" == "$path" ]]; then printf '%s\\n' "$mapped_uid"; exit 0; fi
  done < "$FAKE_OWNER_MAP"
  if [[ "$(uname -s)" == Linux ]]; then exec /usr/bin/stat -c '%u' -- "$path"; fi
  exec /usr/bin/stat -f '%u' "$path"
fi
if [[ "$(uname -s)" == Linux ]]; then exec /usr/bin/stat -c '%a' -- "$path"; fi
if [[ "$format" == '%a' ]]; then exec /usr/bin/stat -f '%Lp' "$path"; fi
exit 2`);
  await shim('chown', `
recursive=false
if [[ "$1" == '-R' ]]; then recursive=true; shift; fi
owner="$1"; shift
[[ "$1" == '--' ]] && shift
path="$1"
if [[ "${options.denyMountChown ? '1' : '0'}" == 1 && ( "$path" == "$TEST_MOUNT" || "$path" == "$TEST_MOUNT"/* ) ]]; then
  printf 'chown: Operation not permitted\\n' >&2
  exit 1
fi
name="\${owner%%:*}"
uid="$(id -u "$name")"
printf '%s\\t%s\\n' "$path" "$uid" >> "$FAKE_OWNER_MAP"
exit 0`);
  await shim('chmod', `
mode="$1"; shift
[[ "$1" == '--' ]] && shift
path="$1"
if [[ "${options.denyMountChmod ? '1' : '0'}" == 1 && ( "$path" == "$TEST_MOUNT" || "$path" == "$TEST_MOUNT"/* ) ]]; then
  printf 'chmod: Operation not permitted\\n' >&2
  exit 1
fi
exec /bin/chmod "$mode" "$path"`);

  if (options.readOnlyMount) {
    for (const name of ['', 'secrets', 'artwork', 'runtime']) {
      await chmod(name ? join(mount, name) : mount, 0o555);
    }
  }

  return {
    directory,
    mount,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_MOUNT: mount,
      FAKE_OWNER_MAP: join(state, 'owners.tsv'),
      POSTGRES_UID: String(options.postgresUid ?? 5432),
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

/** @param {Awaited<ReturnType<typeof fixture>>} fixture @param {string} [databaseUrl] */
function run(fixture, databaseUrl = '') {
  const script = [
    'set -Eeuo pipefail',
    `source ${JSON.stringify(storageScript)}`,
    'prepare_coast_storage "$TEST_MOUNT"',
    'if [[ -z "$DATABASE_URL" ]]; then prepare_postgres_storage "$TEST_MOUNT/postgres" "$TEST_MOUNT/socket"; fi',
    'printf "storage-ready\\n"',
  ].join('\n');
  return spawnSync('/bin/bash', ['-c', script], {
    cwd: root,
    env: { ...fixture.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
}

test('ordinary volume with working chown supports bundled PostgreSQL', async () => {
  const setup = await fixture({ postgresUid: 5432 });
  try {
    const result = run(setup);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /storage-ready/);
    assert.equal(((await stat(join(setup.mount, 'secrets'))).mode & 0o777).toString(8), '700');
  } finally {
    await setup.close();
  }
});

test('writable mount with denied chown works with an external database', async () => {
  const setup = await fixture({ denyMountChown: true });
  try {
    const result = run(setup, 'postgresql://external.example/coast');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /storage-ready/);
    await assert.rejects(access(join(setup.mount, 'postgres')));
  } finally {
    await setup.close();
  }
});

test('non-writable mount fails with a concise storage error', async () => {
  const setup = await fixture({ denyMountChown: true, denyMountChmod: true, readOnlyMount: true });
  try {
    const result = run(setup, 'postgresql://external.example/coast');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Coast storage:.*mode 755/);
    assert.doesNotMatch(result.stderr, /chown: changing ownership/);
  } finally {
    // Restore owner write access so the fixture can be removed on all hosts.
    for (const name of ['', 'secrets', 'artwork', 'runtime']) {
      await chmod(name ? join(setup.mount, name) : setup.mount, 0o755).catch(() => {});
    }
    await setup.close();
  }
});

test('bundled PostgreSQL refuses a writable mount that cannot give it PGDATA ownership', async () => {
  const setup = await fixture({ denyMountChown: true, postgresUid: 5432 });
  try {
    const result = run(setup);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled PostgreSQL requires ownership.*POSIX-compatible managed volume.*external PostgreSQL/);
  } finally {
    await setup.close();
  }
});
