import {requireUser} from '$lib/server/auth';
import {roomState} from '$lib/playback/synced/service.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params})=>({room:await roomState(requireUser(locals.user).id,params.id)});
