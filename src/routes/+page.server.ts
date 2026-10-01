import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
export const load = (({locals}) => redirect(303, locals.user ? '/for-you' : '/discover')) satisfies PageServerLoad;
