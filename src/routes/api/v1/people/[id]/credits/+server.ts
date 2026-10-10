import { json, error } from '@sveltejs/kit';
import { personCredits } from '$lib/catalogue/details.server';
export const GET = async ({ locals, params, url }) => {
  const id = Number(params.id),
    page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(page) || page < 1 || page > 500)
    error(400, 'Invalid person or page.');
  const type = url.searchParams.get('type') ?? 'all',
    department = url.searchParams.get('department') ?? 'all',
    scope = url.searchParams.get('scope') ?? 'all';
  if (
    !['all', 'movie', 'show'].includes(type) ||
    !department.trim() ||
    department.length > 80 ||
    !['all', 'library', 'known'].includes(scope)
  )
    error(400, 'Invalid credit filter.');
  return json(
    await personCredits(locals.user!.id, id, {
      page,
      type,
      department,
      scope,
      available: url.searchParams.get('available') === 'true',
    })
  );
};
