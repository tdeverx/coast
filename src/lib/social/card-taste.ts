/** Maximum number of work IDs in one personal taste lookup. */
export const maxTasteBatchSize = 72;
export type CardTasteResponse = { scores: Record<string, number>; pending?: string[] };
