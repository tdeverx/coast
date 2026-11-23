# Does a disliked creative team's record transfer to a similar kind of title?

This exploratory follow-up was motivated by the whole-title errors of the broader authorship tests. A director can make both musicals and period dramas. The earlier studio protocol had already fixed a genre overlap of one half for comparing similar works. Apply that same rule here, with no adjustment after looking at this experiment's predictions.

Start from the identical director set for films or identical creator/showrunner set for shows. Only use confirmed direct ratings from the original training mask and from outside the target’s own franchise. Any known three-star-or-better work from the same team vetoes a penalty, including a work with insufficient independent prediction evidence. Otherwise require at least one independently predicted, previously disliked work from that exact team with genre-set Jaccard overlap of at least one half. A reader who liked an unrelated project by the team would therefore also receive the conservative veto.

Apply the mean personal prediction error for those similar titles, weighting each unrelated franchise once. Only downward adjustments are possible. The stronger repeat-evidence control requires two donor franchises instead of one. Keep all 32 rating masks, baseline scores and earlier-day cutoffs. Compare true dislikes, middling errors, four-plus false reds and individual five-star scores, including below-green favourites. Count distinct creative teams instead of treating reciprocal predictions as independent successes. The strictly earlier-day test supplies the most relevant check.

## Results

| Holdout | Shows below 50 among the viewer's dislikes | Movies below 50 among the viewer's dislikes | Newly red liked or middling titles | Five-star scores lowered |
| --- | ---: | ---: | ---: | ---: |
| Whole titles | 4 / 33 | 0 / 7 | 0 | 0 |
| Original franchise folds | 4 / 33 | 0 / 7 | 0 | 0 |
| Alternate franchise folds | 4 / 33 | 0 / 7 | 0 | 0 |
| Strictly earlier rating days | 1 / 7 | 0 / 7 | 0 | 0 |

These are the same four shows across the three structural assignments, belonging to two pairs of unrelated shows. Each had only one independently rated donor franchise. Only one true positive had that feedback on a previous rating day. Both works from one pair shared the same rating date. Requiring two prior disliked families changed zero scores across all 32 panels. With 50 prior ratings, two of three show samples each recovered one of the same four examples. The remaining sparse and zero-rating samples returned their original scores. Within-fold ordering across unequal ratings on whole-title shows moved from 70.05% to 70.37%.

The film that motivated the extra genre check was a four-star period drama incorrectly penalised because its director also made a disliked musical. That change disappeared. This is an exploratory correction to a known error and overlaps earlier analyses; one success on a later date is too little evidence for an automatic score override. An exact creative-team match with similar work the viewer previously disliked is worth testing again on subsequent ratings.

Reproduce with the original private captures and the full inner predictions created for the [authorship test](lineage.md).

```sh
python3 -B same-kind.py "$solo_capture" "$metadata" "$verified_dates" "$graded" "$lineage_inner"
```

[Aggregate results for all 32 panels](same-kind-results.json)
