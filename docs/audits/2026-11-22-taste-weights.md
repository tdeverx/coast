# Taste weight calibration

The worker still visits the owner's full eligible history and assigns one work vote to each feature. The median rating for a feature is derived from a bounded quarter-star histogram. A small median component complements the signed mean so repeated opposing opinions still count. The user's supported rating median sets the midpoint, and below-usual ratings have more influence. Explicit ratings take precedence over the same work's viewing evidence. Distinct watches and unusually frequent returns can establish an affinity on unrated titles.

The saved profile keeps up to 512 cast members and 256 entries per other person dimension, ordered for retention by distinct viewing support and signed opinion. One-off people are omitted. The job applies the limits after processing every work. Greater emphasis goes to tags, cast and franchise evidence, with lighter weighting for language, country, studio and decade. A signed curve widens stronger matches and dislikes around 50 while preserving the evidence requirement. Collection breadth adds up to 6.25 points before rounding for distinct watched members when the collection already matches. The existing collection query samples at most 24 titles and counts distinct watched members by the owner's indexed tracking state. The model revision lets the normal worker replace previous snapshots and cached scores.

## Real-data comparison

Read-only extraction from the live account on 22 November 2026 captured 763 movie and 566 show works, including 444 movie and 429 canonical show ratings. The first byte of each work ID's SHA-256 hash modulo five assigned its fold. Each fold omitted the held-out works' ratings and viewing evidence from training. Comparisons use pairs scored by both versions within the same fold. A tie earned half credit. Higher ratings were at least 4.5 stars and lower ratings were at most 3.5. This is a single-account ranking experiment on current catalogue metadata.

| Check | Previous | Revised | Comparable pairs |
| --- | ---: | ---: | ---: |
| Movies, higher ratings rank ahead of lower ratings | 66.47% | 70.31% | 4,232 |
| Shows, higher ratings rank ahead of lower ratings | 70.18% | 73.79% | 4,123 |
| Movies, comparison against ratings of 2.5 stars or less | 61.61% | 72.66% | 267 |
| Shows, comparison against ratings of 2.5 stars or less | 75.97% | 82.43% | 851 |

Full-profile scores provide an illustration of the range. The median for five-star rewatches moved from 69 to 80 for 62 movies and from 67 to 77 for 49 shows. Unrated held-out repeat play ranked ahead of one-time watches in 67.7% of movie comparisons, up from 65.2%, and 66.1% of show comparisons, down from 66.5%. The game corpus contained 204 works and zero explicit ratings. Longer-playtime comparisons remained at 65.4% on 729 comparable pairs. Music and comics had too little activity to establish ranking changes. The experiment provides no likelihood-of-liking calibration across users.

## Resource and regression checks

An offline Bun 1.4.4 canary Apple Silicon run used 10 warm-ups and 32 alternating trials on the same feature rows. Profile and reference sizes are uncompressed JSON. The CPU measurements use memory-resident catalogue metadata and exclude database queries, network, routing and rendering.

| Medium | Profile and reference bytes before | Profile and reference bytes after | Prepare median before → after | Score 72 median before → after |
| --- | ---: | ---: | ---: | ---: |
| Movies | 1,022,639 + 337,151 | 396,820 + 226,608 | 6.941 → 8.105 ms | 0.291 → 0.363 ms |
| Shows | 675,279 + 195,151 | 219,922 + 113,873 | 4.277 → 4.999 ms | 0.251 → 0.293 ms |
| Games | 93,862 + 46,998 | 93,498 + 46,988 | 0.551 → 0.575 ms | 0.389 → 0.684 ms |

Unit and disposable PostgreSQL checks cover median versus contrasting opinions, retention of well-supported people, inference from unrated viewing, ratings precedence, prepared-cache equality, authorization, show history, and bounded collection sampling with a collection of partly watched titles. The worker and API continue using the same batched local metadata. Live scores were only read during this review.
