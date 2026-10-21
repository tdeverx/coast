import {error} from '@sveltejs/kit';
import {AppError} from '#lib/server/security/errors.js';
import {personDetailData} from '#lib/catalogue/details.server.js';
export const load=async({params,locals})=>{
 if(!locals.user)error(401,'Sign in to view people.');
 try{return await personDetailData(locals.user.id,Number(params.id));}
 catch(cause){if(cause instanceof AppError)error(cause.status,cause.message);throw cause;}
};
