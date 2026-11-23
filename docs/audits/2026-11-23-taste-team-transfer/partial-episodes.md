# Does a returning member of a show's writing staff transfer a personal dislike?

This sensitivity study was specified after measuring series-level credit coverage and before inspecting episode-writer matches or predictions. A series-level creator and a person who wrote one guest episode are different types of evidence.

Count stable Writer, Screenplay, Teleplay or Head Writer IDs on distinct non-special episodes in the copied database. Require at least three aired episodes written by the person on both series. The main test additionally requires at least 10% of the show's known aired episodes to be credited to that writer; use all aired regular episodes as the denominator to avoid promoting a guest because few episodes have metadata. Report the three-episodes-only comparison separately. A third diagnostic requires at least two previously disliked independent donor franchises. Missing dates and episodes aired after the rating-day cutoff do not supply evidence. On dated tests compare reconstructed airing dates with the stricter requirement that Coast had already saved each writer credit by that date. The structural cohorts use the dataset's original capture date.

Require both series to have known, disjoint lead teams plus the existing one-half genre overlap; exclude the target's own franchise, co-held ratings and future ratings. For each recurring writer, every permitted rating on other shows where they recur must be 2½ stars or lower. A liked or middling example vetoes that writer. Use only the owner's direct series ratings. Reuse the frozen independent series-score residual for each admissible donor, averaging once per franchise. No episode ratings, watches, popularity, other users or audience scores enter. Keep the four previously identified dislikes separate and report any new false reds, reductions of liked works or lost green favourites on all 16 show panels. There is no comparable movie episode unit.

## Results

The isolated copy contained 32,112 episodes attached to the 429 rated shows. At least one stable TMDB writing credit was saved on 2,400 episodes across 76 shows, including specials. Restricting to regular episodes left 27,978 entries, of which 2,394 had writers. The earliest retained regular-episode writer observation was 21 November 2026. The latest was 22 November; the last verified personal rating was 7 November.

| Whole-title results | Three episodes and ≥10% | Three episodes only |
| --- | ---: | ---: |
| Shows with a recurring writer | 46 | 52 |
| Disliked shows with a recurring writer | 4 | 4 |
| Titles with a rated independent comparison satisfying all credit and genre rules | 3 | 3 |
| Dislikes with such a comparison | 0 | 0 |
| Changed personal scores | 0 | 0 |

The three matches were all rated four or 4½ stars, on both sides of the comparison. No penalty was justified. Looking at airing dates alone produced just one opportunity on the dated panel. Requiring the writer credit to have been saved in Coast before the target's rating date left zero series with qualifying staff on that panel. Every score was unchanged in every condition across all 16 show panels. This account cannot demonstrate whether a recurring writer predicts dislikes using these credits.

[Read-only coverage and extraction](partial-episode-coverage.ts) · [Replay](partial-episodes.py) · [Aggregate results](partial-episode-results.json)

```sh
bun --env-file="$private_dev_env" partial-episode-coverage.ts "$graded" "$private_episode_credits"
python3 -B partial-episodes.py "$solo_capture" "$metadata" "$verified_dates" "$graded" "$lineage_inner" "$private_episode_credits"
```
