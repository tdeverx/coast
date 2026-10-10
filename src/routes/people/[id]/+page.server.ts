import { error } from '@sveltejs/kit';
import { personDetails } from '$lib/catalogue/details.server';
export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) error(404, 'This person was not found.');
  const person = await personDetails(id);
  const { credits, ...details } = person;
  return { person: details };
};
