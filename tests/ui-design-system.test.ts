import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = join(import.meta.dir, '../src');
const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]
  );
const appCss = readFileSync(join(sourceRoot, 'app.css'), 'utf8');
const styles = walk(sourceRoot).flatMap((file) => {
  if (file.endsWith('.css')) return [{ file, css: readFileSync(file, 'utf8') }];
  if (!file.endsWith('.svelte')) return [];
  return [...readFileSync(file, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => ({ file, css: match[1] }));
});

describe('shared UI design system', () => {
  test('component typography uses the shared scale rather than local numeric variants', () => {
    const failures: string[] = [];
    const families = { 'font-size': 'text', 'font-weight': 'weight', 'line-height': 'leading', 'letter-spacing': 'tracking' };
    for (const { file, css } of styles) {
      const rules = css.replace(/@font-face\s*\{[\s\S]*?\}/g, '');
      for (const match of rules.matchAll(/\b(font-size|font-weight|line-height|letter-spacing):\s*([^;}]+)/g)) {
        const property = match[1] as keyof typeof families;
        const value = match[2].trim();
        const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
        if (property === 'font-size' && value === 'inherit') continue;
        if (!token?.startsWith(`--${families[property]}-`) || !appCss.includes(`${token}:`))
          failures.push(`${file}: ${property}: ${value}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('surface and component colors use the shared palette', () => {
    const outsidePalette = appCss.replace(/:root\s*\{[\s\S]*?\}/, '');
    expect(outsidePalette.match(/#[\da-f]{3,8}\b/gi) ?? []).toEqual([]);
    for (const { file, css } of styles.filter(({ file }) => file.endsWith('.svelte')))
      expect({ file, colors: css.match(/#[\da-f]{3,8}\b/gi) ?? [] }).toEqual({ file, colors: [] });
  });
});
