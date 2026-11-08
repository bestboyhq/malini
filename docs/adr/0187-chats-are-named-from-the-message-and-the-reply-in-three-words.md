# 0187 - Chats are named from the message and the reply, in three words

Status: accepted

## Context

Someone who uses Malini told the user that the default workstream names are weird, and the user agreed.
A new workstream got one of 100 random word pairs, such as "Electric Arc", and agents quoted that name in reports before it changed.
Name chats saw only the first message, so "yo" became "Greeting message" and a screenshot with "what the fuck?" became "Confused exclamation".
When Haiku failed, or gave more than the bridge's five words, the first words of the prompt became the name, such as "Give me gh source url"; the user's log held 15 such failures.
On the user's real prompts Haiku gave more than three words for 35 to 48 percent of names, and asking it again did not make them shorter.
The user picked the fix: "build the reply-aware namer, the retry, a 3-word limit and "New workstream"".

## Decision

- A new workstream is **New workstream**, or **New workstream N** when that name is taken in its repository (`uniqueWorkstreamName` in `src/lib/shared/repositories/domain/workstream-names.ts`).
  `isPlaceholderWorkstreamName` and `isPlaceholderChatName` (`src/lib/chat/domain/chat-names.ts`) say which names still wait for Name chats.
- `ChatNamer` in `src/lib/chat/platform/agent/naming.ts` names a chat and its workstream twice.
  When you send a message, it names whichever of the two still has a placeholder, from `<message>` alone.
  When **Turn finished** fires for that turn, it asks again with `<message>` and `<reply>`, the run's summary, and replaces the names it gave from the message alone.
  A name you or a pull request gave is never replaced.
- Naming retries: a turn with no task, a `none` answer or a failed call leaves the placeholder, and the next message or turn end tries again.
  There is no first-words fallback.
- `chatName` keeps three words at most: past three, it cuts before the first connector such as "for" or "in" at the third word or later, then keeps the last three words and drops dangling words at both ends.
  It returns nothing for `none` and for a name made only of words such as greeting, question or screenshot.
- Naming is one job at a time per chat, and a job writes only when the name is still the one it read, so a rename you make while Haiku works wins.
- `workstreams_create` names the workstream from the agent's prompt before it returns, so the agent reports the name the sidebar shows; the chat's own naming leaves that name alone, which changes the "generated name until the prompt is sent" consequence of 0063.
- The bridge's cap in `packages/agent-bridge/src/claude/titles.ts` grows to seven words and 60 characters, so a long answer reaches `chatName` instead of failing; `parseServiceName` keeps Name services at five words and 40 characters itself.
- A migration in `src/main/db/migrations.ts` renames every word-pair workstream to **New workstream** or **New workstream N** and gives Name chats the new instructions, unless you edited them.

## Consequences

- A chat whose first message is "hi" stays **New chat** until a turn has a task, instead of a name about greeting.
- Each named turn costs a second Haiku call at turn end, once per chat.
- The names given from a message alone live in memory, so a restart during the first turn keeps them instead of naming from the reply.
- Enforced by `chat-names.test.ts` (the cut, `none` and the no-task words), `workstream-names.test.ts` (the placeholder), `commands.test.ts` ("names the chat and the workstream from the message, again from the reply…", "keeps New chat and New workstream while a turn has no task…", and the pull request name, automation and " 2" cases), `migrations.test.ts` ("renames the word-pair names to New workstream…"), `tests/e2e/chat-names.spec.ts` and `tests/e2e/agent-workstream-chat.spec.ts`, which sees the name while the workstream is still **Setting up**.
