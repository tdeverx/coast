import {expect, test} from 'bun:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {databaseEvent} from '../scripts/container-postgres';

test('PostgreSQL evidence discards private statements and recognizes only fixed categories', () => {
  expect(databaseEvent('STATEMENT: SELECT PRIVATE')).toBeUndefined();
  expect(databaseEvent('FATAL: PRIVATE')).toBeUndefined();
  expect(databaseEvent('2026-10-11 05:00:00 UTC [123] PANIC: could not flush dirty data: Structure needs cleaning')).toEqual({kind: 'database.failed', code: 'storage-corrupt'});
  expect(databaseEvent('2026-10-11 05:00:00 UTC [123] LOG: received fast shutdown request')).toEqual({kind: 'database.shutdown', code: 'shutdown-start'});
});

test('database exit/known errors survive independently, bounded and redacted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-pg-audit-'));
  try {
    const script = 'console.error("STATEMENT: PRIVATE"); for(let i=0;i<1000;i++) console.error("2026-10-11 05:00:00 UTC [123] PANIC: PRIVATE"); process.exit(7)';
    const child = Bun.spawn([process.execPath, 'scripts/container-postgres.ts', directory, process.execPath, '-e', script], {stdout:'ignore', stderr:'ignore'});
    expect(await child.exited).toBe(7);
    const text = await readFile(join(directory, 'runtime', 'database-events.jsonl'), 'utf8');
    const rows = text.trim().split('\n').map(line => JSON.parse(line));
    expect(rows.filter(row => row.kind === 'database.failed')).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({kind: 'database.exit', detail: {exitCode: 7}});
    expect(text).not.toContain('PRIVATE');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('unwritable database audit still returns the child exit status', async () => {
  const child = Bun.spawn([process.execPath, 'scripts/container-postgres.ts', '/dev/null/unwritable', process.execPath, '-e', 'process.exit(11)'], {stdout:'ignore',stderr:'ignore'});
  expect(await child.exited).toBe(11);
});

test('TERM requests PostgreSQL fast shutdown via INT and preserves its result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-pg-signal-'));
  const script = 'process.on("SIGINT", () => process.exit(23)); process.on("SIGTERM", () => process.exit(99)); console.log("ready"); setInterval(() => {}, 1000)';
  const child = Bun.spawn([process.execPath, 'scripts/container-postgres.ts', directory, process.execPath, '-e', script], {stdout:'pipe',stderr:'ignore'});
  try {
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
    reader.releaseLock();
    child.kill('SIGTERM');
    expect(await child.exited).toBe(23);
    const rows = (await readFile(join(directory, 'runtime', 'database-events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows.at(-1)).toMatchObject({kind:'database.exit',detail:{exitCode:23}});
  } finally {child.kill(); await child.exited; await rm(directory, {recursive:true,force:true});}
});

test('QUIT escalates a pending fast shutdown and preserves the child result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-pg-escalation-'));
  const script = 'process.on("SIGINT", () => console.log("fast")); process.on("SIGQUIT", () => process.exit(24)); console.log("ready"); setInterval(() => {}, 1000)';
  const child = Bun.spawn([process.execPath, 'scripts/container-postgres.ts', directory, process.execPath, '-e', script], {stdout:'pipe',stderr:'ignore'});
  try {
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
    child.kill('SIGTERM');
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('fast');
    reader.releaseLock();
    child.kill('SIGQUIT');
    expect(await child.exited).toBe(24);
  } finally {child.kill(); await child.exited; await rm(directory, {recursive:true,force:true});}
});
