export const profilePath = (username: string) => '/profile/' + encodeURIComponent(username);
export const profileListsPath = (username: string) => profilePath(username) + '?section=lists';
export const profileTastePath = (username: string) => profilePath(username) + '?section=taste';

export function profileRowPath(username: string, section: 'list' | 'progress', filters: URLSearchParams) {
  const params = new URLSearchParams({ section });
  for (const [key, value] of filters) params.set(key, value);
  return `${profilePath(username)}?${params}`;
}
