import { AppError } from './errors';

/** SameSite is defence in depth; every state-changing browser request requires its origin. */
export function assertSameOrigin(request: Request, expectedOrigin = new URL(request.url).origin) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get('origin');
  if (
    !origin ||
    origin !== expectedOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new AppError(403, 'This request did not originate from Coast.', 'csrf');
  }
}
