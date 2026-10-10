import { or, sql, type SQL } from 'drizzle-orm';
import { normalizeSearch, searchWords } from '$lib/search';

/** Expression matches the GIN indexes in 0049; no catalogue-wide JS scoring. */
export function searchDocument(title: SQL, extra = sql`null`, labels = sql`'{}'::text[]`) {
  return sql`coast_search_document(${title},${extra},${labels})`;
}

export function searchSql(query: string, documents: SQL[], titles: SQL[]) {
  const terms = searchWords(query);
  const exact = terms.map(term => `${term}:*`).join(' & ');
  // A second, bounded candidate read is used only when the full query found nothing.
  const fallback = [...new Set(terms.filter(term => term.length >= 4).map(term => `${term.slice(0, 3)}:*`))].join(' | ');
  const matches = (text: string) => text ? or(...documents.map(document => sql`${document} @@ to_tsquery('simple',${text})`))! : sql`false`;
  const normalized = normalizeSearch(query);
  const titleRanks = titles.map(title => sql`case when coast_search_text(${title})=${normalized} then 3
    when coast_search_text(${title}) like ${normalized.replace(/[\\%_]/g, '\\$&') + '%'} then 2 else 0 end`);
  return {
    matches: matches(exact), fallback: matches(fallback),
    rank: sql`greatest(${sql.join([...titleRanks, ...documents.map(document => exact
      ? sql`ts_rank(${document},to_tsquery('simple',${exact}),2)` : sql`0`)], sql`,`)})`,
  };
}
