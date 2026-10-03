import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function run(directory: string, script: string) {
  const child = Bun.spawn([process.execPath, 'scripts/container-application.ts', directory, process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const output = new Response(child.stderr).text();
  return { status: await child.exited, stderr: await output };
}
test('stderr survives restart, stays private and preserves failure status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-stderr-'));
  try {
    expect(await run(directory, 'console.error("fixture failure"); process.exit(7)')).toEqual({ status: 7, stderr: 'fixture failure\n' });
    expect((await run(directory, 'console.error("next lifetime")')).status).toBe(0);
    const path = join(directory, 'runtime/application-stderr.log');
    const saved = await Bun.file(path).text();
    expect(saved).toContain('fixture failure');
    expect(saved).toContain('next lifetime');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('stderr stays bounded with large writes and retains the final error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-stderr-'));
  try {
    expect((await run(directory, 'await Bun.write(Bun.stderr, "x".repeat(800000)); console.error("final failure"); process.exitCode=9')).status).toBe(9);
    for (const name of ['application-stderr.log', 'application-stderr.log.1']) {
      expect((await stat(join(directory, 'runtime', name))).size).toBeLessThanOrEqual(256 * 1024);
    }
    expect(await Bun.file(join(directory, 'runtime/application-stderr.log')).text()).toContain('final failure');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('failed diagnostic storage still forwards stderr and preserves child status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-stderr-'));
  try {
    await Bun.write(join(directory, 'blocked'), 'file');
    expect(await run(join(directory, 'blocked'), 'console.error("fixture failure"); process.exit(11)')).toEqual({ status: 11, stderr: 'fixture failure\n' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('TERM reaches the application and its final stderr is drained before exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-stderr-'));
  const ready = join(directory, 'ready');
  const script = `process.on('SIGTERM', () => { console.error('shutdown evidence'); process.exit(23); }); await Bun.write(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`;
  const child = Bun.spawn([process.execPath, 'scripts/container-application.ts', directory, process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const output = new Response(child.stderr).text();
  try {
    for (let i = 0; i < 200 && !await Bun.file(ready).exists(); i++) await Bun.sleep(5);
    expect(await Bun.file(ready).exists()).toBe(true);
    child.kill('SIGTERM');
    expect(await child.exited).toBe(23);
    expect(await output).toContain('shutdown evidence');
    expect(await Bun.file(join(directory, 'runtime/application-stderr.log')).text()).toContain('shutdown evidence');
  } finally { child.kill(); await rm(directory, { recursive: true, force: true }); }
}, 5000);
