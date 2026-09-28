import * as v from 'valibot';

export const sequenceSourceSchema = v.object({
  kind: v.picklist(['collection', 'playlist']),
  id: v.pipe(v.string(), v.uuid()),
});
export const sequenceContextSchema = v.object({
  ...sequenceSourceSchema.entries,
  entryId: v.pipe(v.string(), v.minLength(1), v.maxLength(4000)),
});
export type SequenceSource = v.InferOutput<typeof sequenceSourceSchema>;
export type SequenceContext = v.InferOutput<typeof sequenceContextSchema>;

/** Explicitly select fields so a playback context never leaks extra query parameters. */
export function sequencePath(
  source: SequenceSource,
  cursor: { from?: string; after?: string } = {}
) {
  return (
    'sequence?' +
    new URLSearchParams({
      kind: source.kind,
      id: source.id,
      ...(cursor.after ? { after: cursor.after } : cursor.from ? { from: cursor.from } : {}),
    })
  );
}
