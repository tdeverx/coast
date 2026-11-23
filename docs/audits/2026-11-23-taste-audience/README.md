# When does the TMDB audience predict a personal dislike?

The experiment used the copied Coast account and the private movie/show scorer. The primary test hides a title’s own tracking and rating. It contains seven disliked films and 33 disliked shows, 613 titles rated at least four stars and 125 five-star favourites. A recovered dislike must score below 50. Each previously green favourite that crosses below 80 counts as a loss even when another favourite gains green. We also counted smaller drops to five-star titles rated at least one full star above the public average. The frozen 32 panels cover whole titles, franchises, later rating dates and reduced rating histories. They overlap and their counts cannot be added.

## Primary whole-title results

| Method | Dislikes below 50, out of 40 | Four-star-or-higher titles below 50, out of 613 | Previously green five-stars lost, out of 111 |
| --- | ---: | ---: | ---: |
| Original private scorer | 0 | 0 | 0 |
| TMDB score alone, discounted for small vote counts | 10 | 26 | 79 |
| Adjust the personal score using medium-wide audience agreement | 0 | 0 | 7 |
| Learn where audience scores explain personal prediction errors by genre and tag, and check on held-out families | 0 | 0 | 5 |
| Require a matching genre or tag to improve earlier held-out predictions on the same side of the audience average | 0 | 0 | 5 |
| Require similar, poorly received titles to have credibly below-neutral personal ratings before creating a red score | 0 | 0 | 0 |

The contextual adjustment lowered the seven disliked films by an average of 3.86 points and the 33 disliked shows by 1.33. It also reduced 27 of the 93 five-star scores where the viewer rated the work at least one full star above the audience. Five of those films left green. Within each fold, the chance that a liked work ranked above a disliked one rose from 73.27% to 74.06% for films and from 83.70% to 84.77% for shows. Relative ordering can improve while every disliked title stays above neutral.

The stricter local test removed the medium-wide fallback. An individual genre or tag had to improve predictions on the relevant side of the public average for at least eight independent training families. This lowered 30 of the 93 disagreement favourites (20 films and 10 shows). Five five-star films left green while five others entered. On the retrospective date split it identified zero of 14 dislikes and again cost five previously green films. With zero, two or ten training ratings it retained every baseline score. [Local test protocol](strict-local-protocol.md) · [Full results](personal-strict-results.json)

## How much did the vote count explain?

Every personal dislike and favourite had a TMDB vote count. The median disliked show had 83 votes compared with 1,640 for five-star shows. We used 50 prior votes to dampen uncertain audience scores and separately tested whether vote volume itself predicted the viewer's ratings. On films, adding audience reception after accounting for vote volume improved ordering across all unequal ratings by 4.95 percentage points. On shows the gain was 0.46 points. The more aggressive 10-vote medium-wide adjustment caught two disliked shows, turned a liked show red and still cost seven green five-star films. [Controls and sensitivity](control.md)

## Can the audience corroborate an existing negative signal?

The simple poor-reception check prevented the prior nearest-title test from turning a 4½-star favourite red on the alternate franchise split. It also retained that test’s correct 2½-star red prediction on the date split. Requiring local personal agreement discarded the correct prediction as well. A different personal classifier plus audience corroboration retained two true dislike predictions on the date split and still incorrectly turned two 3½-star shows red. Neither classifier recovered any of the 40 primary whole-title dislikes. [Corroboration replay](corroboration.md)

We also tested allowing the audience to create a new red score. In 225 scored appearances where local evidence established relative agreement with the audience, only three training estimates put the viewer's mean taste for the poorly received group below neutral. All three had uncertainty extending above neutral. Skipping the uncertainty check would have turned two liked predictions and one middling prediction red, with zero true dislikes recovered. These are appearances across overlapping replays. [Direct dislike test](direct-low.md)

## What the historical comparison establishes

The copied database's earliest saved TMDB vote observation followed the last verified personal rating. The chronological tests use only earlier personal ratings to fit, but their TMDB inputs contain hindsight. Requiring a TMDB snapshot available by the prediction date produces no usable historical audience observations. A prospective test would need to retain both the audience average and vote count alongside the personal predictions before the next rating arrives. [Source coverage and dates](coverage.md)

The ordinary and private scorers continue using their existing policies. Independent recounts matched the frozen target IDs, baseline scores, personal ratings and reported paired favourite and dislike counts on all 32 panels. Reproduction instructions and additional results are in the [personal experiment](personal.md), [classifier comparison](corroboration.md) and [medium-wide controls](control.md).
