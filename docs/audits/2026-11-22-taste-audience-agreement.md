# Can public ratings correct a high personal match?

The experiment used one account on an isolated development copy. Coast already discounts the negative evidence against a title’s genres, tags and other features when a personal dislike agrees with a reliably low audience rating. This experiment tested the separate question of adjusting an unseen title’s match when this particular viewer has agreed or disagreed with public ratings on similar works.

## Evidence and controls

There were 444 rated movies and 429 rated shows. 851 of the 873 had a usable TMDB average and at least 20 votes. Missing or unreliable public data left the personal score alone. Twenty-one of the 22 missing ratings had fewer than 20 votes. The copied data stores an audience average and vote count. It does not record voter intent or establish why a title was poorly received.

Five fixed work folds and five connected-franchise folds separated training titles from test titles. An inner fold supplied each training title’s personal score while withholding that title’s own history from the fit. We verified that no title crossed the outer boundary, and that no connected franchise crossed it in the franchise evaluation. Each medium used public-score percentiles from a fixed unseen catalogue sample. The measured outcomes used the integer match a user would see. One comparison removed all personal training ratings, and a separate chronological split used only evidence dated before the cutoff. These trials had no usable prior ratings for learning audience agreement, so both abstained.

The first model learned the user’s response to public scores within each medium. The second learned only the part left over after accounting for the existing personal match. Both discounted small vote counts, shrank uncertain slopes toward zero and capped the adjustment at eight points. They allowed either sign. Public averages on existing works are current snapshots, not historical snapshots captured when the viewer formed an opinion.

## Aggregate ranking versus individual mistakes

| Work held out | Existing taste score | Personal audience slope | Slope after controlling for existing taste |
| --- | ---: | ---: | ---: |
| Movies | 75.96% | 82.20% | 81.78% |
| Shows | 79.11% | 83.69% | 83.62% |

Each number is the share of liked-versus-lower-rated pairs ordered correctly, with half credit for ties. For the first adjustment, the paired conditional 95% interval for the movie improvement was +0.02 to +12.45 percentage points, and +1.75 to +7.40 for shows. A control using vote-count percentile alone reached 83.10% on shows. Much of the apparent benefit there could also be predicted by how widely rated the show was.

We applied the separately fitted adjustments to the earlier whole-title withholding test as a further check. Of 40 titles personally rated 2½ stars or less, 39 had a blind personal score and 14 scored at least 80%. Both medium-wide alternatives reduced that count to 12. Four false highs moved below 80%, while two new ones crossed above it. Among 20 strongly liked titles in the public bottom quartile, the number scoring at least 80% fell from 13 to 8 or 11, depending on the model. For the separate 6.5/10 public cutoff, both alternatives moved five strongly liked titles below 80% in exchange for correcting three false highs in that band.

The poorly received subset included eight Animation titles and 15 titles with explicit LGBTQ-related narrative tags across movies and shows. There was little evidence to distinguish a reliable exception from noise in many individual tags. No tag had a strong-like and dislike sample of five each in the low-score band. Classification here concerns catalogue subjects. The viewer's own identity was not an input. [Original title withholding experiment](2026-11-22-taste-title-validation.md)

## Selective agreement by genre and tag

Two further trials let each genre or tag learn a signed relationship with public opinion separately for low and high public ratings. A sustained opposite pattern could override the broader one. Each title received at most one local adjustment. A group needed at least 12 independent franchise clusters, including three in both the tail and the comparison band. The local slope had to improve held-in predictions on at least two of three franchise blocks. Repeated strong personal ratings in a poorly received group could veto a negative adjustment. The rules applied to every genre and tag and were fixed before scoring the outer folds.

One version inherited a broad audience slope in the absence of a supported local exception. The other applied zero adjustment unless a local relationship passed validation. The prespecified criteria included better ordering than the broad model on both movies and shows, fewer false highs, and preservation of strong personal favourites in the audience’s bottom quartile.

| Measure | Existing score | Medium slope controlling for taste | Inherit medium, allow local exception | Local evidence required |
| --- | ---: | ---: | ---: | ---: |
| Movie work-fold pair ordering | 75.96% | 81.78% | 81.11% | 77.02% |
| Show work-fold pair ordering | 79.11% | 83.62% | 82.34% | 81.08% |
| Blind low-rated titles scoring at least 80%, out of 39 | 14 | 12 | 14 | 16 |
| Strong likes scoring at least 80% in the public bottom quartile, out of 20 | 13 | 11 | 11 | 13 |

The stricter rule kept the count of strongly liked, poorly received titles scoring at least 80%, but introduced two additional false highs overall. Both selective versions raised two highly regarded shows that the viewer disliked across the 80% threshold. The inherited rule did correct one of the four original false highs in bottom-quartile Drama, one of two in Animation, and two of four in Comedy. It left the single original false high among the two disliked LGBTQ-tagged titles there. These categories overlap and the group counts are small.

The results distinguished group size from useful disagreement evidence. Show Drama had 35–39 independent bottom-quartile clusters in each training fold and earned protection in all five. Movie Animation had 41–47 rated clusters per fold but none in the public bottom quartile. For the exact `lgbt` tag, there were one to four such movie clusters and four show clusters per fold. Neither example established a reliable boost for opposing the audience.

As a final exploratory check, we let the existing fitted models act only on the public bottom quartile. This tested the narrower idea of using poor reception to lower scores without ever rewarding a highly reviewed title. Requiring local evidence preserved all 13 previously high-scoring favourites but corrected none of the 14 confident mistakes. Movie work-fold ordering moved from 75.96% to 76.05%, while shows moved from 79.11% to 78.95%. Inheriting the medium slope corrected two false highs and also lowered two favourites below 80%. This follow-up reused the same holdouts and cannot serve as an independent confirmation.

**Decision.** Keep the personal item scorer as the source of the displayed match. All new audience adjustments remained offline. The broad adjustments improved average ordering on this account, but none met the goal of correcting false highs while reliably preserving personal exceptions. Coverage and the current data cannot support attributing any disagreement to coordinated voting. A repeat evaluation could use independently dated ratings from more viewers to test whether particular local disagreements persist on genuinely future titles.
