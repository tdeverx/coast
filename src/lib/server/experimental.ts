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
  return null;
}
export function requireExperimentalFeature(config: ExperimentalFeatures, feature: ExperimentalFeature) {
  if (!featureEnabled(config, feature)) throw new AppError(404, `${feature === 'music' ? 'Music' : feature === 'gaming' ? 'Gaming' : 'Parties'} is disabled.`, 'experimental_disabled');
}
export function requireEnabledCategory(config: MediumFeatures, category: string) {
  if (!categoryEnabled(config, category)) throw new AppError(404, 'This medium is disabled.', 'experimental_disabled');
}
/** Filter before counting/pagination; disabled media remain stored. */
export function enabledCategories(category: SQL, config: MediumFeatures) {
  return sql`(${category}='screen' or (${category}='music' and ${config.experimentalMusic}) or (${category}='game' and ${config.experimentalGaming}))`;
}
