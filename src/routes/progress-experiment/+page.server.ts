const dev=import.meta.env.DEV;
import {error} from '@sveltejs/kit';
import {progressExperimentData} from '#lib/server/queries/progress-experiment.js';
import * as v from 'valibot';
import {progressExperimentSchema,progressExperimentParameters} from '#lib/progress-experiment.js';
import type {PageServerLoad} from './$types';
import {profileUser} from '#lib/server/queries/profile-user.js';
export const load:PageServerLoad=async({locals,url,depends,request})=>{
  if(!dev)error(404,'Not found.');
  if(!locals.user)error(401,'Sign in to view your progress.');
  depends('coast:tracking','coast:social');
  const options=v.safeParse(progressExperimentSchema,progressExperimentParameters(url));
  if(!options.success)error(400,'Choose a valid progress view and filters.');
  const owner=url.searchParams.has('username')?await profileUser(url.searchParams.get('username')!):undefined;
  return {username:owner?.username,progress:await progressExperimentData(owner?.id??locals.user.id,options.output,{signal:request.signal,viewerId:locals.user.id})};
};
