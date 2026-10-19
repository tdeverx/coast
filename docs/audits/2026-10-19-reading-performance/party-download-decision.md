# Unlimited downloads and reading parties

**Historical decision:** the later [shared server-delivery implementation](server-delivery.md) supersedes whole-archive browser download for remote comics. Preserve this record of the earlier accepted tradeoff.

## Accepted temporary behavior — 19 October 2026

The user explicitly chose to retain automatic reading-party downloads without a compressed-file download cap: joining a party expresses their intent to view the host's selected item. Do not add a per-edition confirmation or restore the cap in this pass.

PR security review identified a P3 resource-exhaustion tradeoff: a joined host can switch to a very large mutually authorized comic, causing each guest's automatic follow behavior to allocate the whole compressed archive. Access checks and extraction budgets do not bound compressed input. **This risk is accepted temporarily, not fixed or disproved.** Existing per-participant source access, edition/revision, cancellation and extraction safeguards remain.

The user directed the next investigation to a **Coast-server temporary disk cache with on-demand page delivery**, documented as immediate item RD-09 in the [delivery roadmap](investigation-roadmap.md#immediate-next-investigation). Coast should download the authorized file from networked Jellyfin, serve requested pages and release temporary storage after the last active reader closes, with expiry/crash cleanup. No Jellyfin plugin is required for this candidate. It is deferred from this PR, pending real-data comparison and a reviewed implementation.

The earlier per-item confirmation proposal was declined. Automatic party following remains unchanged.
