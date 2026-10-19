import * as v from 'valibot';
import { comicFormats } from './model';
const positive = (maximum: number) => v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(maximum));
/** Presentation metadata only: paths, provider credentials and archive names never leave Coast. */
export const readingManifestSchema = v.strictObject({
    version: v.literal(1),
    edition: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
    format: v.picklist(comicFormats),
    pages: v.pipe(v.array(v.strictObject({
        width: positive(2048),
        height: positive(2048),
        bytes: positive(32 * 1024 ** 2),
    })), v.minLength(1), v.maxLength(10000)),
});
export type ReadingManifest = v.InferOutput<typeof readingManifestSchema>;
