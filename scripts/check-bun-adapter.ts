import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Re-review runtime origin acceptance before changing the adapter or patch.
export const bunAdapter = {
  version: '1.0.0',
  patch: 'patches/sveltejs-adapter-bun-1.0.0.patch',
  files: {
    'patches/sveltejs-adapter-bun-1.0.0.patch': 'bbc9bf17ecefa3ecb283907985a5391f3e756c06a3d809661d081a3bf8ba53a0',
    'node_modules/@sveltejs/adapter-bun/src/env.js': '583a3702bd73aba8ec28aae7ebf1acb6f1c6c2048193612f5a0296a236e13807',
    'node_modules/@sveltejs/adapter-bun/src/handler.js': '707f5acbf85ba0d98134d444186b4394a5ecbbfa8cb1c13eff7425668b2cb814',
  },
} as const;

export async function checkBunAdapter(root = resolve(import.meta.dir, '..')) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const installed = JSON.parse(await readFile(resolve(root, 'node_modules/@sveltejs/adapter-bun/package.json'), 'utf8'));
  if (manifest.devDependencies?.['@sveltejs/adapter-bun'] !== bunAdapter.version || installed.version !== bunAdapter.version)
    throw new Error('bun_adapter_version_changed');
  if (manifest.patchedDependencies?.[`@sveltejs/adapter-bun@${bunAdapter.version}`] !== bunAdapter.patch)
    throw new Error('bun_adapter_patch_registration_changed');
  await Promise.all(Object.entries(bunAdapter.files).map(async ([file, expected]) => {
    const bytes = await readFile(resolve(root, file));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`bun_adapter_source_changed: ${file}`);
  }));
}

if (import.meta.main) {
  await checkBunAdapter();
  console.log('Bun adapter: runtime ORIGIN patch and installed sources verified.');
}
