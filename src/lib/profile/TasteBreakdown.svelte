<script lang="ts">
  import type { CollectionTasteBreakdown } from '#lib/social/collection-taste.server.js';

  let { breakdown, score, watchedLabel }: {
    breakdown: CollectionTasteBreakdown;
    score: number | null;
    watchedLabel?: string;
  } = $props();

  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const points = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))} pts`;
</script>

  <section class="breakdown" aria-label="Collection calculation">
    <h3>Score calculation</h3>
    <dl class="calculation">
      <div><dt>Average of scored titles</dt><dd>{breakdown.average === null ? '—' : `${number.format(breakdown.average)}%`}</dd></div>
      {#if watchedLabel}
        <div><dt>{watchedLabel}</dt><dd>{breakdown.watched}</dd></div>
        <div><dt>Collection viewing bonus</dt><dd>{points(breakdown.bonus)}</dd></div>
      {/if}
      <div class="total"><dt>Final match</dt><dd>{score === null ? 'Insufficient evidence' : `${score}%`}</dd></div>
    </dl>
  </section>
  <section class="breakdown" aria-label="Sampled titles">
    <h3>Sampled titles</h3>
    <table>
      <thead><tr><th scope="col">Title</th><th scope="col">Fit</th><th scope="col">Evidence</th></tr></thead>
      <tbody>
        {#each breakdown.titles as title (title.id)}
          <tr>
            <th scope="row">{title.title}</th>
            <td>{title.score === null ? 'No match' : `${title.score}%`}</td>
            <td>{title.confidence === null ? '—' : `${title.confidence}%`}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

<style>
  .breakdown { margin-block-start: 24px; }
  h3 { margin: 0 0 8px; font-size: var(--text-md); }
  dl { padding: 0; margin: 0; }
  .calculation > div {
    padding-block: 8px;
    border-block-end: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
  }
  .calculation > div { display: flex; justify-content: space-between; gap: 16px; }
  dd { margin: 0; text-align: end; }
  .total { font-weight: var(--weight-semibold); }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 8px; text-align: end; border-block-end: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
  th:first-child { text-align: start; padding-inline-start: 0; overflow-wrap: anywhere; }
  th[scope='row'] { font-weight: var(--weight-regular); }
  td { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
