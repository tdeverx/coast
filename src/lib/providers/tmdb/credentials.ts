/** TMDB issues 32-character v3 keys and separate API read access tokens. */
export function tmdbCredential(value: unknown) {
  const credential = typeof value === 'string' ? value.trim() : '';
  if (!credential) return {};
  return /^[a-f0-9]{32}$/i.test(credential) ? { apiKey: credential } : { accessToken: credential };
}
