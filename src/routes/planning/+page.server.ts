import { redirect } from '@sveltejs/kit';
import { planningData } from '$lib/experiments/planning.server';
import { requireUser } from '$lib/server/auth';
import type { PageServerLoad } from './$types';
export const load:PageServerLoad=async({locals,url,depends})=>{if(url.searchParams.get('view')==='releases'){const target=new URLSearchParams(url.searchParams);target.delete('view');target.set('section','upcoming');redirect(303,`/for-you?${target}`);}depends('coast:planning','coast:tracking');return planningData(requireUser(locals.user).id,url);};
