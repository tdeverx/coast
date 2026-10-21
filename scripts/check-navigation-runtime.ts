import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Re-review this owner and its schedules before upgrading or removing the patch.
export const navigationRuntime = {
  package: '@sveltejs/kit',
  version: '3.1.0',
  patch: 'patches/sveltejs-kit-3.1.0.patch',
  patchSha256: '95f60540b8911c5c92e126ad455cbb01b41103889d7d28ef31db4a2f73e617d3',
  clientSha256: 'ce883da014a5a6c424dd8bccc3e6ef3f4f30f3f409a32f06c1055654d0eeff5c',
} as const;

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Build admission checks the actual installed owner, not an audit candidate copy. */
export async function checkNavigationRuntime(root = resolve(import.meta.dir, '..')) {
  const [manifestBytes, installedBytes, patch, client] = await Promise.all([
    readFile(resolve(root, 'package.json')),
    readFile(resolve(root, 'node_modules/@sveltejs/kit/package.json')),
    readFile(resolve(root, navigationRuntime.patch)),
    readFile(resolve(root, 'node_modules/@sveltejs/kit/src/runtime/client/client.js')),
  ]);
  const manifest = JSON.parse(manifestBytes.toString());
  const installed = JSON.parse(installedBytes.toString());
  if (manifest.devDependencies?.[navigationRuntime.package] !== navigationRuntime.version) {
    throw new Error('navigation_runtime_version_pin_changed');
  }
  if (manifest.patchedDependencies?.[`${navigationRuntime.package}@${navigationRuntime.version}`] !== navigationRuntime.patch) {
    throw new Error('navigation_runtime_patch_registration_changed');
  }
  if (installed.version !== navigationRuntime.version) {
    throw new Error('navigation_runtime_installed_version_changed');
  }
  if (hash(patch) !== navigationRuntime.patchSha256) {
    throw new Error('navigation_runtime_patch_changed');
  }
  if (hash(client) !== navigationRuntime.clientSha256) {
    throw new Error('navigation_runtime_installed_client_changed');
  }
  return { ...navigationRuntime, installedSourceVerified: true };
}

if (import.meta.main) {
  try {
    const result = await checkNavigationRuntime();
    console.log(`Navigation runtime: ${result.package}@${result.version}, reviewed patch and installed source verified.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'navigation_runtime_check_failed');
    process.exitCode = 1;
  }
}
