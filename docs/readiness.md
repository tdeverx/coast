# Preview readiness

**Status: early testing preview.** Coast is under active development. This repository starts with fresh source history, a fresh version tag and a fresh installation. There is no migration path from the deleted prototype; old databases and images are not compatible upgrade sources.

The local source builds as a Bun/SvelteKit application and includes Docker Compose support for bundled PostgreSQL or an external PostgreSQL database. The GitHub Actions workflow runs type checks, the default test suite and a production build. Successful pushes to `main` publish a multi-platform preview image to GHCR; version tags get their own image tag. Treat images as previews, keep backups, and expect breaking changes.

## Before relying on Coast

- Trakt account linking and real account sync need deliberate user testing.
- Seerr request creation, cancellation and partial-season updates need user testing.
- Docker Engine/Compose, LAN access, backups and recovery should be verified in the intended installation environment.
- Review the provider documentation and release notes before upgrades.

Tests that use databases or provider accounts must use disposable databases and intentional test accounts. Coast does not seed provider credentials or personal history during setup.

See the [product brief](brief.md), [architecture](architecture.md), [provider behavior](providers.md), [design system](design.md), and [deployment guide](deployment.md) for implementation details. These documents describe the current codebase; historical checkpoint notes are evidence from their dated runs, not certification of the current preview.
