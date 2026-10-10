/** Shared relevance for bounded search results. Provider order breaks equal-score ties. */
export function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchWords(value: string) {
  return [...new Set(normalizeSearch(value).split(' ').filter(Boolean))].slice(0, 16);
}

/** At most one broader provider query, only after a successful empty response. */
export function searchFallback(value: string) {
  const normalized = normalizeSearch(value);
  if (normalized !== value.trim().toLowerCase()) return normalized;
  const word = searchWords(value).filter(term => term.length >= 4).sort((a, b) => b.length - a.length)[0];
  return word?.slice(0, 3) ?? '';
}

// Only short, bounded tokens reach this check. One typo includes a transposition.
function nearWord(a: string, b: string) {
  if (a.length < 4 || b.length < 4 || a.length > 64 || b.length > 64 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const differences: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences.push(i);
    return differences.length <= 1 || differences.length === 2 && differences[1] === differences[0] + 1 &&
      a[differences[0]] === b[differences[1]] && a[differences[1]] === b[differences[0]];
  }
  const shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
  let i = 0, j = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; }
    else if (i === j) j++;
    else return false;
  }
  return true;
}

function fieldScore(query: string, terms: string[], value: string) {
  const text = normalizeSearch(value);
  if (!text) return 0;
  if (text === query) return 1000;
  if (text.startsWith(query + ' ')) return 900;
  if (text.includes(query)) return 800;
  const words = text.split(' ').slice(0, 100);
  if (terms.every(term => words.includes(term))) return 700 + 20 * terms.length / words.length;
  if (terms.every(term => words.some(word => word.startsWith(term)))) return 650;
  if (terms.every(term => words.some(word => word === term || nearWord(term, word)))) return 550;
  const matched = terms.filter(term => words.some(word => word.startsWith(term))).length;
  return matched ? 100 + 100 * matched / terms.length : 0;
}

export type SearchLabels = { title: string; originalTitle?: string | null; captionTitle?: string; captionSubtitle?: string; seriesTitle?: string | null; authors?: string[] };
export function searchScore(query: string, item: SearchLabels) {
  const normalized = normalizeSearch(query), terms = searchWords(query);
  if (!terms.length) return 0;
  const primary = [item.title, item.originalTitle, item.captionTitle].filter((text): text is string => !!text);
  const secondary = [item.seriesTitle, item.captionSubtitle, ...(item.authors ?? [])].filter((text): text is string => !!text);
  return Math.max(0, ...primary.map(text => fieldScore(normalized, terms, text)),
    ...secondary.map(text => fieldScore(normalized, terms, text) * 0.85));
}

export function rankSearch<T extends SearchLabels>(items: readonly T[], query: string): T[] {
  return items.map((item, index) => ({ item, index, score: searchScore(query, item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(({ item }) => item);
}
