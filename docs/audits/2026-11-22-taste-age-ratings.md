# Age ratings in screen taste

Movie and show profiles learn separate regional age-rating affinities from the existing title snapshots and metadata priority. Missing or unrated certifications contribute no evidence. When the rating has enough support, it provides context at a lower starting weight than decade and needs a primary match. The existing refresh job prepares the lookup and warms candidates. Age ratings do not admit candidates into the recommendation shortlist. The title popup calculates the exact age-rating contribution only for the requested inspection.

Five fixed folds held out whole rated titles from one account. The same 444 rated movies and 429 rated shows were used for all three treatments. The replay restored the prior cohort sizes and evaluated the variants against identical folds within this run. Exact membership of the earlier run's folds could not be confirmed. Unrated runs removed training star ratings and kept ordinary activity and endorsements. Comparisons count a four-star-or-higher title ahead of a three-star-or-lower title, with half credit for ties. Ranking used the confidence-weighted personal match and return tie-break. The replay excludes friend activity and recommendation shortlist admission.

| Cohort | Overall baseline | Standalone | Standalone and combinations | Within genre baseline | Standalone | Standalone and combinations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Movies with ratings | 0.7799 | 0.7855 | 0.7853 | 0.7321 | 0.7385 | 0.7370 |
| Movies without ratings | 0.7193 | 0.7150 | 0.7150 | 0.7452 | 0.7404 | 0.7404 |
| Shows with ratings | 0.7911 | 0.7899 | 0.7899 | 0.6743 | 0.6721 | 0.6721 |
| Shows without ratings | 0.6315 | 0.6397 | 0.6397 | 0.5518 | 0.5648 | 0.5648 |

The within-genre calculation compared certified title pairs sharing a genre. The experimental combination model estimated the joint certification and genre/tag effect after removing the separate effects, using four cohorts with at least five works each. It shrank the estimate using the smallest cohort's evidence and tried up to one three-point adjustment per candidate. It slightly lowered rated movie accuracy and left the other three measured comparisons unchanged. The change publishes standalone context only.

There were 426 certified movie holdouts and 348 certified show holdouts. Every one of the 99 holdouts with an unknown certification retained identical match output, including confidence. Standalone context changed 52 rated movie scores, seven unrated movie scores, 34 rated show scores, and 15 unrated show scores. This measures one account and does not establish a ranking improvement for other accounts or production latency.
