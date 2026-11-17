import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialReadingBookmarkCycle } from '../src/lib/reading/model';

// The supervisor imports the unbundled schema during container startup. Its
// runtime image contains the database directory, not application domain modules.
test('shipped database schema loads without domain modules and keeps reading storage defaults aligned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-container-schema-'));
  try {
    const database = join(directory, 'src/lib/server/db');
    await mkdir(database, { recursive: true });
    for (const name of ['schema.ts', 'jsonb.ts'])
      await copyFile(new URL(`../src/lib/server/db/${name}`, import.meta.url), join(database, name));
    const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json();
    await Bun.write(join(directory, 'package.json'), JSON.stringify({ type: 'module', imports: manifest.imports }));
    await symlink(new URL('../node_modules', import.meta.url).pathname, join(directory, 'node_modules'), 'dir');
    await Bun.write(join(directory, 'probe.ts'), `
      import { readingProgress, readingSessions } from './src/lib/server/db/schema';
      console.log(JSON.stringify({ progress: readingProgress.bookmarkCycle.default, session: readingSessions.bookmarkCycle.default }));
    `);
    const child = Bun.spawn([process.execPath, 'probe.ts'], { cwd: directory, stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL' });
    const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text();
    expect({ status: await child.exited, stderr: await stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(await stdout)).toEqual({ progress: initialReadingBookmarkCycle, session: initialReadingBookmarkCycle });
    expect(await Bun.file(join(directory, 'src/lib/reading/model.ts')).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
