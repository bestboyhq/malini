# 0254 - GitHub clones skip big files below 1 GB

Status: accepted

## Context

0098 cloned a GitHub repository without file history only at 1 GB or more, so every smaller one downloaded all of its history first.
A no-tools run (Nov 2026) picked `bestboyhq/grip`, 584 MB on GitHub, and its first copy took 70 seconds, the longest wait between a click and a workstream.
Simon asked for blobless copies below 1 GB too, so the first copy of grip is faster.
Measured on grip from this Mac: a full clone took 64 s and 741 MB, `--filter=blob:none` 16 s and 266 MB, and `--filter=blob:limit=1m` 18 s and 296 MB.
Blobless had a cost 0098 named: the first `git blame` of a source file took 11.5 s instead of 0 s, because every old version came over the network.
In grip, 85 files of 1 MB or more hold 576 MB of its 607 MB of file history, and the 2,172 files under 100 KB hold 4 MB.

## Decision

- `createRepository` in `workstreams.service.ts` clones a GitHub repository with no seed folder below 1 GB with `--filter=blob:limit=1m`, `LARGE_FILES_FILTER`.
  At 1 GB or more it keeps `--filter=blob:none`, as 0098 says.
- `ensureBaseCloneWithOutcome` takes the filter as `blobFilter` in place of `blobless`, and keeps the `gh auth git-credential` helper for both filters.
- A clone from a folder on this Mac takes no filter, as before.
- An unknown size counts as below 1 GB, and a server without partial clone ignores the filter and sends everything.

## Consequences

- The first copy of a GitHub repository whose size sits in big files gets as fast as a blobless one: grip goes from 64 s to 18 s.
- Old versions of files under 1 MB stay on disk, so `git blame` and `git log -p` on source code need no network.
- The first read of an old version of a file of 1 MB or more needs the network and a `gh` sign-in: a `git log -p -20` over grip's binaries took 23 s the first time.
- Free space still counts the full size below 1 GB, so a filtered clone never starts with less room than before.
- `clone.service.test.ts` fails when a clone stops storing either filter or the GitHub sign-in for the blobs it fetches later.
- Nothing checks the 1 MB and 1 GB lines themselves.
