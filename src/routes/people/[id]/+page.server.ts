import { AppError } from '$lib/server/security/errors';
import { requireFeature } from '$lib/server/features';
import { error } from '@sveltejs/kit';
import { personDetails } from '$lib/catalogue/details.server';
export const load = async ({ params,locals }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) error(404, 'This person was not found.');
  if(!locals.user)error(401,'Sign in to view people.');
  try{await requireFeature(locals.user.id,'screen');}catch(cause){if(cause instanceof AppError)error(cause.status,cause.message);throw cause;}
  const person = await personDetails(id);
  const { credits, ...details } = person;
  return { person: details };
};
