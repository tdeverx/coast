# Separating personal agreement, general reception and popularity

On the original 873 whole-title predictions, raw TMDB reception identified 10 of the 40 personal dislikes and also marked 26 four-star-or-better titles below 50. Learning how strongly the viewer usually agrees with the crowd improved relative ordering for both media. It identified zero of the 40 at the existing score threshold and pushed seven previously green five-star films below 80. All seven were rated at least one full star above the TMDB average.

| Whole-title test | Dislikes below 50 out of 40 | Four-star-or-better titles below 50 out of 613 | Previously green five-stars lost, movies / shows | Newly green five-stars, movies / shows |
| --- | ---: | ---: | ---: | ---: |
| Original private personal scorer | 0 | 0 | 0 / 0 | 0 / 0 |
| TMDB audience alone | 10 | 26 | 50 / 29 | 0 / 0 |
| Personally learned audience adjustment | 0 | 0 | 7 / 0 | 4 / 1 |
| Personally learned vote-count adjustment | 0 | 0 | 5 / 6 | 0 / 1 |
| Vote count with the independent audience adjustment | 0 | 0 | 6 / 4 | 4 / 1 |

There were 66 five-star films and 59 five-star shows, with 60 and 51 originally in green. Among the 56 five-star movies and 37 five-star shows rated at least one star above the crowd, the global personal adjustment lowered 18 movie scores and eight show scores. The single explicit favourite in the source account belongs to the five-star population.

## Which input improves relative ordering?

Each percentage is the share of differently rated pairs ordered correctly within the same fold. Ties earn half credit. Work, franchise and date panels overlap.

| Holdout | Original personal | Vote count only | Vote count plus independent audience signal | Audience adjustment only |
| --- | ---: | ---: | ---: | ---: |
| Movies, whole titles | 61.69% | 62.82% | 67.77% | 68.29% |
| Movies, franchises | 59.47% | 61.08% | 65.77% | 66.16% |
| Movies, alternate franchises | 57.86% | 60.07% | 65.91% | 66.29% |
| Movies, rating dates | 55.06% | 61.11% | 66.44% | 68.58% |
| Shows, whole titles and primary franchises | 70.05% | 73.19% | 73.65% | 74.25% |
| Shows, alternate franchises | 70.14% | 72.98% | 73.63% | 74.74% |
| Shows, rating dates | 60.47% | 63.82% | 63.97% | 65.94% |

Accounting for vote count first leaves 4.95 percentage points of incremental ordering accuracy on whole-title movies and 0.46 on shows. Neither control recovered a dislike at the reference vote weight. On rating dates, global audience adjustment also missed all 14 dislikes and dropped five previously green five-star films. Today's vote totals and averages can incorporate feedback added after those rating dates. These are retrospective comparisons.

## Replaying the controls

The script consumes the original private graded predictions, verified rating dates and frozen TMDB snapshots. It preserves abstentions, every fold, the original seeded rating budgets and strictly earlier personal rating dates. Labels are hidden for all titles in each outer fold before fitting. It fits separate controls per medium with no per-title lookups outside the archive. The private replay's 32 panels include all three sparse-rating seeds. All zero-rating and two-rating personal corrections equal the original score exactly.

The crowd control converts TMDB's ten-point average to stars and shrinks toward Coast's neutral three stars with weight `votes / (votes + 50)` before applying the existing star-to-fit scale. A missing audience score gives 50 for this unpersonalised control. The global control learns a weighted slope predicting personal rating utility from audience stars, discards the negative or uncertain part using an approximate lower 95% slope bound, and adds the vote-weighted adjustment to the frozen personal estimate. Missing audience data or insufficient training leaves the personal score intact. The count control repeats the fitting procedure with log vote volume. The joint control estimates the additional audience effect after removing its linear association with log vote count in the training fold.

As a sensitivity check, changing the shrinkage reference to 10 votes let the global personal adjustment catch two disliked shows in the whole-title test. It also marked a liked show below 50 and lost the same seven green movie favourites. The rating-date show test then caught zero dislikes and marked one liked show below 50. Raising the reference to 200 recovered zero dislikes in the whole-title test. The cutoff for an audience disagreement in this report, at least one full star on the original personal and audience scales, is only an evaluation label.

```sh
python3 control.py "$privateGraded" "$privateDates" "$privateMetadata"
```

[Control implementation](control.py) · [Aggregate results and vote-count sensitivities](control-results.json)
