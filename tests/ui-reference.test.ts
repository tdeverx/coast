import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { load } from '../src/routes/ui-preview/+layout.server';
import { components, elements, composedComponents, referenceSection } from '../src/routes/ui-preview/catalog';

test('the reference catalog covers every component once across elements and components', () => {
  const files = readdirSync(new URL('../src/lib/ui/components/', import.meta.url))
    .filter(name => name.endsWith('.svelte')).map(name => name.slice(0, -7)).sort();
  expect(files).toEqual([...components].sort());
  const partition = [...elements, ...composedComponents];
  expect(files).toEqual(partition.sort());
  expect(new Set(partition).size).toBe(files.length);
  expect(referenceSection('materials')).toBe('materials');
  expect(referenceSection('charts')).toBe('charts');
  expect(referenceSection('invalid')).toBe('typography');
});

test('the permanent reference and its examples require an administrator', () => {
  const event = (user: { role: string } | null) => ({ locals: { user } }) as Parameters<NonNullable<typeof load>>[0];
  for (const user of [null, { role: 'user' }]) {
    let rejection: unknown;
    try { load(event(user)); } catch (error) { rejection = error; }
    expect(rejection).toMatchObject(user ? { status: 403 } : { status: 303, location: '/login?next=/ui-preview' });
  }
  expect(load(event({ role: 'admin' }))).toBeUndefined();
});
