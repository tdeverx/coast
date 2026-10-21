import {error} from '@sveltejs/kit';
import * as v from 'valibot';
import {AppError} from '#lib/server/security/errors.js';
import {readingGroupDetail} from '#lib/reading/groups.server.js';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,depends})=>{
 if(!locals.user)error(401,'Sign in to browse reading collections.');
 depends('coast:reading');depends('coast:tracking');
 try{return await readingGroupDetail(locals.user.id,params.id);}
 catch(cause){if(v.isValiError(cause))error(400,'Check the reading collection identifier.');if(cause instanceof AppError)error(cause.status,cause.message);throw cause;}
};
