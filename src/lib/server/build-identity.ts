import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Includes executable chunks and manifests, with stable relative paths/order.
 * Maps and browser assets cannot identify the server workload. */
export async function serverBuildIdentity(directory: string) {
  const paths = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name);
  async function visit(relative: string) {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(path);
    }
  }
  await visit('server');
  const hash = createHash('sha256');
  for (const path of paths.sort()) {
    const bytes = await readFile(join(directory, path));
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return 'sha256:' + hash.digest('hex');
}
