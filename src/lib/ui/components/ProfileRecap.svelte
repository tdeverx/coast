<script lang="ts">
  import { periodLabel, type ProfilePeriod } from '$lib/profile/period';
  let {
    subject = 'you',
    movies,
    episodes,
    seasons,
    previousCount,
    period,
  }: {
    subject?: string;
    movies: number;
    episodes: number;
    seasons: number;
    previousCount: number | null;
    period: ProfilePeriod;
  } = $props();
  const count = $derived(movies + episodes);
  const parts = $derived(
    [
      movies ? `${movies} ${movies === 1 ? 'movie' : 'movies'}` : '',
      episodes ? `${episodes} ${episodes === 1 ? 'episode' : 'episodes'}` : '',
    ].filter(Boolean)
  );
  const difference = $derived(previousCount === null ? 0 : count - previousCount);
</script>

{#if count}<div class="recap">
    <p>
      {periodLabel(period)}: {subject} watched {parts.join(' and ')}{seasons
        ? `, finishing ${seasons} ${seasons === 1 ? 'season' : 'seasons'}`
        : ''}.
    </p>
    {#if previousCount !== null && previousCount >= 3 && count >= 3}<span
        >{difference === 0
          ? 'The same number of recorded watches as'
          : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'} recorded watches than`} the
        previous period.</span
      >{/if}
  </div>{/if}

<style>
  .recap {
    margin: 0 0 20px;
    max-width: 760px;
  }
  .recap p {
    font-size: var(--text-sm);
    font-weight: var(--weight-regular);
    line-height: var(--leading-relaxed);
  }
  .recap span {
    display: block;
    font-size: var(--text-sm);
    color: var(--quiet);
    margin-top: 6px;
  }
</style>
