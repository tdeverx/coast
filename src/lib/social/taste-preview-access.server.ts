// The experiment can only be mounted on a loopback database explicitly named by its operator.
export function tastePreviewUser(userId: string | null | undefined) {
  if (!userId || userId !== process.env.COAST_TASTE_PREVIEW_USER) return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname.slice(1) === process.env.COAST_TASTE_PREVIEW_DATABASE
      && !!process.env.COAST_TASTE_PREVIEW_DATABASE;
  } catch {
    return false;
  }
}
