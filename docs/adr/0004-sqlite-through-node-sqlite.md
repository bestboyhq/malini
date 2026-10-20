# 0004 - Local state in SQLite through `node:sqlite`

Status: accepted

## Context

Malini's state is relational: repositories, workstreams, chat sessions and their events, checkpoints, jobs, routines, settings, and the Docker containers it owns.
It is written by one process and has to survive a crash in the middle of a run.
A native SQLite addon has to be rebuilt for every Electron ABI and cannot be inlined into the `out/` bundles that packaging relies on (`docs/packaging.md`).
The Node that Electron bundles ships `node:sqlite`.

## Decision

- One database file, `malini.sqlite`, in the app data folder.
- `src/main/db/driver.ts` opens it with `DatabaseSync` from `node:sqlite`, with foreign keys on, WAL, and `synchronous = NORMAL`.
- Only the main process touches it; each domain's `platform/*.repository.ts` files own its SQL.
- Schema changes are numbered migrations in `src/main/db/migrations.ts`, tracked by `PRAGMA user_version` and run in one transaction at boot by `openMigratedDatabase`.

## Consequences

- No native module to rebuild or package; the SQLite version is the one Electron ships.
  `apps/malini/tests/e2e/window.spec.ts` checks the built app reports it through `app.runtime-info`.
- Queries are synchronous and run on the main process, so they have to stay small and indexed.
- A migration, once released, is never edited; a fix is the next migration.
  `src/main/db/migrations.test.ts` covers upgrades from earlier versions.
