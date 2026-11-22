# Taste comparisons and calibration trials

The existing full-history affinity score remains the basis of each match. The refresh job also fits regularized weights across a medium's rated works. The fit estimates genres, topics, people and franchises together with genre–genre and genre–topic combinations. This lets a repeated combination count where its individual features are equally common in favourites and dislikes. Training requires at least 40 rated titles with evidence on both sides of the viewer's median. A feature needs three rated titles and a combination needs five. Only 512 coefficients reach the private scoring reference. There are no rated item IDs in that reference.

The added comparison moves an eligible score by at most eight points in either direction. The earlier evidence gate still determines whether there is a score. The score dialog shows the strength of that evidence separately, and the admin action shows the signed ratings adjustment. Warm results preserve the same breakdown as the on-demand path. Cold matches use the existing batched local metadata. The incremented model revision rebuilds the reference through the existing worker.

## Real-data trials

The read-only 22 November extraction contained 444 film and 429 canonical show ratings for one viewer. We compared the preceding local full-history scorer with the candidate on the same titles. Each candidate was evaluated without seeing the held-out work's ratings or viewing signals. Random folds used five partition buckets. Franchise folds grouped known franchise relationships and shared franchise metadata before splitting. The show set supplied no usable franchise differences from the ordinary folds. The second split used a different hash salt and different date cutoffs.

The later-watch comparison trains on works whose last recorded watch precedes the cutoff and tests ratings on works first watched after it. All 918 imported Trakt rating rows share one save date in Coast. The watch chronology therefore serves as a proxy, and this comparison does not establish the date each rating was given. It also uses current metadata and a single account. Higher ratings were at least 4.5 stars and lower ratings were at most 3.5. Ties earned half credit.

| Comparison | Split one before → after | Split two before → after |
| --- | ---: | ---: |
| Movies, random works | 70.3 → 70.4% | 69.7 → 69.6% |
| Movies, unfamiliar franchises | 65.9 → 66.7% | 64.1 → 64.6% |
| Movies, later first watches | 71.0 → 70.8% | 73.9 → 74.2% |
| Shows, random works | 74.2 → 74.4% | 75.3 → 75.8% |
| Shows, later first watches | 64.6 → 66.2% | 64.7 → 64.6% |

The stronger negative comparison used ratings of 2.5 stars or less. Movie results on random works moved from 72.7 to 74.2% on 267 pairs and from 72.2 to 69.8% on 263 pairs. Show results moved from 83.7 to 84.2% on 915 pairs and from 82.4 to 84.2% on 928 pairs. These mixed results support keeping the learned adjustment small. There were insufficient explicit ratings for an equivalent game or reading evaluation.

Genre and topic adjustments calculated in isolation, comparisons against 24 or 48 saved similar titles, and comparisons against all previously rated titles were rejected for the headline score. Some improved random film comparisons and all reduced the first later-watch film result. Catalogue frequency estimated from 400 random controls per medium helped the first later-watch film comparison and reduced the corresponding show result. The regularized comparison produced steadier results. No catalogue-wide or per-card history scan was added.

## Scaling and verification

With ten warm-ups and 32 alternating iterations on Bun 1.4.4 canary, the median CPU time for 72 locally hydrated movies moved from 0.56 to 1.17 ms. Shows moved from 0.51 to 1.13 ms. The compact rating coefficients added 14,423 and 17,384 uncompressed JSON bytes to those prepared references. Median training time was 8.8 ms for movies and 5.4 ms for shows on this machine, excluding the existing history and metadata reads. Known candidates can still use their saved scores. A stress run replaying real feature rows into 25,000 observations collected the rows in 321 ms and fitted them in 201 ms. Large fits regularly yield between passes, and temporary observations store numeric term IDs rather than repeated feature names. This is a CPU stress check rather than a production capacity estimate.

The application tests cover neutral and unknown matches, sparse profiles, opposing genre–topic combinations, bounded adjustments, independent evidence strength, and publication of the fitted coefficients in the prepared reference. PostgreSQL exercises cached and recalculated equality with the comparison present. Browser appearance and true prospective ratings remain outside this verification.
