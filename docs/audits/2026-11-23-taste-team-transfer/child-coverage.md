# Could an episode or season rating supply a new creative-team dislike?

A read-only count on the copied account found 47 episode ratings and one season rating across 14 shows. All 48 originated in Trakt. Only two episodes received at most 2½ stars. They belonged to different shows; neither had a second negatively rated episode. The one season rating was above that threshold.

The frozen taste input gives all 14 parents a displayed rating. Checking actual stored root opinions was necessary: two shows had no direct show rating, even though the taste input supplied a parent estimate. Those two accounted for 16 episode opinions and no season opinions. Neither had exclusively negative child ratings. On the current capture neither qualified as a uniformly enthusiastic donor (all at least 4½ stars across three episodes or two seasons) either.

The proposed negative rule needs at least three different negatively rated episodes across rating days or two negatively rated seasons, with no conflicting opinion and no existing direct root rating. **Zero parent shows meet even the numerical minimum** before applying dates, root exclusions, genre or creative-team matching. No possible original rating mask or chronological cutoff can create a third low episode or a second low season in this snapshot. All 32 original holdouts would mechanically retain their scores. This measures absence of an eligible example; it cannot establish how well the rule would generalise for another viewer who rates episodes extensively.

The root-rating holdout may never recover its hidden opinion from its own children. A zero-rating mask would remove episode and season opinions as well. The frozen child records contain only child ID and personal rating. No ingestion timestamp was substituted for the original rating day. Original Trakt child dates would be needed for a new, adequately populated forward evaluation.

Run the [aggregate coverage query](child-coverage.ts) with the local development database URL and account name. It connects only to the isolated experimental copy, uses a read-only transaction and returns counts without work or account IDs.

```sh
bun --env-file="$private_dev_env" child-coverage.ts "$viewer"
```
