# Cost of showing a taste percentage on media cards

On a local copy of Coast with one active request, a single parallel taste lookup added a paired median of **0.83 ms for 72 cards** when every score was cached, **3.41 ms** when half were cached, and **7.97 ms** when every score had to be calculated. The corresponding changes for 24 cards were +0.19, +2.27 and +7.05 ms.

## Results

Each pair gives the median and 95th percentile of server-side card loading in milliseconds. The delta is the median difference against the card-only baseline within the same trial cycle.

| Score cache | Execution | 24 cards, median / p95 | 24-card delta | 72 cards, median / p95 | 72-card delta |
| --- | --- | ---: | ---: | ---: | ---: |
| Cards only | Baseline | 9.06 / 19.60 | — | 22.20 / 45.26 | — |
| All hits | Sequential | 12.27 / 22.09 | +2.70 | 27.55 / 59.35 | +4.74 |
| All hits | Parallel | 9.57 / 22.96 | +0.19 | 26.20 / 37.51 | +0.83 |
| Half hits | Sequential | 19.78 / 28.03 | +9.45 | 38.74 / 54.54 | +14.92 |
| Half hits | Parallel | 12.50 / 23.77 | +2.27 | 27.60 / 42.17 | +3.41 |
| All misses | Sequential | 21.87 / 32.53 | +11.64 | 46.77 / 98.67 | +20.32 |
| All misses | Parallel | 16.74 / 28.64 | +7.05 | 34.84 / 79.60 | +7.97 |

Adding the percentage as one numeric `tasteScore` field cost **16 uncompressed JSON bytes per card** in this sample. The 24-card response grew from 38,137 to 38,521 bytes, and the 72-card response from 121,160 to 122,312 bytes. All 72 cards had a score. Every execution order and cache condition returned the same card order and percentages.

## Method and scope

The benchmark used a disposable production database copy, PostgreSQL 17.11, Bun 1.4.4-canary.1 (963452075) and the rebuilt lifetime profiles for `VIEWER_NAME`. It deterministically interleaved 36 movie and 36 show IDs that already had published scores. The 24-card batch was the first third of the 72-card batch. The stored scoring references occupied 132,548 bytes for movies and 65,158 bytes for shows.

Each trial ran Coast's `workCards` projection in a fresh request context. Scored trials ran exactly one `titleTastes` batch on the same IDs, sequentially or in parallel with card loading. Timing ended after JSON serialization. All seven variants ran in rotating, alternating order for three warm-up cycles and 21 measured cycles per batch size. To simulate score misses, the script temporarily changed the selected score revisions in the copy before timing. This exercises the normal production lookup and on-demand calculation using the same titles and profiles. It restored all selected revisions afterward.

This measures one local request with warm PostgreSQL buffers. It excludes network transfer, browser rendering, other concurrent users, and recommendation candidate retrieval. For a card rollout, these figures support one parallel batch per page of visible cards. The remaining performance check is concurrent load, particularly for 72 uncached titles, where parallel p95 rose from 45.26 to 79.60 ms. Two earlier runs on the same cohort before the final profile rebuild measured 20.91 to 33.95 ms and 32.35 to 48.83 ms. Across all three runs a fully cached 72-card batch added under 1 ms at the paired median, while a fully uncached batch added 4.51–8.03 ms and had a longer tail.

To reproduce, restore a disposable local database named `taste_card_benchmark`, migrate it, refresh the target account's taste profile and stop its workers. Set `DATABASE_URL` to that database and run `bun scripts/taste-card-benchmark.ts VIEWER_NAME 21`. The script prints aggregate timings, response sizes and sample fingerprints. [Benchmark source](../../scripts/taste-card-benchmark.ts)
