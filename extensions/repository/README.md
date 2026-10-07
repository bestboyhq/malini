# Repository extension

The first-party Repository extension contributes one **Files** inspector panel through the shared manifest and `@malini/extension-api`.
Changed files and their diffs live in its first, collapsible section; the remaining repository tree follows underneath.
It has no private malini imports.

## Public behavior implemented

- Deterministic file listing, normalization, hidden-file filtering, selection, and refresh
- Public repository status, diff, pull request, and refresh integration
- Line-level unified-patch rendering with host-authoritative addition/deletion counts
- Repository, branch, base branch, and pull request context parsing
- Atomic workstream-context reset so files and selections never leak between workstreams
- Explicit empty, loading, ready, and malformed-context states
- Reload and strict cleanup through normal extension disposables

Run from this directory:

```sh
pnpm check
pnpm test
```

## Public API gaps blocking full product parity

The extension deliberately does not reach into malini internals.
It obtains status, diffs, and pull-request metadata itself through the public API, and every repository and file method takes an optional `workstreamId`.
API v1 still needs the following public capabilities:

1.  Repository subscriptions for file and git changes with coalescing and cancellation.
    The extension can reject its own stale refresh completion, but it cannot cancel adapter work or update live without a generic event convention.
2.  A host-rendered panel UI primitive set (file tree, virtualized list, diff viewer, toolbar, empty and error states, icons, and tokens).
    The current DOM mount contract can prove registration and semantics but cannot guarantee native visual parity without rebuilding host UI.
3.  A panel interaction test surface in `createTestHost()` for mounting, querying, clicking, and asserting captured panel state without a private browser harness.
4.  Typed branch, remotes and history reads, if those surfaces are in the parity scope.
    API v1 exposes status, diff, pull request, refresh, commit, push, pull-latest and restart-on-base, but not those reads.
