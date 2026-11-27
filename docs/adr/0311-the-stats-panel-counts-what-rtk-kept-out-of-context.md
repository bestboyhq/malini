# 0311 - The Stats panel counts what RTK kept out of context

Status: accepted

## Context

0248 points `RTK_DB_PATH`, `RTK_RECALL_DB` and `RTK_TEE_DIR` at `$TMPDIR/malini-rtk`.
RTK writes a row to `history.db` for each command it shortens, with the tokens before and after, but Malini showed none of it, so the user could not see what **Trim command output** does.
macOS runs `dirhelper` at 3:35 every day with `CLEAN_FILES_OLDER_THAN_DAYS=3` (`com.apple.bsd.dirhelper.plist`), so a Mac that runs no agent for three days loses that history.
Malini's own data folder cannot hold it: RTK runs inside the agent's sandbox, and the sandbox refuses every agent write into Malini's data (0193).
This record replaces the "Its own data" bullet of 0248; the rest of 0248 stands.

## Decision

- `RTK_DATA_FOLDER` in `packages/agent-bridge/src/sandbox.ts` is `~/Library/Caches/malini-rtk`, a folder the sandbox profile already writes (`CACHES`).
  `compact.sh` points `RTK_DB_PATH`, `RTK_RECALL_DB` and `RTK_TEE_DIR` there, and `RTK_TELEMETRY_DISABLED=1` stays.
- Nothing moves the old `$TMPDIR/malini-rtk`: the count starts again, and macOS clears the old folder.
- The main process answers `stats.trimmed-output` from `lib/stats/platform/trimmed-output.ts`, with the same `RTK_DATA_FOLDER`.
  It opens `history.db` with Malini's own driver only when the file exists and runs one `SELECT`.
  A read-only connection cannot open the file, since RTK keeps it in WAL mode and its `-shm` file is gone while no RTK runs.
- It counts as the headline of `rtk gain` does: only rows with `input_tokens` of 7,500 or fewer, saved tokens never below 0, grouped by the first word of `original_cmd`, the top five by tokens saved.
  It answers `null` when the file is missing or holds no such row.
- RTK deletes rows older than 90 days, so the card says **last 90 days**.
- The Stats panel loads it each time it opens and shows the **Kept out of context** card under the heatmap, and no card while the answer is `null`.

## Consequences

- The history survives idle days and restarts; a user or a cleaning tool that empties `~/Library/Caches` starts the count again.
- The tee files of full outputs stay there too, and RTK keeps only the newest 20.
- An agent can write the history, since the sandbox writes the caches, so the card is a count on this Mac only and never goes to the public profile.
- A newer RTK that renames the table or a column makes `stats.trimmed-output` fail, and the panel logs it and shows no card; moving to a newer RTK checks the schema in `trimmed-output.test.ts` against it.
- The bridge and the main process read one constant, so they cannot look in different folders.
- Enforced by `lib/stats/platform/trimmed-output.test.ts` (the 7,500 cap, the floor at 0, the grouping, `null` without a history) and `tests/e2e/stats.spec.ts` (no card without a history, then its totals, rows and a row's detail once one exists).
