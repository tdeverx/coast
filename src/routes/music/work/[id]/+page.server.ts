import {musicDetailData} from '$lib/music/detail.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=({locals,params,url,depends})=>{
 depends('coast:tracking');
 return musicDetailData(locals.user?.id??null,params.id,Number(url.searchParams.get('page')??1));
};
