# Independent personal taste model on the copied Coast account

The acceptance question is whether a viewer's other movies or shows predict their opinion about one hidden title. The card percentage measures personal fit. It has no interpretation as a probability of a four-star rating. The incumbent stays active while the candidate is tested privately.

## Registered comparison

The solo capture contains 765 movie and 566 show history roots, 4,892 movie and 3,558 show catalogue roots, and 444/429 rated roots. The host's pinned Bun reproduced all 14 incumbent explicit/sparse/implicit control receipts byte for byte. The matched five-fold incumbent ordered four-star-or-higher above three-star-or-lower works 75.93% of the time for films and 79.29% for shows. With all training stars hidden it achieved 64.73% and 66.79%. Neither arm uses peer or provider opinions.

| Private input or control | SHA-256 |
| --- | --- |
| Canonical capture | `e20d6e15d9836d8c92337730b65d5d94060f98a188404f5040bb5b60debeb162` |
| Verified direct rating dates | `b172790afe289f15274bb4a5493da10afc420af0bb91735e0703f2915a018d45` |
| Incumbent rerun output | `2c37973fdec5a50b1c0e485bf8e32a2b17cab3b71c444389a83cb00a21d2cb1a` |

Freeze the methods and report all paired comparisons. The primary metric is concordance across unequal star ratings, using half credit for a tie. The protected comparisons measure four-or-higher versus three-or-lower, five stars versus three-and-a-half, and coverage. A two-point loss on a protected comparison requires keeping that cohort experimental. Show how many weak titles and favourites clear 80, and which genres gained or lost in the top twenty. One profile and reused development folds cannot justify a default for everyone.

The replay covers canonical works, two franchise assignments, actions only, 2/10/50 retained ratings under three paired seeds, and all ratings. The rolling-day arm uses earlier verified direct stars alone and keeps bulk imports together. Every target's own actions, child feedback and rating are excluded. Modern metadata remains a retrospective approximation. The current permitted catalogue can inform familiarity in work/franchise arms. Chronological fitting excludes contemporary opportunity counts because historical catalogue membership is unknown. Pairwise metrics compare titles within each fold or forecast day. Small same-day samples can carry wide uncertainty. Block resampling uses franchise (work tests) or rating day, conditions on fitted out-of-fold predictions, and reports the number of viable replicates. The top-twenty measure awards fractional credit where ties cross the boundary.

The pure-model benchmark measures full-profile fitting, fresh-unknown prediction, cold exact known-title exclusion, and an in-process cache-hit lower bound. App request, browser and database benchmarks have different boundaries.

## What changed in the personal model

Blindly averaging ordinary completion evidence produced 48.67% movie and 37.46% show liked-versus-weak ordering. In this account 687 film roots had the same ordinary completion pattern, with only two roots marked repeated. Counting so many essentially identical votes gives little information about enjoyment. Positive film familiarity and retaining the tested show viewing component restored much of the useful no-star ranking. The opportunity experiment used permitted descriptive metadata from 4,770 films and 3,568 shows, independent of the viewer's tracked IDs (digest `54a9f5131b7a59423cbb73a14f89ae81dfdd939ef323d975ab102a5e22efc921`).

A conservative gradient line search corrected overshooting when the ordinal model used many correlated metadata fields. A second contrast head ignored middling star ratings while learning four-plus versus weak: it still lost over six points on the alternate film franchise test. Large learned combination offsets also regressed. The candidate keeps individual exception evidence and uses the learned ordinal result together with the signed attribute portion of the previously working profile. The latter excludes audience and friend adjustments and the incumbent's viewing-choice penalties. The weight of the ordinal component increases with explicit rating count. The profile preserves verified show creators and prunes incidental one-off cast, composer and cinematography entries in sufficiently large histories. Only substantive shared metadata can qualify a work for a score.

### Grading the independent profile before display calibration

Concordance columns below are personal predictions on paired targets. Each triple is all unequal ratings / four-or-higher versus three-or-lower / five versus 3½, in percent.

| Medium and dense split | Incumbent | Rebuilt profile |
| --- | --- | --- |
| Movie work | 60.82 / 75.93 / 67.24 | 61.69 / 78.61 / 68.62 |
| Movie franchise | 58.57 / 76.63 / 59.53 | 59.47 / 80.34 / 63.87 |
| Movie alternate franchise | 57.13 / 76.73 / 58.43 | 57.87 / 78.42 / 59.89 |
| Movie rating day | 52.38 / 66.51 / 55.42 | 55.06 / 85.32 / 57.50 |
| Show work and original franchise assignment | 68.82 / 79.29 / 77.90 | 69.97 / 79.47 / 79.74 |
| Show alternate franchise | 67.88 / 79.22 / 78.28 | 70.03 / 80.77 / 83.06 |
| Show rating day | 60.96 / 65.44 / 69.78 | 60.47 / 68.03 / 65.93 |

The two standard show splits have the same effective grouping in this capture. In 400 paired conditional bootstrap draws, the all-star movie work change ranged from −0.57 to +2.32 points (95% interval), and the show work change from −0.57 to +2.55. The alternate show franchise assignment gave +0.53 to +3.65. Consequently these are one-person development estimates. The last show row fails the registered two-point favourite guard. Most comparable weekly pairs came from bulk opinion entries; the full capture contains 194 later film titles and 188 later shows.

For the Ghibli diagnostic the incumbent's four medians on the same 83 unfamiliar anime anchors were 82/82/31/83 (neither trait, studio alone, anime alone, both). The rebuilt profile produced 82/82/83/83. Only three rated works in the history had these traits and all three were Ghibli anime. There is no observed comparison set of other rated anime for learning a strong general dislike. Across 1,540 HBO/drama anchors the corresponding rebuilt medians were 80/81/83/84. These are counterfactual sensitivity checks, not outcomes or verified causal explanations.


### Runtime and genuine future evidence

On the copied profile, 72 fresh unseen titles took a median 2.27 ms for films and 2.63 ms for shows in memory with loaded features. Exact independent refits for 72 known roots took 12.21 seconds and 7.06 seconds respectively in one pass amid concurrent research. A warmed result lookup is orders of magnitude cheaper. These timings exclude DB reads, serialization and browser rendering. Exact root omission belongs in the background worker.

An immutable, private paired forecast for the raw evidence-guarded profile was sealed at 2026-11-23 01:25 UTC, with digest `4a0eaff599795aa855905c9bf10f3321601d9ece9888e43d0868a920b969d0c4`. It records both methods for 7,356 unfamiliar titles. The candidate offered a score for 4,195 films and 3,117 shows; the incumbent offered 4,190 films and 3,094 shows. There were zero eligible later opinions when checked. Subsequent display-policy forecasts require their own sealed projections.

## Final display policy

The final private film and show previews both apply a single monotone projection of raw fit. Coast learns it from the viewer's out-of-fold personal ratings. The target utilities anchor ½ star at 0, three at 50, four at 80 and five at 100. There is no percentile reshaping against the catalogue. Half-interval endpoints remain fixed, including 50, and a profile without sufficient direct five-star and weak opinions retains its raw fit. Inner training keeps franchise-linked examples together and uses four folds to keep the fitted history size closer to the published job. The target work is excluded from both the personal fit and the projection when requesting an independent match for an already-known work.

In an independent nested experiment we also chose the green threshold from earlier matched predictions by penalising weak titles entering green and favourites leaving green. On each whole-work or franchise movie split this gave no more false greens and retained at least as many genuine favourites. The earlier-day-only movie check caught 34 five-star films in green with nine weak films, versus 32 and nine for the incumbent. Applying a separate three-star anchor did not improve those green decisions. This experiment depends on recreating the incumbent at training time. The self-contained graded-star method is the private candidate.

### Final four-fold native decision

| Cohort | Incumbent weak / five-star titles scoring green | Private calibrated candidate | Incumbent → candidate all-star ordering |
| --- | ---: | ---: | ---: |
| Movies, work folds | 13 / 59 | 9 / 60 | 60.82% → 61.69% |
| Movies, franchise folds | 10 / 57 | 5 / 57 | 58.57% → 59.47% |
| Movies, alternate franchise folds | 9 / 56 | 8 / 56 | 57.13% → 57.86% |
| Movies, later rating days | 9 / 32 | 5 / 29 | 52.38% → 55.06% |
| Shows, work and original franchise folds | 20 / 54 | 13 / 51 | 68.82% → 69.94% |
| Shows, alternate franchise folds | 22 / 53 | 10 / 51 | 67.88% → 70.03% |
| Shows, later rating days | 6 / 20 | 4 / 16 | 60.96% → 60.47% |

**Keep the incumbent for ordinary cards in both media.** The richer movie model improved all three pairwise ranking measures on all four panels. Cross-sectional movie controls reduced false greens and preserved favourites, and 331 of the 444 hidden works scored in the 80s, versus 326 for the incumbent and 408 before display calibration. In the genuinely later personal ratings, the native job moved four weak movies out of green while also losing three genuine five-star films. The guard requires retaining favourites. For shows the later five-versus-3½ ordering also fell from 69.78% to 65.93%, outside the two-point tolerance. The private inspector makes these trade-offs observable on individual titles. An ordinary-card switch would need stronger independent evidence.

The chronology sensitivity check gave better results for films when feeding the same scale estimator different legitimate training evidence. Inner held-out forecasts from strictly earlier *rating days* gave seven weak / 35 favourite greens, versus nine / 32 for the incumbent. Using exclusively forecasts already made before each historical day gave seven / 34. These study arms have different participants per inner fit from the actual job. Their success cannot replace the native job's acceptance result.

**Sparse histories.** Across the three two-, ten-, and fifty-rating samples, the average changes in all-star ordering were −0.27, +0.18, and +1.95 percentage points for movies, and +0.05, +0.84, and −0.12 for shows. The weakest individual protected change was −1.81 points. With zero stars the original movie franchise fold improved four-plus/weak ordering from 69.60% to 74.50%, while favourite/3½ ordering fell from 55.47% to 51.95%. Ordinary movie watches alone cannot reliably identify favourites on every cohort. Film-only primary improvements are insufficient evidence for rating-free movie cards.


**Graded-stage timing.** The final native profile fitted the 765-movie and 566-show histories in 395 ms and 459 ms in a single in-memory run. A warm graded reference scored a fresh 24-item batch in median 0.36 ms / 0.98 ms (movie/show), and a 72-item batch in 1.57 ms / 1.64 ms across eleven repetitions. Seventy-two known titles with *cold*, exact-independent fits cost 37.66 s / 28.86 s, measured as a sequential worker workload. This includes rebuilding each omitted title's training-only display projection. These fits belong outside row requests. Warm known-title retrieval in this test is an in-memory map lower bound; request-level measurements are recorded separately.

The final prospective ledger was sealed at **01:33:20 UTC on 23 November 2026**. It uses the actual native four-fold job and its returned graded scale on both media. It records 7,356 paired predictions (4,195 of 4,228 films and 3,117 of 3,128 shows scorable by the challenger). Its SHA-256 is `769bca92b9dbdcc653ad7579bd71964b70bd3e9ff35d72dcdf3dd7453d689989`. A separate private source archive pins 149 files, the base commit, and all source hashes (`509bb52fe1e1a5d8ecbdf024cfa9742a744baec2ff3322b55d882a958fd78c49`). Neither private artifact is tracked. The evaluator rejected all old labels and found zero eligible outcomes at sealing.

### Why the challenger produces no red scores

The copied profile has **7/444 rated movies and 33/429 rated shows at 2½ stars or below**. Including three-star ratings raises those counts to 24 and 66. Four stars or higher account for 326 movies and 287 shows. There are zero recorded drops among the 765 movie and 566 show roots in this capture. The directly dated records independently confirm every rating at three stars or below. The show profile contains two additional four-star root ratings beyond the 427 directly dated show records.

| Sealed unfamiliar catalogue | Scored / eligible | Minimum | Lower quartile | Median | Upper quartile | Maximum | Below 50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Incumbent, movies | 4,190 / 4,228 | 15 | 76 | 79 | 82 | 91 | 148 |
| Raw challenger, movies | 4,195 / 4,228 | 66 | 80 | 81 | 83 | 90 | 0 |
| Graded challenger, movies | 4,195 / 4,228 | 64 | 77 | 79 | 81 | 89 | 0 |
| Incumbent, shows | 3,094 / 3,128 | 25 | 75 | 80 | 85 | 93 | 112 |
| Raw challenger, shows | 3,117 / 3,128 | 54 | 76 | 81 | 83 | 88 | 0 |
| Graded challenger, shows | 3,117 / 3,128 | 52 | 69 | 77 | 81 | 88 | 0 |

The red tail is already empty before display calibration. The final projection fixes the midpoint. The learned rating component’s expected score at zero feature offset is 76.5 for movies and 70.9 for shows on this account. To bring a prediction below 50, a target’s shared traits must overcome that favourable starting point and the other personal evidence. In the returned graded explanations, only 11 of 4,195 films and 1,192 of 3,117 shows received even one individual downward contribution of at least one display point. Contributions can be mixed within a work. The sealed unfamiliar titles have no eventual user labels at this date.

**Where the incumbent’s red scores came from.** Switching off catalogue selection alone removes all 148 movie reds and 86 of the 112 show reds. The older independent ledger reproduces the full incumbent score for every paired item. We also counted direct personal counterevidence separately. A trait qualifies when at least two independent title families averaged 2½ stars or lower for it and such families are a strict majority of all their rated families with the trait. We used genres, tags, themes, credited people, companies, networks and franchises. Of the incumbent reds, 79 movies and all 112 shows share some trait with at least two disliked families. **Zero of those red movies or shows meet the majority criterion**, including the 26 still-red shows after switching off selection. Across the full unfamiliar catalogue, 94 shows share a majority-negative trait, with graded scores from 58 to 86, median 70, and ten green. No movie trait met that evidence threshold. This check is deliberately conservative. A rare catalogue choice can still be a correct prediction, and two poor ratings on unrelated titles need not imply a shared cause.

**What the withheld labels establish.** When the target work and its actions were hidden, the graded model put **0/7 disliked movies and 0/33 disliked shows below 50**. Three of those seven movies and four of those 33 shows still received green scores. The incumbent put zero of seven films and one of 32 scorable shows below 50. If three-star works are included, the graded model put zero of 24 movies and zero of 66 shows below 50, with nine movies and 13 shows green. On the strict dislike subset, the training portion of the corresponding folds contained a majority-negative shared trait for zero films and seven shows. Those seven shows represent testable missed opportunities even with an account that seldom gives low ratings.

**Release implication.** Pairwise accuracy can improve while every genuinely disliked work stays above neutral. Add dislike recall below 50 and the fraction of disliked titles shown green as separate release checks, with counts for cases that had a repeatable negative trait in training. Report false reds on liked titles alongside them. Test whether explaining a repeated specific dislike against co-occurring positive traits helps on those cases. For sparse dislikes, carry forward the uncertainty instead of manufacturing red predictions from unseen catalogue items. The seals, scorer and ordinary cards were unchanged by this read-only audit. [Reproduce the label and ledger counts](negative-tail.py)

[Friend overlap and influence](social.md) · [Serving and performance verification](serving.md)

## Reproduce using private files

Use the project's pinned Bun executable in place of `bun`. The metadata argument is a local captured array of canonical title IDs with verified TMDB credits. The final argument is the independent eligible-catalogue summary from the private preview worker. Set `COAST_TASTE_REPLAY_STAGE=calibrated` for the final graded policy. It adds a distinct creator role when available. Predictions and ledgers contain private information and belong outside tracked source. Each mode creates its output exclusively with owner-only permissions.

```sh
export COAST_TASTE_REPLAY_STAGE=calibrated
bun docs/audits/2026-11-23-taste-v2/replay.ts graded "$capture" "$dates" "$private_run" "$metadata" "$catalogue"
python3 docs/audits/2026-11-23-taste-v2/evaluate.py "$private_run" --candidate calibrated --bootstrap 400
bun docs/audits/2026-11-23-taste-v2/replay.ts pairs "$capture" "$dates" "$private_pairs" "$metadata" "$catalogue"
bun docs/audits/2026-11-23-taste-v2/replay.ts benchmark "$capture" "$dates" "$private_benchmark" "$metadata" "$catalogue"
bun docs/audits/2026-11-23-taste-v2/replay.ts freeze "$capture" "$dates" "$new_private_ledger" "$metadata" "$catalogue"
python3 docs/audits/2026-11-23-taste-v2/prospective.py "$new_private_ledger" "$later_verified_dates"
```

For the earlier stage-by-stage comparison use `full`. Use `scale` to generate nested work/franchise calibrator inputs and `dated-scale` for calibrators fitted on older rating batches only; the outer date cutoff remains strict. [Graded application](graded-scale.ts) and [green-threshold comparison](scale.py) operate on the independent inner predictions.

The new paired ledger seals both algorithms' forecasts with the same timestamp, input digests and source digests. Only a verified, unambiguous first opinion after that instant qualifies. A title already rated by the time of sealing is ineligible even if it is rated again. The prior incumbent-only ledger remains independently evaluable.
