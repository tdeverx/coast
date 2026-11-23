# Can Coast distinguish acceptable titles from favourites?

The existing four-star evaluation misses a meaningful failure mode. A binary content model improved movie ordering for four-star-or-higher versus three-star-or-lower titles from 75.96% to 80.03% on the individual-work folds. On those same folds its ability to rank a five-star favourite above a 3½-star movie **fell from 66.67% to 60.76%**. A match percentage should be checked against the full range of opinions.

We fitted a per-medium ordered logistic model of six outcomes, pooling ≤2½ stars and retaining 3, 3½, 4, 4½ and 5 separately. It learns where the viewer’s rating boundaries lie and uses metadata terms repeated in at least two training titles. Each term comes from current catalogue metadata and each training title’s Coast score excludes itself and the complete outer test group. We tested both the model’s estimate of a four-star rating and a correction which adds only its metadata contribution to Coast’s existing log-odds, capped at ±0.55. The table gives results for that bounded correction. Tied integer percentages receive half credit. [Ordinal recommender evaluation, Koren and Sill](https://ijcai.org/proceedings/2013/449) · [Proportional odds, McCullagh](https://www.stat.uchicago.edu/~pmcc/pubs/paper2.pdf)

| Held-out group | ≥4 above ≤3, current → candidate | All unequal ratings in order | 5 above 3½ |
| --- | ---: | ---: | ---: |
| Movie works | 75.96 → 77.11% | 60.61 → 61.39% | 66.67 → 69.07% |
| Movie franchises | 76.54 → 74.47% | 58.42 → 58.82% | 58.96 → 62.77% |
| Movie franchises, second assignment | 76.39 → 69.61% | 57.06 → 55.92% | 58.56 → 58.19% |
| Show works and original franchises | 79.32 → 80.02% | 68.84 → 70.28% | 77.90 → 80.45% |
| Show franchises, second assignment | 79.20 → 79.35% | 67.91 → 68.93% | 78.28 → 80.38% |


Learning separate, partially pooled coefficients for each rating boundary improved show five-versus-3½ ordering to 82.59% on the work folds. The top 20 lost a liked show overall and in Sci-Fi. An all-pairs ranking model and training-fold model selection also failed to improve every guarded outcome. On the original movie work folds the bounded ordinal correction gained 1.14 percentage points in primary ordering, with a paired conditional 95% interval of −4.23 to +6.52. The show gain in five-versus-3½ ordering was 2.55 points, interval −1.41 to +6.50.

## Forecasting genuinely later rating dates

A separate replay used 444 direct movie and 427 direct show ratings whose original timestamps and values matched verified Trakt identities. Each training reference contained strictly earlier direct star ratings and current title metadata. Watches, completion, favourites, drops, repeat events, rating-derived episode credits and audience scores supplied no evidence. All ratings from a UTC day stayed together. Inner training scores held out a hash bucket of those earlier days. Current metadata is a retrospective limitation, and a dated rating can occur after the first viewing.

| Later rating window | Rated titles / UTC days | ≥4 above ≤3, current → candidate | All unequal ratings in order | 5 above 3½ |
| --- | ---: | ---: | ---: | ---: |
| Movies, 2022–23 | 49 / 41 | 76.8 → 71.4% | 62.7 → 63.6% | 66.2 → 72.1% |
| Movies, 2024 onward | 33 / 21 | 93.8 → 91.1% | 64.3 → 69.8% | 43.3 → 70.0% |
| Shows, 2022–23 | 88 / 19 | 71.9 → 74.0% | 63.8 → 64.2% | 68.1 → 68.1% |
| Shows, 2024 onward | 13 / 9 | 75.0 → 85.0% | 60.8 → 60.8% | 25.0 → 25.0% |

Seventy of the 88 early shows were rated on one day, including every show rated three stars or lower in that window. Omitting that day makes the primary comparison impossible, as occurred in 36.4% of UTC-day bootstrap samples. The later show window had one weak rating and two five-star titles. The 95% day-bootstrap intervals for the movie primary-order change were −26.1 to +6.9 and −13.0 to +4.5 points respectively. These results support recording all-star concordance and favourite-versus-acceptable ordering as ongoing measurements. The evidence for adopting this model as a default is mixed, particularly for movies.

Run the private fold generator with the pinned Bun executable, the frozen capture and the verified rating-date array. The third argument creates a new private output file. Run the Python evaluator in an environment with NumPy using the same capture and that file. The evaluator prints aggregate results. Both stages run offline. [Prepare folds](ordinal-inputs.ts) · [Reproduce the primary model](ordinal-replay.py)
