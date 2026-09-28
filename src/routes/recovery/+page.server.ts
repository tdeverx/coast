import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { recoveryLogin, resetAdministratorPassword } from '$lib/server/auth/recovery';
export const actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    try {
      const session = await recoveryLogin(String(form.get('credential') ?? ''), getClientAddress());
      await resetAdministratorPassword(
        session.token,
        String(form.get('username') ?? ''),
        String(form.get('password') ?? '')
      );
      return { success: true };
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : 'Recovery failed.' });
    }
  },
} satisfies Actions;
