import { shareCookie, sharedState } from '$lib/sharing/service.server';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ cookies, setHeaders }) => {
 setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' });
 try { return { shared: await sharedState(cookies.get(shareCookie)) }; } catch { return { shared: null }; }
};
