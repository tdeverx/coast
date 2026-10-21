import {requireUser} from '#lib/server/auth/index.js';
import {roomState} from '#lib/playback/synced/service.server.js';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params})=>({room:await roomState(requireUser(locals.user).id,params.id)});
