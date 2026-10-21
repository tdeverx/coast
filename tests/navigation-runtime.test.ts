import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkNavigationRuntime, navigationRuntime } from '../scripts/check-navigation-runtime';
import { runInvalidationSchedules, runNavigationSchedules } from './fixtures/navigation-runtime';

const root = resolve(import.meta.dir, '..');
const installed = 'node_modules/@sveltejs/kit';

async function installedSource() {
  await checkNavigationRuntime(root);
  return readFile(resolve(root, `${installed}/src/runtime/client/client.js`), 'utf8');
}

test('installed navigation owner passes all eight reviewed commit/callback/fork schedules', async () => {
  const schedules = await runNavigationSchedules(await installedSource());
  expect(schedules).toHaveLength(8);
  for (const schedule of schedules) expect({ name: schedule.name, correct: schedule.correct }).toEqual({ name: schedule.name, correct: true });
});

test('installed invalidation owner passes all ten Kit 3 refresh/shallow/cancellation/reentrancy schedules', async () => {
  const schedules = await runInvalidationSchedules(await installedSource());
  expect(schedules).toHaveLength(10);
  for (const schedule of schedules) expect({ name: schedule.name, correct: schedule.correct }).toEqual({ name: schedule.name, correct: true });
});

test('navigation build admission rejects version, registration, patch and installed-source drift', async () => {
  const target = await mkdtemp(resolve(tmpdir(), 'coast-navigation-drift-'));
  const files = ['package.json', navigationRuntime.patch, `${installed}/package.json`, `${installed}/src/runtime/client/client.js`];
  const original = new Map(await Promise.all(files.map(async path => [path, await readFile(resolve(root, path))] as const)));
  try {
    for (const path of files) {
      await mkdir(dirname(resolve(target, path)), { recursive: true });
      await copyFile(resolve(root, path), resolve(target, path));
    }
    expect((await checkNavigationRuntime(target)).installedSourceVerified).toBe(true);
    const manifest = JSON.parse(original.get('package.json')!.toString());
    const packageInfo = JSON.parse(original.get(`${installed}/package.json`)!.toString());
    const faults = [
      { path: 'package.json', bytes: JSON.stringify({ ...manifest, devDependencies: { ...manifest.devDependencies, '@sveltejs/kit': `^${navigationRuntime.version}` } }), error: 'navigation_runtime_version_pin_changed' },
      { path: 'package.json', bytes: JSON.stringify({ ...manifest, patchedDependencies: {} }), error: 'navigation_runtime_patch_registration_changed' },
      { path: `${installed}/package.json`, bytes: JSON.stringify({ ...packageInfo, version: '0.0.0' }), error: 'navigation_runtime_installed_version_changed' },
      { path: navigationRuntime.patch, bytes: original.get(navigationRuntime.patch)!.toString() + '\n', error: 'navigation_runtime_patch_changed' },
      { path: `${installed}/src/runtime/client/client.js`, bytes: original.get(`${installed}/src/runtime/client/client.js`)!.toString() + '\n', error: 'navigation_runtime_installed_client_changed' },
    ];
    for (const fault of faults) {
      await writeFile(resolve(target, fault.path), fault.bytes);
      await expect(checkNavigationRuntime(target)).rejects.toThrow(fault.error);
      await writeFile(resolve(target, fault.path), original.get(fault.path)!);
    }
    await unlink(resolve(target, `${installed}/src/runtime/client/client.js`));
    await expect(checkNavigationRuntime(target)).rejects.toThrow('ENOENT');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
