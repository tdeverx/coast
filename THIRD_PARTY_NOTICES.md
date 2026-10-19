# Third-party notices

Coast is licensed under AGPL-3.0-only. Direct application dependencies include Drizzle ORM (Apache-2.0), Valibot (MIT), hls.js (Apache-2.0), Svelte/SvelteKit (MIT), Tailwind CSS (MIT), and Hugeicons (MIT). Bun and PostgreSQL retain their respective upstream notices. Inter uses SIL OFL-1.1; its license is included at `static/fonts/Inter-LICENSE.txt`.

This file records known notices; it is not a complete software bill of materials. Before a stable release or third-party redistribution, generate and review a complete SBOM for the resolved production dependency tree and container, and include all notices required by those exact versions. Preserve upstream notices and provide the corresponding Coast source and build instructions with distributed copies.

UI icons use Hugeicons' free Stroke Rounded set (`@hugeicons/core-free-icons`) and its Svelte renderer (`@hugeicons/svelte`), both MIT licensed, copyright 2025 Hugeicons. Their shared MIT notice is included at `static/licenses/Hugeicons-MIT.txt`. Only the free packages are distributed; no Pro assets are included. Coast's brand mark is the user-supplied asset, separate from the UI icon library.

The optional CBR/CB7/CBT reader uses `libarchive-wasm` 1.2.0 (MIT). Its WebAssembly runtime reports libarchive 3.7.7, zlib 1.3.1, liblzma 5.6.4 and bzip2 1.0.8. Their upstream notices and source links are retained in `static/licenses/reading-archives.txt`; the BSD, zlib, public-domain and bzip2 terms are compatible with Coast's existing AGPL distribution. The decoder runs only when one of those formats is opened, in a disposable worker. No project licence is changed.

The physical book/comic presentation uses Three.js 0.186.1 (MIT), copyright 2010–2026 three.js authors. Its complete upstream notice is retained at `static/licenses/three-MIT.txt`. The MIT terms permit its inclusion in Coast's existing AGPL-3.0-only distribution. No project licence is changed.

Contributions are accepted under the same AGPL-3.0-only license. Coast does not require a separate CLA or claim an additional proprietary license.

TMDB, Jellyfin, Trakt and Seerr are independent services. Their names are used to identify integrations. Metadata and artwork remain subject to their providers' terms. This product uses the TMDB API but is not endorsed or certified by TMDB.
