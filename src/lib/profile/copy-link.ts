import type { Feedback } from '#lib/ui/action-feedback.svelte.js';
import { profilePath } from './url.js';

export async function copyProfileLink(username: string, feedback: Pick<Feedback, 'notify' | 'failure'>) {
  try {
    await navigator.clipboard.writeText(new URL(profilePath(username), location.origin).href);
    feedback.notify('Profile link copied.');
  } catch {
    feedback.failure('Could not copy the profile link. Open the profile and copy it from the address bar.');
  }
}
