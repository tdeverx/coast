# Creative teams as a personal predictor

We asked whether mistakes in the existing personal scorer repeat for other titles from the same writers, directors or show creators. We subtracted each donor work's independently predicted score from the viewer's actual star utility. A team that the viewer enjoys exactly as much as expected supplies little correction. An unusually strong positive or negative surprise on a different franchise can supply more. The target's own rating, engagement and franchise have no vote. All 32 panels reuse their frozen target scores, earlier date cutoffs and seeded rating masks. [Registered protocol](lineage-protocol.md)

| Comparison | Dislikes scored below 50 | Four-plus ratings newly below 50 | Previously green five-stars lost | Five-star scores lowered |
| --- | ---: | ---: | ---: | ---: |
| Whole titles, full-strength error transfer | 4/40 | 0 | 5 | 18 |
| Whole titles, weight learned from training families | 0/40 | 0 | 1 | 2 |
| Alternate franchises, full strength | 4/40 | 0 | 7 | 12 |
| Alternate franchises, learned weight | 0/40 | 0 | 1 | 1 |
| Earlier rating days, full strength | 1/14 | 0 | 3 | 5 |
| Earlier rating days, learned weight | 0/14 | 0 | 0 | 2 |

Only one of seven disliked films and five of 33 disliked shows had a usable independently rated authorship neighbour on the whole-title split. Some liked titles also have very direct creative links to disliked ones. A general transfer therefore cannot explain most low scores. At full strength, all four successes were shows and came from two pairs of independently catalogued shows. Each member of a pair could predict its partner in a different fold. Reappearing in the franchise tests does not add four new examples.

The learned rule allowed 42% of a negative proposal for one of those titles and 0% for the other three in their respective folds. None crossed below 50. On whole titles the learned adjustment moved all-unequal-pair ordering from 61.69% to 61.79% for films and 70.05% to 69.80% for shows. Native sparse inner predictions were regenerated for the 2- and 10-rating masks, supplying 356 independent donor predictions missing from the earlier experiment's cache. Every previously supported dense, date and 50-rating inner fold reproduced exactly. With no prior ratings both methods reproduced the original scores.

The [exact lead-team test](lineage-exact.md) examines the distinction between a genuine personal dislike and a title that scored slightly worse than predicted while still earning a strong personal rating. All experiments are offline. [Full results](lineage-results.json)

## Reproduce

Generate the private independent personal scores from the same native inputs used by the [previous holdout harness](../2026-11-23-taste-audience/inner.ts). The optional sparse flag also generates scores when the viewer has two or ten training ratings.

```sh
bun docs/audits/2026-11-23-taste-audience/inner.ts "$capture" "$dates" "$metadata" "$catalogue" "$graded" "$private/new_inner.json" --include-sparse
python3 -B docs/audits/2026-11-23-personal-dislike-signals/lineage.py "$metadata" "$dates" "$graded" "$private/new_inner.json"
python3 -B docs/audits/2026-11-23-personal-dislike-signals/lineage-exact.py "$metadata" "$dates" "$graded" "$private/new_inner.json"
```

The optional `COAST_PERSONAL_LINEAGE_PRIVATE` output contains work IDs and personal scores; supply a fresh owner-only path for each run. Neither evaluator reads an audience score.
