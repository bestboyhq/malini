# 0079 - Agents name the keys a file they open needs

Status: superseded by 0139

## Context

`files_open` (0064) opens a secrets file for the user, empty when it is new, and the agent says in its report what goes in it.
The user still had to type every key name and was "not sure what secrets are expected from me"; they asked that the agent "could put secret keys into the file".
The agent cannot do it itself: it must never read or write a secrets file, and the user's `guard-secrets` hook refuses any command that names one.
Malini's main process already opens and creates that file for the agent, and never hands its contents back.

## Decision

- `files_open` takes an optional `keys`, a list of up to 100 names matching `^[A-Za-z_][A-Za-z0-9_]*$`, checked by the bridge's zod schema and again by `openFileForUser` before it creates or changes anything.
- `openFileForUser` in `src/lib/extensions/platform/opened-files.ts` reads the file, counts a key as set when a line starts with it and `=`, optionally after `export `, and appends `KEY=` for each named key the file does not set yet, after a newline when the file lacks a final one.
  `appendFile` keeps the file's mode, so a private file stays `0600`.
- The tool still returns only `{ path, created }`, so the agent never learns which keys the file already had.
- The agent instructions tell agents to name every secret they need in `keys` and to say in `Needs:` what goes in each.
- Bridge and app ship together and the field is optional, so the bridge protocol stays at 40.

## Consequences

- The user opens a file that already lists what to fill in, one `KEY=` line per secret.
- A value spanning lines that holds a line like `NAME=` counts as setting `NAME`, so Malini adds nothing for it; it never removes or rewrites a line.
- Enforced by `opened-files.test.ts` (adds only missing keys, keeps the contents and mode, refuses a key that is not a plain name) and `browser-tools.test.ts` and `instructions.test.ts` in the bridge, and by `tests/e2e/file-editing.spec.ts`, where an agent opens a secrets file with a key and the user types its value after it.
