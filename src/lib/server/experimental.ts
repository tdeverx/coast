import type { ExperimentalFeatures, ExperimentalFeature, MediumFeatures } from '$lib/experimental';
import { featureEnabled, categoryEnabled } from '$lib/experimental';
import { sql, type SQL } from 'drizzle-orm';
import { AppError } from './security/errors';

/** Decode catch-all paths before identifying their independent feature gate. */
export function experimentalPathFeature(path: string): ExperimentalFeature | null {
  try { path = decodeURIComponent(path); } catch { return null; }
  if (/^\/(?:music)(?:\/|$)/.test(path) || /^\/api\/v1\/music(?:\/|$)/.test(path) || /^\/api\/v1\/providers\/[^/]+\/music(?:\/|$)/.test(path)) return 'music';
  if (/^\/games(?:\/|$)/.test(path) || /^\/api\/v1\/(?:games|game-playthroughs)(?:\/|$)/.test(path)) return 'gaming';
  if (/^\/synced(?:\/|$)/.test(path) || /^\/api\/v1\/synced(?:\/|$)/.test(path)) return 'parties';
  if (/^\/media\/openlibrary(?:\/|$)/.test(path)) return 'books';
  if (/^\/media\/comic-vine(?:\/|$)/.test(path)) return 'comics';
  return null;
}
export function requireExperimentalFeature(config: ExperimentalFeatures, feature: ExperimentalFeature) {
  if (!featureEnabled(config, feature)) throw new AppError(404, `${{music:'Music',gaming:'Gaming',parties:'Parties',books:'Books',comics:'Comics'}[feature]} is disabled.`, 'experimental_disabled');
}
export function requireEnabledCategory(config: MediumFeatures, category: string) {
  if (!categoryEnabled(config, category)) throw new AppError(404, 'This medium is disabled.', 'experimental_disabled');
}
/** Filter before counting/pagination; disabled media remain stored. */
export function enabledCategories(category: SQL, config: MediumFeatures) {
  return sql`(${category}='screen' or (${category}='music' and ${config.experimentalMusic}) or (${category}='game' and ${config.experimentalGaming}) or (${category}='book' and ${config.experimentalBooks}) or (${category}='comic' and ${config.experimentalComics}))`;
}

/** Reading is a UI group; canonical works retain their book/comic categories. */
export function selectedCategory(category: SQL, selection: string) {
  return selection === 'all' ? sql`true` : selection === 'reading' ? sql`${category} in ('book','comic')` : sql`${category}=${selection}`;
}
