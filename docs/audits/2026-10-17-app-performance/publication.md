# Public audit evidence and private originals

The public PR contains application code, maintained tests, current reports and a portable archive of historical protocols/source/numerical evidence. The separate Comic Lab experiment is excluded. This keeps the application diff reviewable instead of exceeding GitHub's file-list limit.

## Unpack the verification archive

Install the exact frozen dependencies and generate the SvelteKit config first (`bun install --frozen-lockfile`, then `bun --bun svelte-kit sync`). The integrity checker fingerprints those installed files. From the repository root:

```sh
tar -xzf docs/audits/2026-10-17-app-performance/verification-artifacts.tar.gz -C docs/audits/2026-10-17-app-performance
python3 docs/audits/2026-10-17-app-performance/verify-report-integrity.py --output /tmp/coast-audit-integrity.json
```

The [publication manifest](artifact-publication.json) records the archive checksum and each explicit projection/omission. Historical artifact links in reports resolve locally after extraction. Unpacked directories are ignored by Git; the archive and manifest are committed. Source/protocol snapshots, numerical observations, rejected trials and native assertion outcomes retain their original epochs. No old runtime test is rerun by unpacking or checking hashes.

## Private verification images

All **87** actual-account/catalogue/content verification images are retained locally and excluded from the public archive. Some show private friend/account activity or substantial content; no image is claimed anonymous merely because OCR found no email. Public reports link here in place of embedding them. Their original SHA-256 hashes and sizes remain in the manifest. The public integrity check reports these as declared omissions, not verified image bytes.

## Actual personal state

Three receipts have explicit public derivatives. Continue/Undo's **56** tracking/queue/rewatch subtrees and two party receipts' participant arrays are replaced with ordered canonical hashes, row counts and byte lengths. Original full receipts remain private. Other checks, timing samples, buffers, counts and source fingerprints remain unchanged. A published derivative is not the full original DTO; original receipt hashes remain attributable and public projection hashes are verified separately.

The bounded publication review found no live credential/email literals; historical localhost/example credentials and authored fixture literals are labeled by their source context. No actual database credential, key, database dump or private recovery checkpoint is included. Future edits must repeat concrete publication review before repackaging; do not publish new raw actual state or screenshots by default.

Run `package-artifacts.py` only from reviewed retained originals, or from the already projected extracted archive with its matching manifest. It packages the named artifact directories, omits images and applies the exact current personal-state projection. New shapes fail for review. Regeneration is packaging, not performance validation.

## Excluded experiment

The independent `experiments/comic-lab` prototype and its rollback archive remain local and are not part of this application PR. Historical read-only observations are retained, but links to that separate working prototype are redirected here. No Comic Lab implementation or source certification is included in this delivery.
