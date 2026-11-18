import type { MediaView } from '../ui/types';
import type { ActiveCheckin } from '#lib/social/checkins.js';

export const isMediaGroup = (item: Pick<MediaView, 'kind'>) =>
  ['show', 'season', 'collection'].includes(item.kind);
export const isResumable = (item: Pick<MediaView, 'progress' | 'duration'>) =>
  item.progress > 0 && (!item.duration || item.progress < item.duration * 0.9);
export const targetLabel = (item: Pick<MediaView, 'kind'>) =>
  isMediaGroup(item) ? `entire ${item.kind}` : `this ${item.kind}`;
export type MediaActionData = {
  item: MediaView;
  wholeWork: MediaView;
  releaseDate: string | null;
  hasReleaseDate: boolean;
  progressTargetIds: string[];
  hasPersonalOverrides: boolean;
  activeCheckinId: string | null;
  activeCheckin?: ActiveCheckin | null;
  ownRewatchStartedAt: string | null;
  rewatchTargetIds: string[];
  targets: MediaView[];
  requestTarget: MediaView | null;
  requestsEnabled: boolean;
  requestUnavailable?:string;
  refreshTarget: MediaView | null;
  playable: MediaView | null;
  editions: string[];
  requests: {
    id: string;
    state: string;
    seasons: number[];
    destination: string;
    is4k: boolean;
    canCancel: boolean;
    canApprove: boolean;
    canDecline: boolean;
  }[];
};
export type MediaHistory = {
  items: {
    id: string;
    mediaId: string;
    title: string;
    action: string;
    source: string;
    occurredAt: string;
    occurredAtKnown: boolean;
    rewatch: boolean;
    positionSeconds: number | null;
    applied: boolean;
  }[];
  page: number;
  pages: number;
  total: number;
};
