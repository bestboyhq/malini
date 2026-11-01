# 0144 - Malini asks bestboy.dev for the marketplace every time, and every hour while anything is installed

Status: accepted

## Context

0142 had Malini read the marketplace index when Extensions opens and at start while anything is installed, as fresh as the platform's `Cache-Control` allows.
bestboy.dev answers `GET /api/extensions` with `public, max-age=300`, and `net.fetch` keeps that answer in Chromium's cache, so for five minutes no read reached bestboy.dev.
In the built app on the live marketplace, the first open of Discover asked bestboy.dev and the next three reads, Published's included, came from the cache.
Published reloads the list after **Publish**, so on bestboy.dev its row kept offering **Publish** for the version just published until the cached list expired; the e2e fake of the platform sent no `Cache-Control`, so its publish test never saw that.
A version its publisher yanked kept running in every chat until Malini restarted or Extensions opened.
The marketplace went live on bestboy.dev with platform pull request 28, so a yank now has to reach every Mac without anyone opening Extensions.

## Decision

- `MarketplaceClient` reads the index and an extension's page with `cache: 'no-cache'`, so every read asks bestboy.dev.
  A package keeps its default caching: the platform marks a version's bytes immutable.
- `ExtensionsPlatform.start()` reads the index at start and then every hour (`MARKETPLACE_REFRESH_MS` in `src/lib/extensions/platform/register.ts`), and `stop()` ends that at shutdown.
  A read still does nothing while nothing is installed, and otherwise turns off yanked versions and installs updates that reach no new host.
- The e2e fake of the platform, `tests/e2e/fake-bestboy.ts`, answers the index with bestboy.dev's `Cache-Control`.
- Still true from 0142: the marketplace API and its packages, installs into Malini's own folder handed to every session as SDK plugins, updates that reach a new host waiting for **Update**, publishing what is committed under your handle, the Extensions page, and the fourth outbound call, read without a token only while Extensions is open or something is installed.

## Consequences

- A yanked version turns off within an hour on every Mac that has it, without a restart.
- Discover, an extension's page and Published show what bestboy.dev lists at that moment, right after **Publish** too.
- Each open of Extensions, and each hour with something installed, costs a full read of the index, since it has no `ETag` to answer 304 with until the platform adds one.
- Enforced by `src/lib/extensions/platform/marketplace.test.ts`, whose fake platform keeps answers the way Chromium's cache does, so its update, withdrawal and offline tests fail without `no-cache`, and by the publish test in `tests/e2e/extensions.spec.ts`, which waits for **Live 1.0.0** after **Publish**.
  Nothing tests the hourly timer itself.
