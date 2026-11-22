# Taste rating clarity and negative evidence

Below-median ratings are adjusted with a small curve before the existing affinity aggregation. The medium midpoint still yields zero and the strongest negative vote remains capped at minus one. The curve gives a clear below-usual rating more influence than a marginal one. The positive side retains its scale. Explanations can reserve one of the three slots for a well-supported opposing signal when the strongest reasons all point in the same direction. The cutoff requires at least three titles and one third of the leading reason's strength, with an absolute evidence floor.

The dialog displays the viewer's saved title rating from the existing media data alongside its calculated fit. Explicit ratings remain distinct from the prediction. Collection comparisons use their existing member evidence. The change introduces no per-card request, response field, or profile storage. A new score revision rebuilds the cached score and explanation through the existing job.

## Held-out comparison

A read-only live extraction included 444 film and 429 canonical show ratings. The experiments shared work folds between alternatives and withheld the target title's evidence. Rated works of 4.5 stars or higher were matched against works of 3.5 stars or lower in each fold. The low-rating means in the table track 2.5 stars or lower. The later-watch cohort uses first and last known watch dates as a proxy because Coast saved the imported ratings on a single day.

| Comparison | Higher ratings win before → after | Mean score for low ratings before → after |
| --- | ---: | ---: |
| Movies, random split one | 70.4 → 70.6% | 63.1 → 62.3 |
| Movies, random split two | 71.5 → 71.7% | 64.4 → 63.6 |
| Movies, unfamiliar franchises | 66.7 → 67.4% | 63.4 → 62.9 |
| Movies, later first watches | 73.8 → 73.1% | 62.6 → 61.8 |
| Shows, random split one | 74.4 → 74.6% | 52.6 → 50.8 |
| Shows, random split two | 74.3 → 74.6% | 52.6 → 50.9 |
| Shows, later first watches | 64.7 → 64.4% | 49.8 → 48.2 |

Only seven films and 33 shows were rated 2.5 stars or lower in each random split. The mean score for higher-rated titles fell by roughly 0.4 points for films and one point for shows in those splits. A blanket strongest-negative penalty rarely fired, while boosting both positive and negative peaks increased the number of poorly rated shows scoring 65 or above. Mixing in a fixed absolute midpoint raised scores for both groups. The smaller curve gave a preferable tradeoff in these trials. These are descriptive results for one viewer with current metadata. The later-watch rankings remain mixed.

## Resource and integration checks

CPU-only measurements used prepared in-memory references and 72 local catalogue items per batch, with ten warm-ups and 32 alternating samples. Movie median/p95 moved from 0.721/0.792 to 0.842/1.044 ms. Show median/p95 moved from 0.690/0.799 to 0.702/1.033 ms. Requests, metadata I/O and rendering are outside these timings. The tests cover neutral and low ratings, reason diversity, the personal rating in the rating dialog state, cached and recalculated equality, collection sampling and history retention. Browser appearance was outside this check.
