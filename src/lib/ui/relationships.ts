import type { change } from './client';
export type Relationship = 'collected' | 'watchlist' | 'favourite' | 'queued';

/** Shared Coast relationships use one delivery contract for every work category. */
export function setRelationship(workId: string, relationship: Relationship, value: boolean, deliver: typeof change) {
  if (relationship === 'collected') return deliver(`collection/${workId}`, { collected: value });
  if (relationship === 'queued') return deliver('up-next', { mediaId: workId, queued: value });
  return deliver('tracking', { mediaId: workId, action: relationship, value });
}
