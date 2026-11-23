# Can Coast recognise disliked titles while preserving favourites?

The sealed personal scorer placed all seven movies and 33 shows rated 2½ stars or lower above neutral when each title and its own actions were withheld. The five folds reproduced all 873 stored results, including abstentions. All experiments here reuse the same copied account. Keep the original prospective predictions sealed. None of the experiments writes to the live scorer.

## What the individual explanations reveal

The ordered rating component's typical prediction in the dislike folds was about 77 for movies and 71 for shows, before the title's fitted metadata moved it. A separate average of the viewer's signed preferences received half the vote when supported. It raised the more title-specific estimate for 30 of the 32 disliked shows where both estimates existed. The final explanations allocated median negative contributions of less than one point for films and about three points for shows. Removing a trait and recalculating distinguishes its individual effect from a whole group's contribution displayed under a representative trait name. The [component traces](breakdowns.md) include that distinction.

## What changed in the replays

| Test | Dislikes and favourites |
| --- | --- |
| Remove the signed preference component whenever it raises the estimate | Recovered zero of the 40 on the whole-title test. Five movie favourites and six show favourites fell out of green. |
| Remove the favourable starting estimate only when the title’s fitted rating evidence points down | Recovered zero of the 40 and lost five green movie favourites in the whole-title test. |
| Remove both sources of upward pressure on the same predictions | Correctly put 17 of 33 disliked shows below 50, but also put 20 of 287 liked shows below 50 and removed six five-star shows from green. On movies it caught zero of seven dislikes, marked four liked films red and lost six green favourites. |
| Compare a title's two nearest disliked families with its two nearest counterexamples | Preserved every five-star score. In the later show test it correctly turned one of seven dislikes red and also turned a 3½-star show red. On the alternate franchise assignment it incorrectly turned a 4½-star show red. |
| A class-balanced personal classifier using content metadata | Preserved every five-star score. On later shows it correctly identified two dislikes and incorrectly turned a four-star show red. |
| Require both of those methods to agree on the same title | No title qualified on any of the 32 cohorts. |

The [native scoring component tests](breakdowns-ablation.md) and [two content classifiers](contrast-report.md) report the paired favourite counts and ranking changes. The account's one explicitly favourited canonical title was rated five stars, so it is included in the five-star checks. Directly held ratings and actions are never used as inputs for the target.

### Can the old score and new score identify a reliable lower range?

A separate rule used the old personal score and the new raw score together. It learned a lower-score region only from earlier or otherwise independently held-out predictions inside the training data. It required at least two disliked titles, a majority of dislikes, average utility below neutral, and no title rated four stars or higher in that region. It changed **zero** outer predictions on all eight dense work, franchise and chronological panels. The two methods did agree exactly with their original baselines before the rule was tried.

The scale overlap itself helps explain this outcome. In the movie whole-title test **none of the seven disliked films scored lower than the lowest five-star film**. In shows, 16 of 33 disliked titles fell below the lowest five-star show, yet none scored below the lowest four-or-higher show. These describe the held labels after the test. They cannot be used to choose the scoring cutoff. [Lower-score region replay](lower-region.py)

### Can plot descriptions corroborate the proposed changes?

As an exploratory follow-up after seeing the content-classifier results, we required the title's frozen synopsis embedding to be closer to an independently disliked synopsis than to its closest independently liked synopsis. At least two unrelated disliked training families and a liked title had to be available. The same test ran on both classifiers across all 32 cohorts, with original rating masks, family exclusions and strictly earlier dates preserved. It kept one proposed change, to a 3½-star show on the dated test, and caught zero actual dislikes. [Synopsis veto replay](synopsis-veto.py)

The raw negative signals are too weak in some titles and genuinely contradictory in others. Improving ranking or retaining all five-star scores alone would allow a four- or 4½-star title to move into red. Any release decision should measure both that cost and recovery of real dislikes on the same titles, then check fresh ratings against the sealed forecast.

A [separate TMDB replay](../2026-11-23-taste-audience/README.md) tests whether the audience average and vote count can distinguish these same titles in contexts where the viewer usually agrees with the crowd.

## Original plan status

The baseline, person-specific full-history model, separate explicit and behavioural models, staged metadata experiments, consumer integrations, friend comparison, separate peer experiment and private serving path are built. Some tested capabilities remain experimental. The calibrated card scorer omits explicit trait-pair offsets, and this account has too few jointly rated titles with friends to establish peer-assisted item accuracy. The [final exception controls](exceptions.md) check what the card actually does with specific studios, filmmakers and networks.

The [operational checks](verification.md) include scrolling through a real rebuild, SQL counts and recovery from terminating a worker during publication. The [comparison of all 17 model variants](verification-stages.md) records their movie and show results. The accuracy goal is open. None of the tested changes identified dislikes consistently while protecting strongly liked works on both whole-title and later-day tests. The [original paired ledger](../2026-11-23-taste-v2/README.md) is available for comparison when new ratings arrive.
