import { actionUrl, resolveAction } from '#lib/actions.js';
import { categoryEnabled, surfaceEnabled } from '#lib/experimental.js';
import { browseSources } from '#lib/recommendations/browse-sources.server.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { discoveryContent, discoveryHero, discoveryParameters } from '#lib/server/queries/discovery.js';
import { READING_PROVIDER_PAGE_LIMIT } from '#lib/reading/model.js';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, depends, url, request }) => {
  depends('coast:tracking');
  depends('coast:reading');
  depends('coast:providers');

  const userId = locals.user?.id ?? null;
  const config = await getFeatureConfig(userId);
  if (locals.user) url = actionUrl(url, locals.user.settings?.action, config);
  const action = locals.user ? resolveAction(url.searchParams, locals.user.settings?.action, config) : 'watch';
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('surface', action);
  const section = url.searchParams.get('section');
  const recommendationSection = section === 'dynamic' || section === 'recommendations' || section === 'browse';
  if (recommendationSection) {
    for (const parameter of ['section','kind','page']) scopedUrl.searchParams.delete(parameter);
  }
  let selection;
  try { selection = discoveryParameters(scopedUrl); }
  catch (cause) { if (v.isValiError(cause)) error(400, 'Choose valid discovery filters.'); throw cause; }
  if (selection.surface === 'read') {
    if (selection.page > READING_PROVIDER_PAGE_LIMIT) error(400, 'Choose a valid discovery page.');
    if (!surfaceEnabled(config,'read') || selection.kind !== 'all' && !categoryEnabled(config,selection.kind))
      error(404,'This reading selection is unavailable.');
  }
  const selected = section && !recommendationSection ? await discoveryContent(userId,selection,request.signal) : undefined;
  const overview = !section && action === 'watch' && config.features.screen;
  const [featured, sources] = overview
    ? await Promise.all([discoveryHero(userId), browseSources('screen',config.enableTrakt)])
    : [[], null];
  return {
    selection, selected, featured,
    configured: !overview || !!(sources?.screen || (userId && config.enableRequests && sources?.seerr)),
    tmdb: sources?.tmdb ?? false,
  };
}) satisfies PageServerLoad;
