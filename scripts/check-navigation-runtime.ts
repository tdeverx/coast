import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Re-review this owner and its schedules before upgrading or removing the patch.
export const navigationRuntime = {
  package: '@sveltejs/kit',
  version: '2.70.3',
  patch: 'patches/sveltejs-kit-2.70.3.patch',
  patchSha256: '94c566a791131b766fe29e8e53ef9107f0ac49de92f9ab7441c629b1077bb78f',
  clientSha256: '8cfd583bd4d9c9aff69d74a8f3440f7b744d731baaeb5133c8e4605a93663141',
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
