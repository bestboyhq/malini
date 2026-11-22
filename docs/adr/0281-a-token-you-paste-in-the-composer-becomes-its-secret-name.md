# 0281 - A token you paste in the composer becomes its secret name

Status: accepted

## Context

Since 0141 a secret is a name to the agent, but only when the agent asks for it on a card.
A token the user pastes straight into the composer went to Claude as typed, into the transcript and the draft on disk, and from there into commits and pull request text.
The user asked for Malini to treat what they type as possibly sensitive, and picked "Swap on paste" from two prototypes: Malini hides the token at once, and Undo puts it back.
They then weighed a tooltip that only offers **Add to keychain**, and kept the automatic swap.
Every saved secret is set in each command of the repository's chats, so a paste saved as `GITHUB_TOKEN` would switch the account `gh` signs in with in all of them.
The composer runs in the renderer, which reaches the keychain only through the typed bridge (Rule 4), and a draft is persisted on every change, so the raw value must not land in the editor before it is sealed.

## Decision

`apps/malini/src/lib/chat/domain/pasted-secrets.ts` finds secrets in pasted text: bounded shapes of GitHub, GitLab, Anthropic, OpenAI, Stripe, Slack and Google API keys and private key blocks, and `NAME=value` lines whose name reads as a secret, with placeholders, public keys and values under eight characters left alone.
Each name it gives starts with `PASTED_`, after the service of the shape or the name on the line, so a paste never takes the name of a variable a tool reads.
`InlinePromptEditor` checks `text/plain` in `handlePaste` after attachments; a hit holds the paste as a pending chip with a lock, and the raw text never enters the document.
`keepPastedSecretsCommand` seals each value through the new `secrets.keep` command, then the composer lands the text with `$NAME` in place of each value where the chip was.
A paste whose chat the composer left lands at the end of that chat's draft.
`secrets.keep` in `src/lib/secrets/platform/register.ts` resolves the workstream's repository, returns the name that already holds the same value among the secrets reaching it, and otherwise saves under the first free name (`PASTED_GITHUB_TOKEN`, `PASTED_GITHUB_TOKEN_2`, ...), never over a saved value.
It emits `secrets:saved` with no request and no session, so running chats of the repository get the value and no "Saved" prompt goes out.
A row in the composer tray, `PastedSecretRow.svelte`, says where the token went; **Undo** writes the raw value back into the draft and deletes a secret this paste created with `secrets.delete`, and **Hide it** seals it again.
The `SecretMarks` editor plugin draws a kept `$NAME` as a chip with a lock and a raw value after Undo with a wavy warning underline.
Sending waits while a secret paste is held.

## Consequences

A token pasted in the composer reaches Claude, the transcript and the draft only as `$NAME`, and commands get the value through the shell prefix of 0141.
Typed tokens, drops and text the agent reads from tools are not caught; masking token shapes in tool output is a separate decision.
Undo is the one path that writes the raw value into the draft, and so to disk.
Detection is pure and unit tested in `pasted-secrets.test.ts`, the keep handler on real SQLite in `register.test.ts`, and the flow end to end in `tests/e2e/secrets.spec.ts`, which fails when the token reaches the user data folder before Undo, the composer, the transcript or the sent message, or misses the bridge.
