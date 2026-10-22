// Uses the existing container owner; refuses ordinary/live container names.
const args = process.argv.slice(2), docker = args[0] === '--docker';
if (docker) args.shift();
const name = args[0];
if (!name || !/^coast-(?:shutdown-fixture|lifecycle-test)[a-zA-Z0-9_-]*$/.test(name)) throw Error('Pass a dedicated disposable Linux container with the candidate image and no running app/PG.');
const source = await Bun.file(new URL('./fixtures/postgres-upgrade.ts', import.meta.url)).text();
const credentials = await Bun.file(new URL('../src/lib/server/security/credentials.ts', import.meta.url)).text();
const script = `set -eu
fixture_dir="$(mktemp -d /tmp/coast-upgrade-test.XXXXXX)"
trap 'rm -rf "$fixture_dir"' EXIT
chmod 755 "$fixture_dir"
cat > "$fixture_dir/credentials.ts" <<'COAST_CREDENTIAL_SOURCE'
${credentials}
COAST_CREDENTIAL_SOURCE
cat > "$fixture_dir/fixture.ts" <<'COAST_UPGRADE_SOURCE'
${source}
COAST_UPGRADE_SOURCE
bun "$fixture_dir/fixture.ts"
`;
const child = Bun.spawn([docker ? 'docker' : 'container', 'exec', name, '/bin/bash', '-c', script], {stdout: 'inherit', stderr: 'inherit'});
process.exitCode = await child.exited;
