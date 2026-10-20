---
name: adr
description: Record an architecture decision for Malini in `docs/adr/`. Use when a change makes or reverses a decision about a boundary (process, domain, layer), a protocol (the command and event contract, the bridge protocol), a pipeline (build, test tiers, release), a tool or dependency, or an outbound call; or when someone asks why Malini is built a certain way and no ADR answers it.
---

# Architecture decision records

`docs/adr/` holds one decision per file, `NNNN-kebab-title.md`, numbered in order and listed in `docs/adr/README.md`.
An ADR says why; `AGENTS.md`, `.agents/rules/` and `docs/` say what is true now.
Features, fixes and migrations inside an existing decision need no ADR.

## Write one

1. Read `docs/adr/README.md`.
   An ADR that already covers the area is either still true, and needs nothing, or being reversed, and gets superseded in step 4.
2. Take the next number and write `docs/adr/NNNN-kebab-title.md`:

   ```markdown
   # NNNN - Title in plain words

   Status: accepted

   ## Context

   The forces at play: constraints, goals, what hurt. Three to six sentences.

   ## Decision

   What malini does, concretely: files, commands, env vars, values.

   ## Consequences

   What became easier, what became harder, what must now stay true, and the check that enforces it.
   ```

3. Add a row to the table in `docs/adr/README.md`: the number linked to the file, and the decision in one line.
4. Superseding: keep the old ADR's text, set its status to `superseded by NNNN`, and open the new ADR's context with what changed.
5. In the same change, update whatever states the "what": `AGENTS.md`, the rule in `.agents/rules/`, `docs/packaging.md`.
6. `corepack pnpm exec prettier --write docs/adr`, since `pnpm lint` checks Markdown too.

Done when the ADR, its index row and every "what" document agree.

## Rules

- Ground every reason in the code, the history or the user's words.
  A reason you cannot find is a question for the user.
- Name the enforcer: the lint rule, test, `pnpm check` step or CI workflow that fails when the decision is broken.
  When nothing enforces it, say so.
- Status is `accepted`, `superseded by NNNN` or `deprecated`; an accepted decision is never rewritten.
- One sentence per line.
