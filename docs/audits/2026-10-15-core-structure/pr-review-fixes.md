# PR 30 review corrections

The two review findings and PostgreSQL 17 CI failure on `f159315` were checked against their actual route and session contracts.

- Explicit reading searches (`view=read`) now pass their validated kind/page to both the initial local lookup and streamed provider lookup. Unified Search still gathers all enabled reading types for its existing local row segments. A regression checks disjoint local pages, provider page/type arguments, and retained unified comic results when the initial segment selects books.
- Activity profile backgrounds now include reading-started/completed transitions and use the shared enabled-category SQL guard. The regression checks book/comic covers, chronological selection, disabled experiments, guest/visitor visibility, progress privacy and private categories.
- The idle shared-viewer fixture claimed four viewers concurrently and then expired whichever row sorted first by creation time. That could be the viewer rejected by bandwidth admission, which had no encoder to stop. It now expires a known admitted viewer and deliberately makes the rejected claim oldest, preserving all encoder-stop, slot-release and history assertions. Production admission/cleanup rules are unchanged.

Validation on Bun 1.4.3: 56 disposable database tests passed across profile, reading and sharing suites; 449 regular tests passed; typecheck has zero errors/warnings. UI inventory, source-style and whitespace checks passed. The disposable database container was restored to stopped. No dev/live data or services were used.
