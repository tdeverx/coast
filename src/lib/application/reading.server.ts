import { getFeatureConfig } from '#lib/server/features.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import * as v from 'valibot';
import { importReading } from '#lib/catalogue/reading.server.js';
import { ensureReadingSaved } from '#lib/core/reading/service.server.js';
import { readingReferenceSchema } from '#lib/reading/model.js';
import { readingProviderDetails } from '#lib/providers/reading.server.js';

/** Explicit additions compose provider reads, shared identity and private state.
 * Network work completes before either domain acquires transaction locks. */
export async function addReading(userId: string, raw: unknown) {
  const input = v.parse(readingReferenceSchema, raw);
  const config=await getFeatureConfig(userId);
  requireEnabledCategory(config,input.kind==='comic'?'comic':'reading');
  const metadata = await readingProviderDetails(input.kind, input.externalId);
  requireEnabledCategory(await getFeatureConfig(userId),metadata.kind);
  const item = await importReading(metadata);
  await ensureReadingSaved(userId, item.id);
  return item;
}
