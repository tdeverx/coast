import { type RequestHandler } from '@sveltejs/kit';
import {openPublicShare} from '#lib/sharing/external.server.js';
import {AppError} from '#lib/server/security/errors.js';
const handler:RequestHandler=async({params,request,getClientAddress})=>{
 try{return await openPublicShare(params.token!,request,getClientAddress());}
 catch(error){return Response.json({error:error instanceof AppError?error.message:'Shared playback is unavailable.'},{status:error instanceof AppError?error.status:503,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer'}});}
};
export const GET=handler;
export const HEAD=handler;
