import * as v from 'valibot';
import { importReading } from '$lib/catalogue/reading.server';
import { ensureReadingSaved } from '$lib/core/reading/service.server';
import { readingReferenceSchema } from '$lib/reading/model';
import { readingProviderDetails } from '$lib/providers/reading.server';

/** Explicit additions compose provider reads, shared identity and private state.
 * Network work completes before either domain acquires transaction locks. */
export async function addReading(userId: string, raw: unknown) {
  const input = v.parse(readingReferenceSchema, raw);
  const metadata = await readingProviderDetails(input.kind, input.externalId);
  const item = await importReading(metadata);
  await ensureReadingSaved(userId, item.id);
  return item;
}
