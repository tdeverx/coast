# Can a person's credits and a studio's other work identify another dislike?

One additional two-star show crossed below 50 on the 870-title replay. Its forecast fell from 74 to 40. The original eight dislikes kept their scores, as did every other title, including 780 rated above three stars. This was an exploratory result on the viewer whose data suggested the rule. Keep it for offline comparison. The exact-team rule and personalised TMDB check remain the research baseline.

| Holdout | Titles | Dislikes | Below 50 with retained baseline | With studio genre check | Liked titles with any score decrease |
| --- | ---: | ---: | ---: | ---: | ---: |
| Individual titles, full history | 870 | 40 | 8 | 9 | 0 |
| Whole franchises withheld together | 870 | 40 | 7 | 8 | 0 |
| Reassigned franchise folds | 870 | 40 | 7 | 7 | 0 |
| Strictly earlier rating days | 382 | 14 | 2 | 2 | 0 |

The additional correct call in the first two rows is the same show. No film crossed below 50. The full-history baseline's previous three-star false positive also stayed at its original score. All four comparisons use the same frozen titles, original franchise groups, saved personal model scores and vote-count-aware TMDB check as the [previous replay](positive-evidence.md). In the new rule, only other personally rated works from the same medium and outside the target's franchise can supply evidence. Grouped tests exclude the entire test fold. The dated test also excludes all ratings recorded on or after the target day. Current credits and public reception are a single catalogue snapshot.

## Which evidence helped?

Across the 32 misses, 23 had a distinguishing trait backed by other favourites. Only two had a distinguishing trait that repeatedly appeared in unrelated dislikes. The original score placed 24 below their matched five-star title, despite a median score of 75 on the misses. The matched favourites are used for diagnosis after scoring. [Matched comparisons and format test](residual-pairs.md)

We tested whether two independent observations could corroborate a negative prediction. For a person and a company, each needs a strict majority of disliked families and at least two such families. A family with mixed ratings cannot supply a negative vote. The supporting families must be disjoint across the two clues and have known lead teams with no person in common across those clues. A four-star work featuring both clues vetoes the prediction. Personal opinions of higher-rated works carrying just one of the clues still count in its denominator. When both qualify, use the less negative of their two median family utilities. This constructs an experimental score from the viewer's past ratings. Its numerical magnitude has not been calibrated for future titles.

The initial two-clue rule lowered a two-star **and a four-star** show to 40. Replaying with stable provider company IDs and separate roles for studios and networks reproduced both calls. The false positive's two studio comparisons were comedy/dramas. Their only shared genre with the target was comedy, giving one-third overlap. The correctly lowered show's studio supplied two animated comedies, with genre overlap of 1 and two-thirds. Requiring two negative studio comparisons to pass the existing exact-team threshold of one-half genre-set Jaccard overlap preserved the four-star show's 77. This follow-up was chosen after inspecting the first two outcomes.

## How much independent support is there?

The extra hit draws on four works already among the original eight catches. The two studio comparisons share one lead team. The two performer comparisons share a different lead team. Withholding **any one** of the four removes the prediction. All four comparison ratings were recorded on the target day or later. Extending the genre requirement to the performer's comparisons as well removed the gain. An off-screen credit or minor voice part cannot establish which part of a show the viewer disliked.

An alternative based solely on the company being the first listed for the target gave the same one-title gain. Requiring it to be listed first on the other two productions too gave zero. The source list has no billing or importance field. Requiring two different lead teams for each clue, or checking for a liked comparable title by a returning creator, also failed to improve on the studio genre check. [Provider schema](https://developer.themoviedb.org/openapi/tmdb-api.json)

## Other signals on the same controls

| Signal | Full-history outcome relative to the retained baseline |
| --- | --- |
| Closest unrelated synopsis | One additional dislike. Also turned 37 liked titles red, including five five-stars. |
| Closest editorial keyword match with two informative tags | Zero additional dislikes. Ten liked titles turned red. |
| Synopsis and keywords independently select the same disliked title | Zero changes. For 30 of the 32 misses the closest unrelated synopsis belonged to a title rated above three stars. |
| A performer consistently disliked in a particular genre | Zero changes. Only three misses even had two other families featuring the same top-five performer in the genre. None had two disliked families. |
| Personally poor ratings for less-voted works of similar genre and era | Zero changes. Eleven misses were in the least-voted quarter of their comparisons. The median of those groups' personal median ratings was four stars. |
| Repeated dislikes of unscripted or documentary formats | Zero additional dislikes and three liked shows lowered on the full-history replay. |

[Synopsis and keyword replay](content_agreement.py) · [Actor and genre replay](actor_genre_exception.py) · [Vote-count replay](vote_count_context.py) · [Format replay](residual_pairs.py)

## Reproduce

Use the private inputs from the [frozen baseline](retained_panels.py), the original capture and the matching stored provider credits. The script only reads local inputs and creates a new owner-readable result file containing personal examples. It reports score changes by rating for every control.

```sh
python3 -B separate_credits.py GRADED VERIFIED_RATINGS FULL_TEAM MOVIE_RAW SHOW_RAW \
  ARCHIVED_TEAMS EARLIER_RAW FRANCHISE_RAW TIE_WITNESS CAPTURE METADATA NEW_PRIVATE_OUTPUT
```

[Person and studio experiment](separate_credits.py)

The [follow-up across personal story, credit, franchise and release patterns](pattern-followup.md) also tests both additional correct calls against incomplete histories.
