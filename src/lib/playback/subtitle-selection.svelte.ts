import { page } from '$app/state';
import type { SubtitleSelection } from './subtitles';

// A card can unmount before playback begins. Retain only the latest tab-local choices.
type Edition = { edition?: string; editionName?: string };
type Choice = SubtitleSelection & Edition & { mediaId: string };
let viewer: string | undefined;
let choices = $state.raw<Choice[]>([]);

export function rememberSubtitle(mediaId: string, edition: Edition, selection: SubtitleSelection) {
  const current = page.data.user?.id;
  if (!current) return;
  if (viewer !== current) { viewer = current; choices = []; }
  choices = [...choices.filter(choice => choice.mediaId !== mediaId), { mediaId, ...edition, ...selection }].slice(-32);
}
export function pendingSubtitle(mediaId: string, request: Edition & { sourceId?: string } = {}) {
  if (page.data.user?.id !== viewer || page.url.pathname === '/share') return undefined;
  return choices.find(choice => choice.mediaId === mediaId &&
    (request.edition === undefined || choice.edition === request.edition) &&
    (request.editionName === undefined || choice.editionName === request.editionName) &&
    (request.sourceId === undefined || [choice.sourceId, choice.availabilityId].includes(request.sourceId)));
}
export function consumeSubtitle(choice: Choice) {
  choices = choices.filter(value => value !== choice);
}
