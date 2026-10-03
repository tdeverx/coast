export type ContentDomain = 'tracking' | 'social' | 'planning';
export type ContentRevisionData = {
  [key: string]: unknown;
  user?: { id: string } | null;
  contentRevision?: Partial<Record<ContentDomain, string>> | null;
};

const local = $state<Record<ContentDomain, number>>({ tracking: 0, social: 0, planning: 0 });

/** Explicit refreshes still work when a successful write leaves the server signature unchanged. */
export function invalidateContentRevision(domains: readonly ContentDomain[]) {
  for (const domain of new Set(domains)) local[domain]++;
}

export function readContentRevision(domain: ContentDomain) {
  return local[domain];
}

/** Derive this primitive before subscribing, so session data replacement alone does not refresh content. */
export function contentRevisionKey(data: ContentRevisionData, domains: readonly ContentDomain[]) {
  return JSON.stringify([data.user?.id ?? '', ...domains.map(domain => [domain, data.contentRevision?.[domain] ?? '', local[domain]])]);
}
