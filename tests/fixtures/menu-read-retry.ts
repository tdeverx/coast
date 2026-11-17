import { eraseTypeScript, moduleUrl } from './ui-script';

const client = moduleUrl('export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }');
const source = await Bun.file(new URL('../../src/lib/ui/controls/menu-read-retry.ts', import.meta.url)).text();
export const menuReadRetryUrl = moduleUrl(eraseTypeScript(source).replaceAll("'../client'", JSON.stringify(client)));
export const { ApiError }: Pick<typeof import('../../src/lib/ui/client'), 'ApiError'> = await import(client);
export const { retryMenuRead }: typeof import('../../src/lib/ui/controls/menu-read-retry') = await import(menuReadRetryUrl);
