import type { SessionUser } from '$lib/server/auth';
import * as v from 'valibot';
export const uuid = (value: unknown) => v.parse(v.pipe(v.string(), v.uuid()), value);
export const text = (value: unknown) => v.parse(v.pipe(v.string(), v.maxLength(1000)), value);
export type ApiContext = { user: SessionUser; uid: string; subjectId: string; path: string[]; method: string; request: Request; url: URL; locals: App.Locals; body: Record<string,unknown> };
