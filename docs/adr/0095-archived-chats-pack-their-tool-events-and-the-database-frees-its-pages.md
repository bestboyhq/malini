# 0095 - Archived chats pack their tool events, and the database gives freed pages back

Status: accepted

## Context

After 0094 slimmed the files of archived workstreams, chat history stayed the largest thing Malini keeps: the user's `malini.sqlite` reached 532 MB, 451 MB of it `agent_events`.
Archived chats held 347 of its 362 MB of event text, mostly `tool.completed` (182 MB), `tool.started` (73 MB), `thinking.message` (46 MB) and `command.completed` (42 MB), and agents still read old chats through transcript references and fork transcripts (`listEventRowsForSession`).
On a copy of that database, compressing each row alone reached 2.2x, because most rows are under 1 KB, and left the file at 302 MB after `VACUUM`; one brotli pack per archived chat of its tool and thinking events took them to a fifth, about 330 MB to 66 MB at quality 6 in under 4 s, as small as zstd level 9 through a stable Node API, and left 141 MB.
Many queries read events with SQL by their kind or a field of their JSON (`LIKE 'run.completed' || char(10) || '%'`, `instr`, `json_extract`), so a compressed row must not hide what those queries read.
SQLite never shrinks a file with `auto_vacuum = NONE`, a file switches to incremental auto-vacuum only through a `VACUUM`, and a `VACUUM` in WAL mode leaves a WAL as large as the database until a `TRUNCATE` checkpoint.

## Decision

- `agent_event_packs` (`session_id` primary key referencing `agent_sessions` with `ON DELETE CASCADE`, `events` BLOB) holds one pack per archived chat: a closed chat, or any chat of an archived workstream, saved for later included.
- `packSessionEvents` (`src/lib/chat/platform/event-packs.repository.ts`) moves the chat's `tool.started`, `tool.completed`, `tool.failed`, `command.completed` and `thinking.message` rows into its pack in one transaction: a brotli-compressed JSON list (quality 6, text mode) of `{seq, runId, event, emittedAt}` with each row's exact text.
  Messages, run lifecycle, background state, approvals and every other kind stay rows, so every SQL reader works on archived chats as before.
  A chat with none of those events still gets an empty pack, which marks it packed.
  It packs nothing in a live chat.
- `listEventRowsForSession`, `listEventsForSession`, `listEventRowPage`, `listEventRowsOfKinds` and `toolCallOutput` merge a chat's packed events back in by `seq`, so a packed chat reads the same everywhere.
  `agent_runs.event_bytes` keeps counting packed events, so paging (0024) weighs a run as before.
- `unpackSessionEvents` puts every row back with its own `seq`, deletes the pack and recounts `event_bytes`, which the insert trigger would count twice; it unpacks nothing in an archived chat.
- `chat.archive-session` packs the chat it closes.
  `packArchivedChats` (`event-packs.service.ts`) runs a pass at start and on every `repositories:workstream-removed`: it unpacks live chats that still have a pack, packs archived chats that have none, one chat per turn of the event loop, then calls `db.releaseFreePages()`.
  `restoreWorkstream` calls `unpackRestoredChats` right after `restoreWorkstreamRecord`, in the same turn, so a live chat never keeps a pack that SQL-only readers such as `agentHasReadFile` and `validationEvents` cannot see.
- `releaseFreePages` (`src/main/db/driver.ts`) runs `PRAGMA auto_vacuum = INCREMENTAL; VACUUM;` while the file is not yet incremental, otherwise `PRAGMA incremental_vacuum` when `freelist_count` is not 0, then `PRAGMA wal_checkpoint(TRUNCATE)`.

## Consequences

- The first start after this packs every archived chat and runs one `VACUUM`, which holds the main process for about a second on the user's database.
  On a snapshot of it, the built app packed 783 chats and took the file from 514 MB to 143 MB with an empty WAL 12 s after launch, and each of the 777 packs left after a restore held exactly the rows it replaced.
  After that, archiving or deleting a workstream gives its pages back at once, while the pages a closed chat frees go to the next events written and the next pass gives back the rest.
- Rows of the packed kinds exist for live chats only: a new SQL query over them sees no archived chat, and must read `packedEvents` to reach one.
  A kind joins the packed list only once no SQL reader needs it in an archived chat.
- Reading one packed event decompresses the chat's whole pack, which suits chats that are read rarely.
- A late event of a packed kind stays a row beside the pack, and readers merge both.
- The start pass finds unpacked archived chats by primary key, not by scanning their events, which took 280 ms on a cold cache.
- `VACUUM` keeps every rowid, which the `ORDER BY rowid` queries rely on, as SQLite 3.53 does in Node and in Electron.
- Enforced by `src/lib/chat/platform/event-packs.test.ts` (a packed chat reads back unchanged, a restore puts back every row and byte count, a deleted workstream takes its packs, the start and archive passes pack, unpack and shrink the file), `tests/e2e/packed-chats.spec.ts` (archiving packs, restoring unpacks and shows the full output, closing a chat packs it and leaves the others) and `src/main/db/migrations.test.ts`.
