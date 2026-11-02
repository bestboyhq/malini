# 0152 - Every chat keeps its own setup, and a new chat starts from your last pick

Status: accepted

## Context

The composer remembered the model once per mode in `malini.chat.model-memory:v2`, and the effort, plan mode, access and report once per workstream, and every pick, send and chat switch rewrote both.
So an effort picked in one chat showed in every other chat of the workstream, and Settings → Models showed that memory instead of saved models.
**New chat** copied whichever chat was on screen, so a new chat took the model and effort of the last chat you looked at.
The user asked for every chat to keep its own setup, and for a new chat to start with what they last picked.
They also asked to save favorite model and effort pairs as presets, where picking a preset restores both and the effort stays easy to change.
A chat's model and plan mode are already fixed by its session: a different model or mode sends the next prompt to a new chat.

## Decision

- A chat's setup is a `ChatSetup`, its `ModelSelection` and `AgentRunProfile`, stored per session in `malini.chat.setup:v1:<sessionId>` by `model-preferences.storage.ts`.
  `sessionActivation.mint` writes it, and so do every pick in the chat, every queued prompt and every delivered prompt.
- Opening a chat shows its stored setup.
  Once the chat has run, its model and plan mode come from its session and the run it made, and only its effort, access and report come from the stored setup.
  A job's chat with no stored setup shows the effort and mode its job ran with, as before.
- Only a pick in the composer, from `selectModelCommand` or `selectRunProfileCommand`, or **Implement plan**, sets what a new chat starts with: `malini.chat.new-chat-setup:v1` holds the model, effort, plan mode and report, for every workstream.
  Access stays per workstream in `malini.chat.profile:<workstreamId>`, so a **Full access** pick never reaches another repository.
  Opening, switching and sending in a chat never change it.
- **New chat**, the first prompt of a workstream, a workstream without chats and a closed last chat all start from `readNewChatSetup`.
  Before the first pick after the update, it reads the old last effort, last report and implementation model.
- The per-mode memory is gone.
  **Settings → Models** shows and saves the planning and implementation models in `malini.providers.model-defaults:v1`; turning plan mode on or off picks that mode's model, and **Implement plan** starts with the implementation model.
- A pick made while a chat is still loading lands in that chat, through `chatModelStore.adoptPreview`.
- A preset is a `ModelPreset`, a `ModelSelection` with its effort, or `null` for a model that takes no effort.
  Presets are kept for every workstream in `malini.providers.model-presets:v1`, the item at the bottom of the model menu saves or removes the pair the chat shows, and the × that slides in beside a preset on hover or keyboard focus removes that preset.
  Picking a preset is a pick in the composer: `selectModelCommand(selection, effort)` sets both and writes the chat's setup and the new-chat setup.

## Consequences

- What you see in a chat is what its next prompt runs with, and other chats never change it.
- A model you pick in a chat that already ran is not kept when you leave, because that chat's model is its session's; the next prompt from there would have opened a new chat anyway.
- Plan mode carries into new chats in every workstream, and access does not.
- `ChatSetup` is the one shape for a chat's setup, so a preset applies through the same per-chat and new-chat writes as any other pick.
- A preset keeps no plan mode, access or report, so applying one never changes them.
- Enforced by `tests/e2e/model-picker.spec.ts` (chats keep their own model and effort across switches and a reload, a new chat starts with the last pick, and a preset sets its model and effort until you remove it), `tests/e2e/prompt-delivery.spec.ts` (another model starts a new chat, and other workstreams start with it), `tests/e2e/jobs-in-chat.spec.ts` (a job chat shows its job's effort), `tests/e2e/agent-bridge-failures.spec.ts` (a chat that cannot open keeps its error and its model to itself), `model-preferences.storage.test.ts` (the storage, access per workstream, and the legacy keys), and `model-presets.storage.test.ts` (saving, removing and reading presets).
