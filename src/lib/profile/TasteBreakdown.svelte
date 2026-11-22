<script lang="ts">
  import type { TasteMedium, TasteScoreBreakdown } from '#lib/social/taste-profile.js';
  import type { CollectionTasteBreakdown } from '#lib/social/collection-taste.server.js';
  import { tasteSignalLabel } from '#lib/social/taste.js';

  let { breakdown, score, medium, watchedLabel }: {
    breakdown: TasteScoreBreakdown | CollectionTasteBreakdown;
    score: number | null;
    medium?: TasteMedium;
    watchedLabel?: string;
  } = $props();

  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const percent = (value: number) => `${number.format(value * 100)}%`;
  const points = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))} pts`;
  const direction = { positive: 'Supports match', negative: 'Lowers match', mixed: 'Mixed feedback' };
  const friendActivity = $derived(medium==='music'?'listened':medium==='game'?'played':medium==='book'||medium==='comic'?'read':'watched');
</script>

{#if 'signals' in breakdown}
  <section class="breakdown" aria-label="Score calculation">
    <h3>Score calculation</h3>
    {#if breakdown.calculation}
      {@const calculation = breakdown.calculation}
      <dl class="calculation">
        <div><dt>Neutral starting point</dt><dd>50%</dd></div>
        <div><dt>Weighted signal fit</dt><dd>{points(calculation.rawScore - 50)}</dd></div>
        <div><dt>Evidence adjustment <small>{percent(calculation.retained)} of the signal retained</small></dt>
          <dd>{points(calculation.baseScore - calculation.rawScore)}</dd></div>
        <div><dt>Learned adjustment</dt><dd>{points(calculation.ratingAdjustment)}</dd></div>
        {#if breakdown.friends}
          {@const friends = breakdown.friends}
          <div><dt>Friends with similar taste <small>{friends.watched} {friendActivity} · {friends.rated} rated</small></dt><dd>{points(friends.points)}</dd></div>
        {/if}
        <div class="total"><dt>Final match</dt><dd>{score}%</dd></div>
      </dl>
      {#if calculation.ratingTerms.length}
        <details>
          <summary>Learned adjustment inputs</summary>
          <p class="note">Strongest inputs before rounding and score limits.</p>
          <ul>
            {#each calculation.ratingTerms as term}<li><span>{term.name}</span><span>{points(term.points)}</span></li>{/each}
          </ul>
        </details>
      {/if}
    {:else if breakdown.withheld === 'context' && breakdown.signals.length}
      <p>The matching signals only provide broad context.</p>
    {:else if breakdown.signals.length}
      <p>The matched signals have too little combined support to score this title.</p>
    {:else}
      <p>No comparable features matched your history.</p>
    {/if}
    {#if breakdown.signals.length}
      <p class="note">
        <span>Coverage factor {percent(breakdown.coverage)}</span>
        <span>Weighted support {number.format(breakdown.support)}</span>
        {#if breakdown.calculation}<span>Up to {breakdown.calculation.explicit} explicit ratings or endorsements per feature</span>{/if}
      </p>
    {/if}
  </section>
  {#if breakdown.signals.length}
    <section class="breakdown" aria-label="Signal breakdown">
      <h3>Signal breakdown</h3>
      {#each breakdown.signals as signal, index (signal.dimension)}
        <details open={index === 0}>
          <summary>
            <span class="signal-heading">
              <span>{tasteSignalLabel(signal.dimension,medium)}{#if signal.context}<small> · Context</small>{/if}</span>
              <span class="signal-numbers">{signal.fit}% fit · {percent(signal.weightShare)} weight</span>
            </span>
          </summary>
          <p class="note">{signal.matched} of {signal.compared} features matched{#if signal.matched > signal.evidence.length} · Top {signal.evidence.length} shown{/if}</p>
          <ul>
            {#each signal.evidence as evidence}
              <li>
                <span>{evidence.name}<small>{direction[evidence.direction]} · {evidence.samples} {evidence.samples === 1 ? 'title' : 'titles'} · {evidence.explicit} rated or endorsed</small></span>
                <span class="signal-numbers">{evidence.affinity}% affinity<small>{percent(evidence.support)} support</small></span>
              </li>
            {/each}
          </ul>
        </details>
      {/each}
    </section>
  {/if}
{:else}
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
{/if}

<style>
  .breakdown { margin-block-start: 24px; }
  h3 { margin: 0 0 8px; font-size: var(--text-md); }
  dl, ul { padding: 0; margin: 0; }
  .calculation > div, li, summary {
    padding-block: 8px;
    border-block-end: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
  }
  .calculation > div, li { display: flex; justify-content: space-between; gap: 16px; }
  dd { margin: 0; text-align: end; }
  .total { font-weight: var(--weight-semibold); }
  .note, small { color: var(--muted); font-size: var(--text-sm); }
  small { display: block; }
  .note { margin: 8px 0; }
  .note span + span::before { content: ' · '; }
  summary { cursor: pointer; overflow-wrap: anywhere; }
  summary small { display: inline; }
  .signal-heading { display: inline-flex; width: calc(100% - 1.4em); flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
  ul { list-style: none; padding-inline-start: 16px; }
  .signal-numbers { text-align: end; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 8px; text-align: end; border-block-end: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
  th:first-child { text-align: start; padding-inline-start: 0; overflow-wrap: anywhere; }
  th[scope='row'] { font-weight: var(--weight-regular); }
  td { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
