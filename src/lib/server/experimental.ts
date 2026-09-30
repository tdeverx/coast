import type { CoastConfig } from './config';
import { AppError } from './security/errors';

/** Cover pages, nested details, provider music/artwork and all game API mutations. */
export function isExperimentalPath(path: string) {
  // SvelteKit decodes catch-all parameters before the API handler splits them.
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }
  return (
    /^\/(?:music|games)(?:\/|$)/.test(path) ||
    /^\/api\/v1\/(?:games|game-playthroughs)(?:\/|$)/.test(path) ||
    /^\/api\/v1\/providers\/[^/]+\/music(?:\/|$)/.test(path)
  );
}
export function requireExperimentalFeatures(config: Pick<CoastConfig, 'experimentalFeatures'>) {
  if (!config.experimentalFeatures)
    throw new AppError(404, 'Experimental features are disabled.', 'experimental_disabled');
}
