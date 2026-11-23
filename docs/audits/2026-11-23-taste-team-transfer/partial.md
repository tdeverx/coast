# Does the dislike signal transfer when the creative team changes?

Across the 32 frozen movie/show panels, **neither a returning individual lead nor a writer moving between different leads recovered another personal dislike**. The original four whole-title hits still came from the same two intact teams. A partially returning lead incorrectly lowered one 4½-star show in two overlapping panels.

| Whole-title opportunity | Movies | Shows | Among the 40 disliked targets |
| --- | ---: | ---: | ---: |
| Different lead team, one continuing lead, similar genre | 10 of 444 | 69 of 429 | 1 |
| Different leads, one shared writer, similar genre | 29 of 444 | 0 of 429 | 0 |
| Different leads, at least half the writers shared, similar genre | 18 of 444 | 0 of 429 | 0 |

An opportunity means the viewer had a permitted rating from a different franchise linked by the corresponding credits. The only disliked target with a partial-lead opportunity in the whole-title panel had a positively rated comparison. The contrary opinion correctly vetoed a decrease. No extension changed any whole-title or earlier-day score. The two-donor control made zero changes on every panel. The public audience score and vote count were absent throughout.

In the alternate franchise assignment and one 50-rating mask, the same returning lead connected a 4½-star show with a two-star show. The permitted training set contained no conflicting opinion for that lead in that role. The extra correction fell from 71 to 30 and from 73 to 28 respectively. The donor's actual rating postdated the target by almost five years. Those structural holdouts can use it; the strictly earlier-day test excludes it. The new route therefore reproduced a real disagreement in both structural folds rather than a new success. All five-star scores stayed unchanged.

The frozen root catalogues recorded live-action and animated show creators extensively (406 of 429), but only 16 had writing credits in the four explicitly allowed roles. Among the seven film dislikes, six had writing credits; none had an eligible outside-franchise personal rating with a shared writer, different directors and a similar genre. The separate [recurring episode-writer test](partial-episodes.md) addresses an alternate source of television writing credits.

The one-half genre match, explicit opposite-opinion veto and personal-score adjustment were fixed before this experiment. See the [registered rules](partial-protocol.md), [script](partial.py) and [32-panel aggregate results](partial-results.json). Reproduce using the same materialised inner scores as the [original lineage comparison](../2026-11-23-personal-dislike-signals/lineage.md).

```sh
python3 -B partial.py "$solo_capture" "$metadata" "$verified_dates" "$graded" "$lineage_inner"
```
