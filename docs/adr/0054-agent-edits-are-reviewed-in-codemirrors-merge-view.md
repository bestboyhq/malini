# 0054 - Agent edits are reviewed in CodeMirror's merge view

Status: accepted

## Context

0053 has the user review an agent's edit to a job's instructions change by change, with **Accept** and **Reject** on each change and the text editable throughout, the way Cursor reviews agent edits.
Malini had a read-only diff viewer fed by git (`DiffViewer.svelte`) and TipTap editors for prose, but nothing that diffs two strings and stays editable.
Per-change accept and reject on an editable surface means tracking chunks against an original that moves as the user accepts, which is most of an editor.
`@codemirror/merge`'s `unifiedMergeView` does exactly this: chunks against an original document, `acceptChunk`, `rejectChunk` and `getChunks`, on an editor that keeps working.

## Decision

- `@malini/hyper-ui` depends on `@codemirror/merge`, `@codemirror/state`, `@codemirror/view` and `@codemirror/commands`, and exports `MergeEditor` from `$hyper-ui/components/merge-editor`.
- `MergeEditor` takes `original`, a bindable `value` and a `label`; it renders the unified merge view with history and the default keymap, a change count, **Accept all** and **Reject all**, and per-chunk buttons named `Accept change` and `Reject change`.
- Its look is a CodeMirror theme in `merge-editor-theme.ts` built from design tokens (`--code-added`, `--code-removed`, `--font-mono`), because CodeMirror's unlayered base theme outranks any rule in a Tailwind layer.

## Consequences

- Any text an agent proposes to change, such as a skill or `CLAUDE.md`, can reuse the same review.
- The renderer bundle carries CodeMirror's editor core and merge view.
- Restyling the merge view goes through the theme extension, not CSS files.
- Enforced by `tests/e2e/agent-actions.spec.ts`, which rejects one change, accepts another, types into the editor and checks the saved text; nothing lints the dependency itself.
