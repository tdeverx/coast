import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Keep the reference and its isolated examples available to administrators.
export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/login?next=/ui-preview');
  if (locals.user.role !== 'admin') error(403, 'Administrator access is required.');
};
