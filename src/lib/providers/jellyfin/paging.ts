/** GUID formatting varies between Jellyfin endpoints. */
export function jellyfinItemKey(id: string) {
  return id.replaceAll('-', '').toLowerCase();
}

/** Reject incoherent pages before a traversal can publish negative coverage. */
export function validateJellyfinPage(
  page: { Items: { Id: string }[]; TotalRecordCount: number; StartIndex?: number },
  offset: number,
  limit: number,
  kind: 'library' | 'music'
) {
  if (!Number.isSafeInteger(page.TotalRecordCount) || page.TotalRecordCount < 0 ||
      page.StartIndex !== undefined && (!Number.isSafeInteger(page.StartIndex) || page.StartIndex !== offset))
    throw new Error(`Jellyfin returned an unexpected ${kind} page offset or total.`);
  if (page.Items.length > limit || page.Items.length > 0 && offset + page.Items.length > page.TotalRecordCount)
    throw new Error(`Jellyfin returned an inconsistent ${kind} page total.`);
  const ids = page.Items.map(item => jellyfinItemKey(item.Id));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length)
    throw new Error(`Jellyfin returned duplicate or empty ${kind} item identities.`);
  if (!page.Items.length && offset < page.TotalRecordCount)
    throw new Error(`Jellyfin returned an incomplete ${kind} page.`);
}

/** An ID query may omit removed/inaccessible items, but never return unrelated ones. */
export function validateJellyfinItems(items: { Id: string }[], requested: string[]) {
  const expected = new Set(requested.map(jellyfinItemKey));
  const returned = items.map(item => jellyfinItemKey(item.Id));
  if (returned.some(id => !expected.has(id)) || new Set(returned).size !== returned.length)
    throw new Error('Jellyfin returned unexpected item identities.');
}
