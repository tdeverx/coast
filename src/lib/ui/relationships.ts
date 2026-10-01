import { api } from './client';
export type Relationship = 'collected' | 'watchlist' | 'favourite' | 'queued';

/** Shared Coast relationships use one delivery contract for every work category. */
export function setRelationship(workId: string, relationship: Relationship, value: boolean) {
  if (relationship === 'collected') return api(`collection/${workId}`, { collected: value });
  if (relationship === 'queued') return api('up-next', { mediaId: workId, queued: value });
  return api('tracking', { mediaId: workId, action: relationship, value });
}
