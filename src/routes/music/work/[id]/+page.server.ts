import {error} from '@sveltejs/kit';
import * as v from 'valibot';
import {AppError} from '$lib/server/security/errors';
import {musicDetailData} from '$lib/music/detail.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,url,depends})=>{
 depends('coast:tracking');
 try{return await musicDetailData(locals.user?.id??null,params.id,Number(url.searchParams.get('page')??1));}
 catch(cause){if(v.isValiError(cause))error(400,'Check the music identifier and page.');if(cause instanceof AppError)error(cause.status,cause.message);throw cause;}
};
