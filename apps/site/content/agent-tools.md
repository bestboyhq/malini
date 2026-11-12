---
title: Agent tools
description: The tools the agent gets in a Malini chat - a browser it shares with you, secrets it asks you for by name, files it opens for you to fill in, your repositories and workstreams, your automations and events - how often they ask, and where you see every call.
---

In a Malini chat, the agent has Claude Code's own tools plus Malini's.
Malini's tools reach Claude Code through an MCP server named `malini`, so their full names start with `mcp__malini__`.

## Browser

The agent drives the same browser tabs you see in the inspector, and the tabs it opens show up beside yours.
A tab shows up as soon as the agent starts opening its page, and a page that does not load says why, such as `ERR_CONNECTION_REFUSED` while your dev server starts.

| Tool                 | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `browser_open`       | Opens a web page or a file from the worktree.  |
| `browser_screenshot` | Captures the open page.                        |
| `browser_click`      | Clicks the first element a CSS selector finds. |
| `browser_type`       | Types into a field, optionally pressing Enter. |
| `browser_back`       | Goes back one page.                            |
| `browser_forward`    | Goes forward one page.                         |
| `browser_reload`     | Reloads the page.                              |
| `browser_resize`     | Makes the tab wider or narrower.               |
| `browser_close`      | Closes the tab it opened, and its page.        |

When a page is too narrow or too wide for what it checks, the agent calls `browser_resize` with the width the page should get.
Malini moves the divider between the chat and the inspector, the one you drag, and the width stays until you drag it back.
The chat and the inspector keep their minimum widths, so the page may end up narrower or wider than asked, and the agent hears how wide it got.
Only the tab you see resizes: while you look at another tab or workstream, or Malini is hidden, its width stays and the agent hears why.

Once a page has served its purpose, such as after the agent checked or captured it, the agent closes its tab with `browser_close`, and the page closes with it.
It closes only the tab it opened, never one of yours, and the tab stays closed after Malini restarts.
A page you should look at or use, such as a prototype or the variants the agent asks you to pick from, stays open.

You can also pick an element on a page and ask for a change right there.
Malini starts a thread of its own for it, on the model you pick in that box, and remembers that model for the next one; your chat stays as it was.
A pin on the element spins while the thread works, turns amber when it needs you, green when it is done and red when it fails.
Click the pin for your prompt and the thread's outcome.
**Open chat** shows the thread in a tab of its own until you switch away, and **Dismiss** removes the pin and stops the thread.
A page that asks for your microphone or camera asks you first, and Malini remembers your answer until it quits.
The agent's screenshots work while Malini is hidden, minimized, or behind other windows, so you can keep working elsewhere.

### Screenshots in your theme

Screenshots come out in the theme you see Malini in: **Settings > Appearance > Theme**, or your system's when that is set to System.
Pages in the browser follow it through `prefers-color-scheme`.
The agent is told the theme too, so it switches anything else it captures, such as your app's window or a simulator, before it takes the shot.
Commands the agent runs see it as `MALINI_THEME`, `light` or `dark`.
Any other screenshot, recording, or image the agent makes goes under `.context/` in the worktree, which Malini keeps out of git, so it shows in the chat and stays with the workstream.
The agent gives each capture a new name and leaves it there, and Malini keeps its own copy of whatever a chat shows until the workstream is deleted.

## Secrets

A secret, such as an API key, is a name to the agent.
It never sees the value, and you never deal with a file or a path.

| Tool              | What it does                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `secrets_request` | Asks you for secrets by name, on a card in the chat, and says why. It returns to the agent at once. |

- The card shows a password field for each name, over the composer, and takes the focus unless you are typing.
  Paste a value and **Save**.
  Paste `NAME=value` lines, from a `.env` file for example, anywhere in the chat, and they fill every field they name instead of landing in the composer.
  A value of several lines, such as a private key, keeps its line breaks.
- Malini seals the value with your Mac's keychain, for the chat's repository.
  From then on `$NAME` is set in every command the agent runs there, including workstreams you start later and after you archive this one.
- Malini tells the agent what you saved, and which names you left empty, which wakes it when it waits.
- Every output the agent sees, a failing or background command's included, shows the value as `[secret]`, and so does the transcript.
  A value shorter than eight characters is set but not masked.
- **Dismiss** closes the card without saving anything.
- Settings, Secrets lists the names you saved, by repository, with **Replace** and **Delete**.
  Values never show.
- Commands get the secrets through Claude Code's shell prefix, after permissions are checked, so your **Always allow** rules and auto mode see each command as the agent wrote it.
- Masking catches a value as it is, not an encoded one, so an agent that sets out to leak a secret can; what stops that is what it may run without asking.

## Files you fill in

Some files only you should write.
The agent never reads or writes those, so it opens the file for you instead.

| Tool         | What it does                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| `files_open` | Opens a file in a tab beside the chat, where you edit it, at the line the agent names if any. |

- The path is absolute, under `~/`, or relative to the worktree, and the agent says in its report what goes in the file.
- The tab opens kept, not as a preview, so the next file you open never replaces it.
- A file that does not exist yet opens empty, and Malini creates it.
  Outside the worktree it is private to you: the file is readable only by you, and so is a folder Malini creates for it.
- The agent gets back the path and whether Malini created the file, never what the file holds.
- A tab can read and save a file outside the worktree only after an agent opened that file in that workstream, and it keeps that access after you quit and reopen Malini.
- While streamer mode hides personal data, a secrets file or a file from outside the worktree stays hidden behind a **Show** button that names it.

## Repositories and workstreams

The agent can do in Malini what you do from the sidebar, short of removing anything.

| Tool                  | What it does                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repositories_list`   | Lists your repositories: id, `owner/name`, default branch, whether Malini has cloned it, and whether it is hidden.                                                                                        |
| `repositories_clone`  | Adds a repository by `owner/name` or git URL and clones it, or shows a hidden one again.                                                                                                                  |
| `repositories_hide`   | Hides a repository from the sidebar. Its clone and workstreams stay, under **Hidden**.                                                                                                                    |
| `workstreams_list`    | Lists your workstreams: id, name, repository, branch, base branch, the chat that started each one, and which one the chat runs in, with whether each merged. It adds the archived ones this chat started. |
| `workstreams_create`  | Starts a workstream of a repository, cloning it first when needed, with a chat that gets the agent's prompt; with `wake: true`, the turn that prompt starts reaches this chat as a report.                |
| `workstreams_send`    | Sends a prompt into the chat of a workstream this chat started, as a prompt from this chat, once that chat ends its turn; `wake: true` works as it does on `workstreams_create`.                          |
| `workstreams_archive` | Archives a workstream, keeping its branch and uncommitted work under **Recently archived**, where you can restore it.                                                                                     |

`workstreams_list` also says whether a chat in each workstream is on a turn, and the `Outcome:` and `Needs:` its last turn stated, so a chat sees where the work it started stands without reading its code.
In an automation that does not see every chat, `Outcome:` and `Needs:` are always empty.
A clone that takes longer than 40 seconds keeps going in the background, and the agent waits for it by calling `repositories_clone` again.
A workstream the agent starts opens on its new chat, and the sidebar shows it **Setting up** while Malini updates its branch and installs its dependencies.
**Name chats** names the workstream from the agent's prompt before `workstreams_create` returns, so the agent gets that name back.
Once it is set up, Malini sends the agent's prompt as that chat's first message, with the model and settings of the chat that asked, and **Name chats** names the chat from it.
The agent cannot archive the workstream its own chat runs in, and no tool removes a repository or deletes a workstream.

Malini remembers which chat started each workstream.
The sidebar lists the workstream under its repository like any other; its first prompt says **Prompt from** and names the chat, and its agent learns which workstreams that chat started besides, whose checkouts it may read.
A chat that [starts workstreams](/malini/docs/chat.md#work-a-chat-starts) in several repositories works through these tools: it lists the repositories, clones the ones Malini lacks and starts a workstream for each change.

### Work it started runs on its own

A workstream a chat started asks you itself, in its own chat, and its turns do not reach the chat that started it.
The agent reads where that work stands with `workstreams_list`.
When its next step needs a result, it passes `wake: true` to `workstreams_create` or `workstreams_send`, and the turn that prompt starts reaches the chat as a report, through the [Deliveries rule](/malini/docs/automations.md#reconciler): its `Outcome:`, its `Needs:`, the rest of its report, and the pictures it embeds.
A wake answers one turn: a turn Malini cut and continued after a restart still answers it, and a turn you stop drops it.
A turn that ends while only background commands run reports at once that it waits on them, by name.
Reports that arrive while the chat works wait, and come as one prompt once its turn ends.
`workstreams_send` reaches only the workstreams the chat started.
A prompt for a chat on a turn waits until that turn ends, and survives a restart of Malini, so the agent never sends it twice.
It sends one workstream at most six prompts after your last message; past that, the agent asks you whether to go on.
Malini may wake the chat the same way when an automation it ran finishes or fails, or when a merge in work it asked for stops on conflicts while **Resolve conflicts** is off; that report says "work you asked for moved on" and needs no `workstreams_send`.
It never wakes a chat only because the chat works in the workstream where something happened.
Other Malini chats are reachable only through these tools, since Claude Code's own `ListAgents` and `SendMessage` see only its own agents.

To change code in another repository, such as your fork, the agent clones it with `repositories_clone` and starts a workstream there with `workstreams_create`.
The workstream starts from the default branch, or from the tag, branch or commit the agent names in `base`, such as the release you run, `v0.17.5`.
Malini fetches that from the repository's origin, and the workstream's pull request still targets the default branch.
When it reaches for `git checkout` or `git worktree` instead, Malini refuses the command and names those tools.
A `git clone` still runs, for reading code, and Malini reminds the agent to start a workstream before it changes any.

## Automations and events

| Tool               | What it does                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automations_list` | Lists your [automations](/malini/docs/automations.md): id, name, instructions, where they run, model, effort, skills, `when` with its mode, `then`, and what each one sees and reaches. |
| `automations_save` | Creates an automation, or changes one by id: its skills, its `when` trigger, and its `then` automation included.                                                                        |
| `automations_run`  | Asks Malini to run an automation, in the chat's workstream or another one, such as one it started, with optional extra context, and returns at once.                                    |
| `events_list`      | Lists every event Malini emits: its channel, what it means, and its payload type.                                                                                                       |

`when` is an automation's [event trigger](/malini/docs/automations.md#when-an-automation-runs) or [schedule](/malini/docs/automations.md#on-a-schedule), and `then` names the automation that runs next, by id or exact name, such as **Open draft** or **Merge**.
`events_list` returns the same data as the [events reference](/malini/docs/reference/events.md).
The agent uses it to write an `on <channel>` trigger and its `where` clause.
A run the agent starts waits in its chat's composer tray until it finishes, wherever it runs.
No tool changes [what an automation sees and reaches](/malini/docs/automations.md#what-an-automation-sees-and-reaches), and `automations_run` refuses extra context for an automation that does not see your chats, so an agent cannot hand an automation more than you let it see.

## Tools and automations

A tool does one thing at once, such as cloning a repository.
An automation is a process with steps: **Merge** waits for checks, runs **Fix checks** and **Resolve conflicts** when it has to, and only then merges.
So the agent clones, hides, starts and archives with tools, and opens drafts and merges by running the **Open draft** and **Merge** automations.

## Shipping is your call

Malini owns commits, pushes, and pull requests, so the agent cannot commit, push, open a pull request or merge one from its shell.
The agent runs **Open draft** or **Merge**, or sets either as an automation's `then`, only when you explicitly asked for it in the chat.
Finished work, passing tests and green checks are never a reason for it to ship on its own.

When you ask it to ship, it runs **Open draft** and goes on with its turn.
Once the turn ends, Malini commits with the turn's `Commit:` line, pushes the branch, and opens the draft under its `Pull request:` title, the same way **Draft** in the top bar does.
When the workstream already has an open pull request, Malini pushes the new work to it instead.
A failure shows in the top bar, where pull request problems always do.

### Workstreams it starts

When the agent hands work to workstreams it starts with `workstreams_create`, and you asked it to ship or merge that work, it ships each one from your chat instead of asking that workstream's chat to.
Right after it starts a workstream, it runs **Open draft** or **Merge** there with `automations_run`, so you approve it in the chat you are in, and **Always allow** for that chat covers the rest.
Malini holds each run while that workstream sets up and its chat works, then does what **Draft** or **Merge** in its top bar does once the chat ends its turn.
So a chat that starts five workstreams and merges them leaves you five merged pull requests and five archived workstreams, not five drafts to click through.

Until it finishes, the run waits in your chat's composer tray as a row that names the workstream it runs in, such as **Merge · Automation in Fetch command**.
Merge still waits for checks, fixes what fails and resolves conflicts first, and a problem shows in that workstream's top bar.

## You decide how often it asks

- The read tools, `automations_list`, `events_list`, `repositories_list` and `workstreams_list`, run without asking, and so do `files_open`, which only opens a file for you, `secrets_request`, which only asks you, `workstreams_create` and `workstreams_send`.
- Nothing inside the chat's own work asks: archiving a workstream it started, or one those started in turn, and running an automation in its own workstream or in one it started go through without asking.
- **Open draft** and **Merge**, and any automation whose Thens reach them, always ask, since [shipping is your call](#shipping-is-your-call).
- Every other Malini tool asks in the chat the first time: **Deny**, **Allow once**, or **Always allow** for this chat, this workstream, or everywhere.
- **Always allow** remembers one action: cloning repositories, hiding them, archiving workstreams, saving automations, or running one automation.
  Always allowing **Release notes** to run never lets the agent run any other automation.
- **Settings > Agent access > Always allowed** lists everything you always allow, and **Revoke** takes it back.
- A trigger the agent adds starts **Off**: the automation never runs on its own until you turn it on from the [Automations page](/malini/docs/automations.md).

## See what the agent did

A chat is an automation without a preset, so **Automations > Activity** lists both as runs, by day: automation runs marked **Automation** and chat turns marked **Chat**.
A chat turn shows when its agent called Malini's tools; turn on **Every chat turn** to list the latest ones too.

- **N calls** on a run folds open every call its agent made to Malini, in order: what it was, how it was approved, and when it finished.
- Open a call to see what the agent called it with and what came back, or the error, and **Open chat** to read the turn that made it.
- A call you denied shows too, as **You denied it**.
- An automation an agent started with `automations_run` reads **Started by an agent**, and its own calls fold under it.

## Edits you review

An automation runs without asking when it is built in, when you always allow it to run, when its trigger is not Off, or when it is the Then of such an automation.
When the agent changes such an automation, Malini shows you the change instead of saving it, and **Always allow** never skips this.

- Each changed setting, such as the model, the When, or the Then, gets its own row with **Accept** and **Reject**.
- The instructions show as a diff you can edit, and each change in them has its own **Accept** and **Reject**, with **Accept all** and **Reject all** above.
- **Save** keeps every change you did not reject, plus your own edits, and the agent gets the version you saved.
- **Reject** keeps the automation as it was.

## Example

> Every time one of my pull requests merges, update the docs and open a draft PR.

The agent can read `events_list`, find `pull-requests:ship-changed`, and save an automation:

```json
{
	"name": "Docs after merge",
	"instructions": "Bring the docs up to date with the pull request that merged.",
	"when": "on pull-requests:ship-changed where merged is set",
	"then": "Open draft"
}
```

You approve the save, and its trigger starts Off.
Turn it on from the Automations page, as **Ask me first** or **On its own**, when you trust it.
