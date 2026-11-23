# Prospective public-reception comparison

At 03:36:11 UTC on 23 November 2026, the private study recorded predictions for 7,356 previously unseen movies and shows in one viewer's catalogue sample. The zero-point arm is the personal prediction with the guarded creator/director adjustment. The two-, four- and eight-point arms add the same local TMDB agreement rule at different maximum strengths. Four is the primary comparison with zero. Eight and two were declared before any subsequent rating. The ledger also retains the original personal score without the creator adjustment.

| Medium | Enrolled | Personal prediction available | Personal prediction and TMDB votes available | Different at 2 points | Different at 4 points | Different at 8 points |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Movies | 4,228 | 4,195 | 1,950 | 59 | 254 | 595 |
| Shows | 3,128 | 3,117 | 1,175 | 7 | 86 | 242 |

Coast's live database was read in a single read-only transaction at 03:33:56 UTC. Across candidates and training titles, all 871 previously verified direct ratings matched the account's current set of rated titles. The source recorded each known TMDB average on its original ten-point scale, its vote count and the time Coast last observed it. These were Coast's cached provider figures, ranging from minutes to 3.3 days old. No provider refresh was triggered. Of the enrolled works, 3,137 had a usable TMDB observation, including 12 on which the personal model abstained. A missing observation leaves all weights at the baseline.

Predictions include ties and abstentions and are independent of whether the viewer later chooses or enjoys an item. A direct, verifiably dated personal rating after sealing supplies the outcome. Earlier imports, backdated ratings, and edits to a previously rated work do not qualify. At sealing there were no eligible subsequent ratings. Only enrolled movies and shows can contribute to this round; additions to the catalogue need a new seal before being rated. The product's scorer, API and card UI are unchanged.

The file is owner-readable and excluded from Git. The SHA-256 of the complete first ledger is `e74cbb76b479350e82c1a70c0e95f3d1439fed1290e002d55a15d1c734415451`. Forecasts in a later round cannot replace the first prediction retroactively.

## Reproduce or evaluate

Run the following from this directory with private paths, an authorised Coast account and a new destination for each snapshot and seal. The source command uses the Apple container CLI and a local database socket. All scoring and output writes happen outside Coast.

```sh
python3 -B prospective-source.py CONTAINER USERNAME CAPTURE NEW_PRIVATE_TMDB_SOURCE
python3 -B prospective-freeze.py CAPTURE CREDIT_METADATA VERIFIED_DATES GRADED SEALED_NATIVE NEW_PRIVATE_TMDB_SOURCE NEW_PRIVATE_LEDGER
python3 -B prospective-outcomes.py VERIFIED_DIRECT_RATINGS NEW_PRIVATE_LEDGER
```

The first wave's recorded cohort can be evaluated without regenerating the predictions or fetching newer provider figures. Use an account-bound outcome export where available. [Outcome selection and metrics](prospective-outcomes.md) · [Historical weight comparison](weights.md)

The account's first read-only Trakt export after sealing returned 919 records. The collector resolved 870 direct movie and show ratings with original timestamps, excluded an anthology-season rating from the show comparison, and found zero eligible subsequent outcomes. Coast's current native rating row stores its latest edit; by itself it cannot verify a first native rating. [Read-only Trakt outcome collector](prospective-trakt.ts)
