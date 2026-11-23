# Leaving out one complete movie or series

Each forecast rebuilds the calibrated native movie or show model after removing the title's entire personal history record. Series watches and other episode evidence are aggregated at the series root in the frozen input. Deleting that record withholds its watch and completion signals, repeats, drops, ratings and scoped credit evidence together. Other series, including a separately tracked spin-off, retain their own records. The training data are scoped to the requested medium, as in the existing model.

The held title contributes only its ordinary catalogue description at prediction time. The descriptive catalogue reference is the same independent snapshot for every forecast. The personal rating does not enter either the native profile or its display-scale training. This is a retrospective answer to “What would the rest of my history predict?” Other titles can have personal activity later than the held title's historical rating.

The driver checks the scoring source and input digests against the native replay manifest. It first reproduces every movie or series in the original whole-title fold numbered zero (82 movie scores and 75 series scores). It then writes one independent forecast per target to a fresh owner-only JSONL ledger. The final record supplies the count and elapsed time. The command expects the repository root as its working directory.

```sh
bun docs/audits/2026-11-23-hidden-title-audience/native.ts movie CAPTURE CREDIT_METADATA INDEPENDENT_CATALOGUE GRADED NEW_PRIVATE_MOVIE_JSONL
bun docs/audits/2026-11-23-hidden-title-audience/native.ts show CAPTURE CREDIT_METADATA INDEPENDENT_CATALOGUE GRADED NEW_PRIVATE_SHOW_JSONL
```

For selected titles, supply a final JSON file containing objects with a `target` and its `donors` (canonical IDs), with optional `extraExcluded` IDs. The driver rebuilds an additional native model for each donor family after withholding the target, all extra exclusions, and every rated or unrated member of the donor's canonical franchise. These independent donor errors can be used to test whether earlier mistakes on comparable works support changing the target's predicted score. The named diagnostics also remove creator features at prediction time to measure their existing influence in the native baseline.
