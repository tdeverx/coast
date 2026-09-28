import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { AppError } from '../security/errors';

/** Public profile reads require a signed-in viewer at the route/API boundary. */
export async function profileUser(username: string) {
  const [user] = await getDb()
    .select({ id: users.id, username: users.username, settings: users.settings })
    .from(users)
    .where(
      and(sql`lower(${users.username}) = ${username.toLowerCase()}`, eq(users.disabled, false))
    );
  if (!user) throw new AppError(404, 'Profile not found.');
  return user;
}
