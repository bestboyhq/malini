# 0270 - Errors are typed, decided at compile time, and fingerprinted

Status: accepted

## Context

0263 and 0266 made an error line name its kind, its throw site and its moment, but the field log of Malini 0.131.0 was still unreadable.
One Mac sent six commands failing together as `GitError (git)` and `GhError (failed)`, and `workstream-files` repeated 147 times in 4 minutes.
Nothing said which git subcommand failed, how git ended or what git said, so the cause stayed unknown.
654 sites in main-process code still threw a plain `Error`, and `EXPECTED_FAILURE_KINDS` in `main-diagnostics.ts` listed only the kinds someone had remembered.
`read-base-branch` sent an empty repository, a state the user fixes, as an error.
Lines had no stable key, so the same failure from two releases could not be grouped.
The user asked for "no field error is unreadable, silent or repeated" and approved sending a template of a git message Malini does not recognize.

## Decision

- Every named error in main-process code extends `MaliniError` in `src/main/errors.ts`.
  It carries `name`, `kind`, `verdict`, `code` and `facts`, and it starts its stack where it was thrown, with `Error.captureStackTrace(this, new.target)`.
- Each class owns a verdict table beside it, typed `as const satisfies ErrorVerdicts` and spread from `SHARED_ERROR_VERDICTS`, so its kind union is the keys of that table.
  `SHARED_ERROR_VERDICTS` holds `invalid-argument` and `invariant`, both `bug`.
  A kind without a decision does not exist, so `pnpm check` fails on one.
  Domain boundaries keep each table in its own slice, which is why there is no single central table.
- A verdict is `expected`, a state the user or the Mac must fix, or `bug`, one Malini must fix.
  An error that wraps a `MaliniError` whose verdict is `expected` is `expected` too, and it keeps the facts of its cause when it has none of its own.
- `failureLevel` in `src/main/diagnostics/main-diagnostics.ts` reads only the verdict and the codes `ENOSPC` and `EDQUOT`.
  An `expected` failure logs as a warning and is not sent; everything else is an error and is sent.
  `WorkstreamError` gains `empty-repository` and `no-default-branch`, both `expected`.
  `GitError` `not-a-repo`, `branch-exists` and `git-unavailable`, and `GhError` `no-pull-request`, became `expected`.
- `@malini/desktop/no-untyped-throw` in `packages/eslint-plugin-hyper-ui` rejects `new Error(...)` and the other built-in errors, and a class that extends one, in `src/main/**`, `src/lib/**/platform/**` and `*.platform.ts`, outside tests.
  A built-in error is allowed only as the `cause` of another.
- `GitError.commandFailed` and `GhError.fromStderr` give their failures facts from closed lists in `src/main/failure-facts.ts`:
  - `subcommand`, from `GIT_SUBCOMMANDS` or `GH_SUBCOMMANDS`, else `other`;
  - `exit`, or `signal` for git, from the names in `os.constants.signals`;
  - `said` for the catch-all kinds `git` and `failed`, picked by `gitSaid` or `ghSaid` from ordered patterns, else `unrecognized`.
- For `said: unrecognized`, a git failure also carries `template`: the last `fatal:` line, else the last `error:` line, with every quoted span and every token outside `GIT_MESSAGE_WORDS` replaced by `_`, at most 160 characters.
  The user approved this, because without it the next unknown failure is as unreadable as the 0.131.0 burst.
- `errorLine` in `src/lib/app/platform/usage-data.ts` writes the facts under `error`, after `sendableFacts` in `error-facts.ts` drops every key and value outside its closed list.
- Each line carries `fingerprint`: the first 12 hex characters of SHA-256 over the command or scope, the error name, code, kind, `said`, and the stack files without line numbers, from `errorFingerprint`.
  The repeat line carries the same fingerprint.

## Consequences

- A new failure names its subcommand, how git or gh ended and what it said, so the next burst like 0.131.0 names its cause.
- The same failure keeps one fingerprint across releases while its throw site stays in the same file, so lines group by fingerprint.
- Every new error forces a decision: expected states stay out of Logdash, and bugs reach it.
- Adding a `said` value is one pattern and one list entry; the template shows which pattern to add.
- A template can hold only words from a bundled list and `_`, so it carries no path, name, number or remote text.
- Moving a throw to another file changes its fingerprint.
- `pnpm lint` fails on a new untyped throw in platform code.
- `src/main/errors.test.ts` fails when a listed message falls back to `unrecognized`, when a template keeps a word outside the list, or when a wrapper loses an expected verdict.
- `src/lib/app/platform/usage-data.test.ts` fails when a line loses its fingerprint, when the fingerprint follows a line number, or when a fact outside its closed list is sent.
- `src/main/diagnostics/main-diagnostics.test.ts` fails when an expected state logs as an error.
