import {error} from '@sveltejs/kit';
import {readingGroupDetail} from '$lib/reading/groups.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,depends})=>{
 if(!locals.user)error(401,'Sign in to browse reading collections.');
 depends('coast:reading');depends('coast:tracking');
 return readingGroupDetail(locals.user.id,params.id);
};
