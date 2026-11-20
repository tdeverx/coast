# Full-history Taste review

Coast stores one owner-private reference per medium. The worker groups history by canonical work, calculates its rating and engagement, and streams 300 distinct works at a time. Each feature receives one contribution per work. Features keep distinct support, explicit positive feedback, signed opinions, consumed and repeated works. Works with missing metadata still count in the exposure denominator. The separate median of recorded ratings helps interpret the user's rating scale. It starts adjusting after five rated works, with a maximum shift of three quarters of a star.

The scorer uses feature frequency within the medium, repeat exposure, explicit opinions, distinct supporting works, contradictory evidence, candidate metadata coverage and the specificity of the matching feature. A common game mode supplies context. A single genre qualifies only when the owner’s explicit feedback or deliberate returns distinguish it from the rest of that medium. Repeated credits for one person and duplicate descriptive labels cannot masquerade as corroboration. A small number of titles with rich metadata still provides limited evidence. An item receives one public-facing percentage for its viewer, with up to three reasons. The owner can inspect individual feature counts in their private Taste segment.

The distinction between preference and confidence draws on [Hu, Koren and Volinsky's work on implicit feedback](https://yifanhu.net/PUB/cf.pdf). The weights here are Coast's content-based heuristics. They have not been fitted to labelled outcomes.

## Execution and privacy

The existing durable job admits at most ten users per run, checkpoints each publication, checks its lease and rechecks revisions before publishing. A user's private history has no work-count cutoff. The existing recommendation ranking uses its own 300-work seed window and 500 candidates per medium. Unchanged profiles rebuild weekly. Reads hide profiles built under withdrawn source permissions or an earlier scoring model. Ordinary new history is reflected at the next refresh. Summary and affinity browsing read the saved profile. The browser receives a small summary or one 25-entry page.

A title’s warm result is read directly. On a miss, the service reads a lookup-ready reference for that medium and local metadata for all missing titles in the request. The worker prepares all feature weights, support and direction once, then publishes the reference alongside the full profile and warmed results. No request-time provider calls, catalogue-wide per-user scoring, per-card fan-out or new background service were introduced. Friend comparison uses its separately filtered inputs. A shared release decade can be displayed in that breakdown without changing the headline score by itself.

## Earlier full-history benchmark on an isolated PostgreSQL 17 copy

The copied data included 19,951 applied positive watch events and 21,456 nonempty tracking-state records for the six eligible users. These sources overlap. The job resolved 1,677 distinct user–work pairs, of which 1,648 had usable features. Of the distinct works, 1,618 had consumption evidence and 145 had repeat evidence. The job aggregated 66,945 distinct work–feature observations into 36,924 user–medium–feature entries. It evaluated 9,026 recommendation candidates, found 46,373 matching feature identifiers and returned 5,210 supported scores. The 36 saved medium profiles occupied 966,565 bytes of compressed profile-column payload. Table and index overhead are additional.

The measured worker run on the isolated two-CPU instance took 2.81 seconds. An unchanged run took 2 ms and rebuilt zero profiles. Reading a history of over 1,000 works with their metadata took 367 ms. Three direct title reads agreed with the saved job outputs.

| Scoring 72 unseen items for the largest account | Median | p95 |
| --- | ---: | ---: |
| Movies, scoring with the reference already compiled | 0.27 ms | 0.53 ms |
| Movies, including locally stored candidate metadata | 5.17 ms | 5.66 ms |
| Shows, scoring with the reference already compiled | 0.26 ms | 0.33 ms |
| Shows, including locally stored candidate metadata | 4.38 ms | 5.41 ms |

These measurements exclude HTTP, browser rendering and cold loading of the profile. Enriching metadata has a cost. In a separate 32-cycle paired local test, p95 feature hydration for 300 movies moved from 19.71 to 23.20 ms and shows moved from 16.12 to 17.71 ms. Reusing existing normalized cast credits avoided expanding a second cast list on every read. Scoring uses locally stored facts. Typed composer and cinematographer features can fill in during normal TMDB refreshes.

## Ranking checks and limits

Five deterministic folds held out entire canonical works by hashing their IDs. Training excluded each held-out work. For each eligible held work, comparisons used up to 20 unseen items of similar metadata breadth. A tie earned half credit. This measures whether history tends to rank ahead of unseen items. An unseen item may also be something the user loves.

| Medium | Previous rank win rate | New rank win rate | Held-out works with scores |
| --- | ---: | ---: | ---: |
| Movies | 45.7% | 54.8% | 942 / 954 |
| Shows | 55.8% | 58.8% | 482 / 499 |
| Games | 49.1% | 47.9% | 175 / 204 |

The copy contained one explicit star rating, and only one account supplied the held-out game history. Music qualified on zero of five held-out works, comics on five of fifteen, and books had no history. Confidence and fit thresholds therefore have deterministic behavioural coverage across media, with insufficient labelled evidence to validate probabilities of liking. The test used current catalogue metadata and a hash partition. A predictive accuracy claim would need later user feedback evaluated against profiles and metadata as they existed at the time. See [Ji et al. on temporal leakage in recommender evaluation](https://arxiv.org/abs/2010.11060).

Controlled cases included users with identical 2.75-star medians and opposite preferences for two actors. The same actor scored 78 for one user and 25 for the other. In a 200-film history, 40 distinct appearances yielded a 64 match, four appearances 54, and twenty explicit dislikes 20. A rating and a watch on the same title count as overlapping evidence. A name-only artist credit remains distinguishable from a verified artist; a seen episode contributes to its show's taste identity and does not establish a guest appearance in that episode.

Local regression checks cover 625 retained works, pagination beyond 20 pages, duplicate and repeated plays, cross-source identities, rating precedence, readiness, source withdrawal, cancellation, revision changes, and queue recovery. Chromium on desktop and mobile verified profile evidence browsing and one percentage in the title match dialog using a separate synthetic account.

## Prepared scoring references

Each owner and medium has one versioned profile row. Its full history summary and paged affinities serve the Taste segment. A separate JSONB column in that row holds the prepared scoring reference. It contains feature IDs with independent support, signed preference, confidence weights, explanation labels and direction. It also records genre aliases so that the same label under tags does not count a second time. The same transaction publishes the profile, scoring reference and warmed results. A prior model’s revision is ineligible while the normal job rebuilds it. The additive migration adds a nullable column and leaves the job to populate it.

The internal scoring service accepts up to 72 titles per call. The warm path used two database statements including the fresh feature and permission check. The cold path used three statements, including one batched local metadata read. Statement counts were identical for one and 72 ordinary titles. Episode and season credits can refine show context and verified track artists can replace album artist credits. Training folds episodes and linked tracks into their show or album so the regular cast or artist receives one vote per canonical work. Watching an episode alone does not attribute a preference for its guest cast.

The final prepared-index benchmark used six accounts on the isolated two-CPU PostgreSQL 17 copy. A rebuild took 3.302 seconds and an unchanged scan took 3 ms. All 9,026 warmed candidate results were compared with the full calculation and with the serialized reference, including 128 calls through the batch service. Percentages, confidence, explanations and withheld results matched exactly. The candidates covered 4,145 distinct titles across accounts, and 5,212 user–title pairs had numerical matches. The 36 full profile payloads occupied 973,962 compressed bytes. Prepared scoring added 240,961 bytes. The largest individual scoring reference occupied 79,224 compressed bytes and encoded to 222,161 JSON bytes. Storage accounting excludes table and index overhead.

| Service call on largest owner | Median | p95 |
| --- | ---: | ---: |
| One title, warmed score | 1.45 ms | 2.43 ms |
| One movie, cold score | 3.24 ms | 5.47 ms |
| 72 warmed scores | 3.25 ms | 4.79 ms |
| 72 cold movies | 10.31 ms | 12.68 ms |
| 72 cold titles across media | 9.22 ms | 11.43 ms |

The single-title timings used 32 runs and the row timings used 16. These timings include permission checks, local database access and application scoring. HTTP and rendering are outside the measurement. The benchmark encoded 72 supported scores in 3,036 uncompressed bytes. This rollout keeps batching internal. Calling the singleton 72 times sequentially took a median of 399 ms across four runs. A cold row reads one prepared document per required medium. Its transfer cost can grow as its owner builds evidence for more distinct features.

We also tested returning only the prepared feature keys present on the requested titles. On the largest real movie reference the reference read, decode and scoring portion changed from 2.33 to 1.78 ms for one title, and from 2.61 to 3.37 ms for 72. PostgreSQL still unpacked its stored document. With 60,000 extra synthetic cast keys, the targeted read lowered the 72-title median but raised p95 from 51 to 72 ms. The implementation keeps the batched prepared-document read. An unusually large feature dictionary remains a reason to measure read latency and consider physically indexed storage.

Five comparison folds for the one game account produced mixed evidence for the weak duration signal. Ranking held-out games by the owner’s observed playtime improved from 56.51% to 57.26% across 3,586 pairs. Ranking held-out played games against catalogue controls moved from 48.82% to 48.12%. Logged time and provider totals are reconciled per game. A game with a short or unknown duration receives no deduction. A stated dislike takes precedence.

A separate forward-time evaluation trained on dated watch evidence before three cutoffs and compared first subsequent watches with already-released, metadata-matched catalogue controls. Across three qualifying users per medium, held-out movies won 59.07% of 4,020 pairs (201 held movies) and shows won 56.94% of 1,600 pairs (80 held shows). The preceding full-history model produced the same rates. Ranking by other users’ earlier watches reached 65.66% for movies and 70.00% for shows. Those controls measure what users watched next. The copy contained one explicit star rating, so it cannot calibrate a likelihood of liking a title.

Controlled profiles covered sparse and conflicting signals, opposite genre preferences, deliberate return rates and game playtime. Six thousand deterministic comparisons also exercised JSON key ordering, duplicate metadata, prototype-like feature names and singletons. The prepared reference reproduced the prior in-memory evaluation exactly under the same weights. Friend comparison adds tie-aware relative ordering of shared ratings within the existing rating weight. Flat or sparse rating histories continue to use the available absolute-rating evidence.

Box sets and Comic Vine volumes average eligible member scores from a single batch of up to 24 distinct local members spread across release order. Coverage requires at least two scored members and half of the sample. The copied catalogue had 737 box sets and 10 comic volumes. Resolving the largest tested box set’s membership took 0.431 ms and selected 24 of its 27 titles. Desktop and mobile browser checks of synthetic box-set and volume details observed zero taste requests before opening the control and one group request after opening it.

## Pre-merge checks

A prepared reference with no comparable features still supplies its owner's history summary. The worker skips candidate warming for that medium. A one-title regression fixture previously wrote three unusable candidate rows; it now writes zero and gives the same insufficient-evidence response on demand. Profile summaries, signal pages and item reads check the current medium and personalisation permissions in the query returning the data.

Verified music credits take precedence when a candidate also has name-only credits. A controlled mixed-credit fixture previously scored 55% despite a known dislike for the verified artist. Correctly attributing the evidence moved it to 38%. Reading imports store subject evidence once, including on refresh. TMDB series creators retain their credited role in metadata; only a separate writing credit contributes to writer affinity.
