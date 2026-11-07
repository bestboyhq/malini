---
title: Chat
description: How a Malini chat runs Claude Code - queue or steer prompts, pause on limits and outages, plan mode, agent access, model and effort per prompt, model presets, undo, edit, and fork.
---

Every chat runs your own Claude Code, through the Claude Agent SDK, inside the chat's workstream.
It keeps running between prompts, so your MCP servers stay connected.
It restarts after 10 idle minutes, when you change the access, mode, report, skills or context window or switch Claude accounts, and when `CLAUDE.md`, your Claude Code settings, `.mcp.json` or the MCP servers in `~/.claude.json` change.

## Chats above repositories

**New chat**, at the top of the sidebar, starts a chat at Home, above every repository.
The **+** on an owner's row starts one for that organization.
Such a chat plans and delegates: it reads Malini's clones of the repositories in its scope, and it never edits code.
It starts a [workstream](/malini/docs/workstreams.md) for each change, with one repository and one prompt, so every decision it makes is a workstream you can see and checks gate every merge.

- It opens at once and sets itself up behind the chat.
  A prompt you send before it is ready waits in the queue, and a setup that fails says why above the chat, with **Retry setup** and **Remove**.
- The top bar counts how many of the workstreams it started merged and which need you.
  A question or a decision turns only that count blue; the top bar turns amber when a merge stopped on a problem or a run failed.
  Under that count, **Started here** lists every workstream the chat started by name and repository: lines added and removed while it is open, and when it merged once it lands.
  **×** on a merged one, or **Clear merged** on the heading, clears merged work from the list, the dots and the count for good; once everything the chat started is merged and cleared, the top bar says **All merged**.
  It stays above the browser tabs once the chat's agent opens a page.
  Click one to go there, or hover it and click its pull request number to open the pull request on GitHub.
  **Your decisions**, under that list, holds every [decision](#decisions) the chat asked you, the open ones first.
- **Draft all** and **Merge all**, beside that count and in the card that opens when you hover the chat's row in the sidebar, log a **Button clicked**, and the [Shipping rule](/malini/docs/automations.md#reconciler) runs the **Open draft** or **Merge** [automation](/malini/docs/automations.md#run-an-automation) in every workstream the chat started that has something to ship: changes, a pull request, or an agent still at work.
  Each run waits above the chat's composer and starts once that workstream's agent ends its turn, so one click ships everything the chat delegated.
  A workstream already shipping, queued to merge, waiting on you or merged is left out, and the buttons go away once none is left.
- The chat speaks for the work it started, and for the work that work started, up to the top-most chat still open.
  Those workstreams keep their rows calm, with no unread mark and no blue, amber or red, and play no sound and send no notification when they finish, need you or fail: every turn they end reports to the chat, and the chat asks you what only you can decide.
  An approval or a question only you can answer still plays the sound, and its notification names the chat and opens it, where the request waits.
  The chat's row lights up for the chat's own turns and for a request of theirs that waits in it, never for a turn they end, so it shows only what you have to do.
  Grouped by Status it sits where the most pressing of the chat and its workstreams belongs, with its workstreams under it.
  A pull request of theirs that needs you says so in a toast that names the chat and opens it.
- It has no repository, so it shows no **Files**.
  Its inspector opens only for a page its agent opens, in a browser tab beside the chat, and goes away with the last tab.
- A workstream the chat starts sits under the chat's row in the sidebar, beside every workstream those start in turn, and the chat's row shows a dot for each it started, archived ones last.
  Hover the chat's row to list them.
  It shows **Started by** with a link back to that chat and the other workstreams it started, and its first prompt says **Prompt from** and names the chat.
- The agent in that workstream knows which chat started it, reads the chat's [plan](#one-plan), and reads the checkouts of the other workstreams that chat started.

### The timeline

The chat reads as a timeline: one line for each thing that happened, with its time, on one rail.
Your messages, the reports of the workstreams it started, what the lead started, sent, archived or ran, and the decisions all sit on it, and **Now** marks what is going on at the moment.
Past turns fade; point at a line to read it.
Everything the lead read or ran between two messages folds into one line, such as **Lead worked · 4 steps**, and **Show work** lists the steps.
The lead's latest message shows in full, and each earlier one folds to its Outcome line until you open it.
A report shows the pictures its workstream embedded; click one to see it full size and flip through the rest.
An approval the lead waits on, such as running **Merge**, shows as a card on the timeline.

Every turn of the lead starts a fresh Claude Code session from what the timeline shows, with the model, effort and access you picked.
So a chat that runs for days never fills its context, and the lead keeps what the work needs in its plan.

### Decisions

The lead brings you what only you can decide, one decision at a time, in a card above the composer.
Each option shows its picture, or its name when it has none, and the lead marks the one it recommends and says what it builds meanwhile.
Click an option to pick it, or open an option full size to flip between them with the arrow keys and pick one with an optional reason, which the lead hears.
An option can be a whole page, which opens live.
**‹ 1 of 3 ›** moves between open decisions, and **Later**, or Escape, folds them into a **decisions wait for you** row above the composer.
The composer stays under the card: write to the lead in your own words, and it records the decisions your message answers.
A decision sits on the timeline once made, with **Change** to pick again, and the lead hears every pick and every change.
The lead names open decisions in its `Needs:` line, so its row says it needs you and Malini plays the sound and sends the notification.

### One plan

The lead keeps one plan, `.context/plan.md` in its own folder: what each workstream builds, the contract between them and the decisions so far.
It writes the plan before it starts workstreams, and every workstream it starts gets the plan's path and reads it before it begins.
When the plan changes, the lead tells the workstreams it affects.

## Queue or steer

- **↵** sends a prompt, or queues it after the current run.
  Edit, reorder, or delete what is queued; **↵** saves an edit and **⇧↵** adds a line.
- An [automation](/malini/docs/automations.md#run-an-automation) run from the chat, by you or the agent, waits above the composer with what you queued until it finishes, never among the messages.
- **⌘↵** steers: it interrupts the turn and sends the prompt now, while background commands keep running.
- Steering or stopping keeps what the agent already wrote, marked **Run cancelled**.

A run stays open while its background commands and subagents run, and you can stop each one.
A prompt sent while a run only waits on them takes the run over, and they keep running, unless you changed the access, mode, report or skills: then Claude Code restarts and they stop.
A turn that ends while only background commands run, such as a dev server, shows its report at once and ships its commit.
When the agent goes on once one of them ends, the end of that turn counts as a turn too: it reports, ships its commit, and hands the chat what waited for it.
Whatever closes that run later, stopping it, quitting, a crash, merging main into the workstream or archiving it, leaves it done, and Malini does not resume it on the next start.

## Limits and outages

Claude Code already tries again up to 10 times when Claude's API is overloaded, fails, limits requests or can't be reached.
When a turn still stops on a limit or an outage, Malini pauses it instead of failing it, and the chat says **Paused until** a time, with the reason.

- A usage limit on your Claude plan waits until the limit resets.
- A rate limit, an overloaded or failing API, or a lost connection tries again after 1, 2, 4, 8, 15 and 30 minutes, and fails after that.
- An error Malini does not recognize tries again once, after a minute.

The turn then goes on where it stopped: Malini sends your prompt again if Claude had not replied yet, and otherwise asks Claude to continue, which the chat shows as a divider, such as **Claude is back. Well rested**.
**Resume now** goes on at once, and a prompt you send replaces the pause.
An automation whose turn pauses keeps running, so a merge that waits on it loses no attempt.
A turn that only you can fix fails: **Sign in** signs Claude Code in again, and **Try again** goes on once you fixed what the error says, such as billing, the model, or a prompt too long.
An API key, your own endpoint, Amazon Bedrock or Google Vertex AI pause the same way, because Claude Code reports their errors in the same kinds; only a Claude plan says when its limit resets.

## Run a command from the chat

Every shell code block the agent writes has a **Run** button next to **Copy**.
It runs the command at once, in your shell, in the workstream's folder, with the same tools on your `PATH` as your terminal; the agent is not asked, and its run need not end first.
Its output opens inside the code block, under the command, as it prints, with how long it has run and its exit code once it ends.

- The command gets a terminal, so a sign-in, a password prompt or a question waits for you.
  Click the output and type: each key goes to the command, **↵** answers, and what you type shows the way a terminal echoes it.
- **Stop** sends Control-C, then ends the command if it is still running a few seconds later.
- **Run** hides while the command runs; once it ends, **Run** runs it again and replaces its output, and **×** clears it.
- The agent reads what you ran with your next prompt: each command, how it ended, and the end of its output, so "it failed, why?" gets an answer from the real output.
- Archiving the workstream or quitting Malini stops what still runs.
  A code block keeps its last output when Malini restarts, until you clear it or delete the chat.
- Full-screen programs such as `vim` or `top` do not draw; run them in your own terminal.

## Compact the conversation

Every chat and automation compacts on its own once its context fills the context window, 280K tokens instead of the model's full window, which is 1M for Opus, and the context gauge counts against it.
**Settings → Models → Context window** moves it from 100K to 1M; the mark on the slider is the recommended 280K.
A chat takes a new window with its next prompt, after any run in progress ends, and Malini's window wins over one you pick with `/autocompact` or in your Claude Code settings.
Type **/** and pick **/compact** to have the chat's Claude Code summarize the conversation so far and free up context.
Type instructions after **/compact** to say what the summary should keep.
Right after any compaction, Malini puts every message of the chat back into the agent's context, word for word: each prompt you wrote and each reply the agent gave, without the turns you undid, the newest 256 KB of them.
The summary still covers tool calls and their output, which the agent can read again.
**Settings → Models → Optimize context** does both, and stays on until you turn it off.
Turned off, Malini sets no window and puts nothing back: Claude Code compacts at its own window, or the one you pick with `/autocompact` or in your Claude Code settings, and the agent keeps only the summary.
A compaction shows in the chat as a step, whether you asked for it or Claude Code ran out of room, and the context gauge drops once it ends.

## Plan first

Plan mode writes the plan, then **Implement plan** starts the work, with a model of its own if you like.

## Model and effort per prompt

Pick Fable, Opus, Sonnet, or Haiku from Claude, a DeepSeek model, a model from OpenCode, on whichever OpenCode plan your key is on, or a GPT model on [your ChatGPT plan](#chatgpt-plan), and an effort from Low to Max, for every prompt.
The picker lists models, not providers: each model once, the newest of its family, so Opus 5.5 shows and Opus 4.8 does not, and everyone sees the same list whatever they connected.
Each row shows the icon of the provider that runs it.
A model that more than one provider runs has a chevron: point at it, or press →, to see who runs it, such as Claude and OpenCode for Opus 5.5, or ChatGPT and OpenCode for GPT-6 Luna, with what each one needs, and pick one.
The row names the model the provider you picked runs, so a family two providers sell at different versions shows the one you will get.
Type in it to filter by model or provider, and press Enter to pick the first match.
**Save Opus 5.5 · Max as a preset** at the bottom of the model menu keeps the model with its effort, and the preset shows at the top of the menu as **Opus 5.5 Max**.
Picking a preset sets both its model and its effort in the chat, and you can still change the effort afterwards.
Hover a preset and click the **×** that slides in beside it to remove it, or use the same menu item once that model and effort are what the chat shows.
Every chat keeps its own model, effort, access and report, so what you pick in one chat never changes another.
A new chat starts with the model, effort, plan mode and report you picked last, in any chat, and with the access you last picked in its workstream.
Picking another model in a chat that already ran sends your next prompt to a new chat with that model.
Turning plan mode on or off picks the planning or implementation model from **Settings → Models**, and **Implement plan** starts with the implementation model.
An automation's chat shows the model, effort and plan mode its automation ran with, so a reply you send there runs the same way unless you change it.
Send with a model that is not connected and Malini asks for what it needs right there: a DeepSeek or OpenCode API key, with a link to get one, a Claude sign-in, or a ChatGPT sign-in.
Connecting sends the prompt, and the same card covers an edited prompt before its checkpoint rewinds.
You can also save either key in **Settings → Providers**; Malini seals it with your Mac's keychain and never shows it again.
OpenCode sells Go, a subscription, and Console, credits per request, and one key covers either: saving it sends OpenCode one-token messages that answer Go or Console, and Malini lists only that plan's models.
**Check again** beside the model count asks again after you change plans, and the card names the plan only for Go: **Key saved. Your Go plan.**
DeepSeek's and OpenCode's models come from [models.dev](https://models.dev), which Malini reads at launch and at most once an hour as you open the picker or **Settings → Providers**, so a new model shows up without an update.
Each model says whether it reads images and how much context it holds; Malini lists only models that can use tools, and leaves out free ones, which OpenCode keeps to its own apps.

## ChatGPT plan

A ChatGPT plan runs GPT models in Claude Code, with Claude Code's tools, subagents and plan mode, and no Codex.
Pick a GPT model, choose **ChatGPT** where the model shows who runs it, and send.
The first send asks you to sign in: **Continue with ChatGPT** opens your browser on OpenAI's own sign-in, and the prompt goes once you are back.
Go, Plus and Pro plans can sign in; on a Free plan, OpenAI's page offers **Upgrade** instead of **Continue**.
**Settings → Providers** signs in and out too, and lists the models your plan runs, which Malini reads from OpenAI after you sign in and at most once an hour.
A plan does not run every GPT model: send with one it lacks and Malini keeps your prompt and says "Your ChatGPT plan does not include this model." until you pick another.
Malini keeps your ChatGPT sign-in encrypted on your Mac, and it never leaves Malini: Claude Code talks to a server Malini runs on your Mac that only Malini's own runs can call, and that server talks to OpenAI.
The context card shows your ChatGPT account with "Using ChatGPT plan" and **Manage usage**, which opens your usage on chatgpt.com, since ChatGPT does not tell apps how much of the plan is left.
When you hit the limit, the turn [pauses](#limits-and-outages) the way a rate limit does, since ChatGPT does not say when the limit resets, and the context card says "You hit your ChatGPT usage limit." until a run goes through again.
Each run counts against your ChatGPT plan, not an API bill, so the context card shows no cost for it.
An automation on a GPT model runs on your plan too, once you pick ChatGPT for it and turn on its trigger.
Some of Claude Code needs Anthropic's servers and does not run on ChatGPT: web search, and Anthropic's prompt caching, which OpenAI's own caching replaces.
The thinking you see is OpenAI's summary of the model's reasoning.

## Claude accounts

Point at the gauge in the composer for **Providers**: only the providers you connected, Claude when Claude Code is signed in, ChatGPT once you sign in to it, and DeepSeek or OpenCode once its key is saved.
Under Claude sits the account Claude Code is signed in to, with its plan and its five-hour and weekly usage, then every other Claude account you used on this Mac.
Usage comes from the account's runs, so a fresh account shows it after its next run.
The same accounts sit in **Settings → Providers**, and **Accounts…** in Malini's menu bar icon opens it.
**Add account** signs in to another account through your browser, and **Switch** moves to an account you used before.
After that, Malini keeps the account you leave signed in, encrypted on your Mac, so switching back takes one click, and your browser opens only when Claude asks you to sign in again.
A switch applies to Claude Code everywhere, in your terminal too, and each chat moves to the new account with its next prompt.
Until then, pointing at the chat's gauge names the account it last ran on.

## Agent access

- **Auto**, the default, uses Claude Code's auto mode.
- **Sandboxed** edits the workstream and runs commands without asking, and asks for anything else.
- **Full access** never asks.

Whatever the access, every command runs in [the sandbox](#the-sandbox).

When the agent asks, approve once, or always for the chat, the workstream, or everywhere.
Malini's own tools ask only outside the chat's own work: archiving a workstream the chat started, or running an automation in its workstream or one it started, goes through without asking, unless the automation opens a draft or merges.
See [how often Malini's tools ask](/malini/docs/agent-tools.md#you-decide-how-often-it-asks).
**Settings > Agent access** lists everything you always allow, and **Revoke** takes it back.

When auto mode blocks a call, the chat asks you instead of failing it, with the reason auto mode gave.
**Allow once** lets Claude retry that exact call.
**Always allow** also adds a permission rule for it to your Claude Code settings, so auto mode lets it through from then on.
**Keep blocked** leaves the block in place, and the agent carries on without it.

When auto mode cannot check a call because Anthropic's safety check is down, the chat does not ask you right away.
Malini lets Claude retry the call up to three times over about a minute, so a short outage never reaches you, and each attempt shows as a **not checked** row.
If the check stays down, the chat trusts edits the way **Sandboxed** does: edits inside the workstream go through, and everything else asks, saying auto mode couldn't check the call.
Other chats skip the retries while the check is known to be down, and each chat tries auto mode again after five minutes.
**Keep blocked** on such a call leaves it blocked, and the agent carries on without it.
Calls that wait in other chats show as one **calls waiting** row above the composer, which says auto mode's safety check is down, and **Answer** shows them one at a time, the way the requests of the work a chat started show.

A chat also answers for the work it started.
When an automation it ran in another workstream, a workstream it started, or a workstream started from those, asks for permission or asks a question, the request takes this chat's composer slot, named after the automation or workstream it came from.
Several requests wait in one queue and show one at a time, with **‹ 1 of 3 ›** to move between them.
**Open transcript** goes to the asking chat when you want its context.
**Later**, or Escape, folds the queue into a **requests need you** row above the composer, so you can write to this chat, and **Answer** brings it back.
A request takes the composer slot right away, even over a draft, which waits underneath, and a new one brings the queue back after **Later**.

### The sandbox

Every command an agent runs, in a chat or an automation, runs in a macOS sandbox Malini writes for it, and so does the install Malini runs when it sets up a workstream.
A package that turns out to be malicious gets the sandbox, not your Mac.

In the sandbox, a command:

- writes only to the workstream, its git folders, temporary folders and package caches;
- never writes git hooks, git config, `.claude/settings.json` or `.mcp.json`, which run outside the sandbox later;
- cannot read credentials such as `~/.ssh`, `~/.aws`, `~/.config/gcloud`, your browsers' profiles and cookies, or the secrets Malini sets in other chats;
- cannot open or script other apps, read the clipboard, take screenshots, or stop a process an earlier command started;
- reaches localhost and, unless an automation has the internet off, any site and your keychain, where `gh` keeps its sign-in.

Electron, Playwright, file watchers and terminals run inside it, so `pnpm test:e2e` does too.
Electron's own sandbox stays off there, since the two cannot nest.
An agent starts a server in the background and stops it through Claude Code, since a later command cannot reach it.

When a command needs what the sandbox blocks, the agent asks to run it outside, and the chat asks you first.
**Allow for this chat** runs every later one in that chat outside without asking, and a new chat, or the same chat after Malini restarts, asks again.
**Full access** runs it outside without asking.
An approval lets out that one call: a command inside the sandbox cannot let itself out.

## Reports

Every turn ends with a report: **Done** or **Waiting on you**, with the commit and pull request titles.
What changed and what was verified read as one line each, with an icon for each, and a longer write-up waits under the **Details** row, which says how many words it holds.
Reports run from a screenshot and one line to the full write-up.
Every picture of a report sits in one frame with a tab for each under it, so pictures never stack, and the agent embeds only what you need to see: the variants, the before and after, or one screenshot of what is new.
A note the agent adds after its report, when a background command ends or another chat writes to it, shows below the report, and the report stays the turn's result: its commit, its pull request title and its notification.
A **Your turn** list, unread marks, a sound, and a notification tell you which workstream needs you, or which chat, for [the workstreams a chat started](#chats-above-repositories).

### Next steps

What the agent left for later, or would do next, sits at the bottom of the report.
**Ship** sends it back to the chat as the next prompt, and **Note it** saves it as an idea in the repository's scratchpad.
Hold ⌘ and **Ship** turns into **Slice, fork, ship**: it forks the chat into a new one with the transcript so far and sends the step there, while you stay where you are.
Ship several steps that way and each one runs in a chat of its own.

### Before and after

When the agent changes something you can see, it captures it before and after, and the report shows the two as one picture across the chat's full width.
**Wipe** drags a divider across it, **Flip** switches between the two with a click, and **Diff** paints every changed pixel pink.
Each changed area gets a number, including the ones the agent did not mean to change; click a number to zoom into it, or pinch or Ctrl-scroll to zoom anywhere and scroll to pan, and press Escape to zoom back out.
The expand button opens the picture you see in the gallery.
Recordings play side by side on one timeline: step a frame at a time, slow them to 0.5× or 0.25×, and jump to the moment the agent marked.

### Variants

When you ask for options, or the direction is open, the agent makes two to four variants.
It does not wait to be asked: when its answer proposes something you will see, even an answer to a question, it builds the prototype in the same turn instead of offering to.
Each one copies your product's look, sits in the screen around it and shows your real content.
Each variant is a tab under the report's frame, and the before and after sits past a divider; the variant you chose keeps its ring while you look at the evidence.
Click a picture or recording in the frame, or a recording's maximize button, to open it in the gallery.
A recording carries on there from the same moment, with its sound and speed, and pauses in the frame; its minimize button, or closing the gallery, hands it back where you left it.
Point at a recording to show its controls: play or pause, scrub, change the volume from the speaker button, and slow it to 0.5× or 0.25×.
A variant's name rises above the controls while they show, so it never covers them.
While you hold the playhead, the recording stops on the frame under it, and it plays on when you let go.
A variant can be a picture, a recording that plays on a loop, or an HTML page that runs live, so you can judge motion before you pick.
When the browser shows one of the report's variants, Malini puts a **Variants** strip under the page: click a variant, or step with the arrows or the ← and → keys, to flip between them in one tab.
Pick one, say why if you like, and the agent builds on it; **None fit** asks for new ones.
Every pick stays in the chat as a step, with what lost and why; click any variant in it to open it in the gallery.
The pull request description lists which variant won over which, never your reason: what you type stays in the chat.
Variants and prototypes stay in the workstream's `.context` folder and never reach your code.
Once you pick one, the agent builds it into the real thing and removes what it replaces.

### Simplified Technical English

**Settings → Models → Simplified Technical English** has every agent write its replies in ASD-STE100, the controlled English of aircraft manuals: common words, active voice, simple tenses, and one statement per sentence of 20 words or fewer.
At the low and medium report resolutions, a reply also stays under 135 words, code, paths and the footer not counted.
Before you see a reply, the provider's small model, Haiku on a Claude plan, reads it beside your prompt.
A reply that breaks a rule goes back to the agent once, with what to fix, and you see only the rewrite.
Ask for another style or length in a prompt, such as "in detail" or "reply casually", and that reply keeps it.
A reply that passes waits a few seconds for the check; one that goes back costs a rewrite.
It is off until you turn it on, and the next prompt of every chat follows it.

## Sounds

Malini plays one sound when an agent finishes and another when it needs you: a question, an approval, or a failed run.
**Settings → Sounds** picks each one from the same list: the Malini chime and 16 more that ship with Malini, the same on every Mac.
Play one before you pick it, and the menu stays open while you try others.
**Record a sound…** records up to 3 seconds from your microphone, after macOS asks you to allow it, and **Choose a file…** adds a sound file of up to 5 MB.
Your own sounds join both lists, and **No sound** turns one off.
The trash button beside one of yours removes it once you click **Remove**, and a moment that played it goes back to its default.

## Context

- **@** mentions a file, and you can attach, paste, or drop images, GIFs, screen recordings (mp4, mov, webm), and files, up to 100 MB each.
  Claude reads a video through frames it extracts with ffmpeg.
- Click an image, GIF, or video in a chat to open the gallery: videos play there with the same controls, plus a frame step, which fade once the pointer rests for 2 seconds, and Space plays or pauses them; every image and video of the chat sits in its strip.
  Pinch or Ctrl-scroll to zoom and drag to pan, and click the picture or press Escape to close it.
  Malini keeps a copy of every image and video a chat shows, so it still opens after the agent deletes or moves the file.
- Thinking shows inline, step by step, with a diff for every file the chat changed.
- A tool call's command, file, and duration fade in as they arrive.
- Each subagent is one line: its task, the step it is on, how many steps it took, and how long.
  While it runs, the square on its line stops it, and the tray above the composer keeps only background commands.
  Click it for its prompt, every step, and its report.
  Subagents that run side by side sit under one line, such as "3 subagents · 2 of 3 back", and fold into it once all are back; click it to see them again.
  Malini asks the agent to run the independent parts of a task as parallel subagents.
- Every edit, write, and read is a file badge: point at it for a card with what the edit changed, the file it wrote, or the lines it read, and click to keep the card open.
- The chat follows the reply while you point at a step, and holds still while you point into one you expanded.
- Point at the gauge or the plug in the composer for the context window breakdown, the tokens the last run used, the providers you connected with the Claude account in use and its five-hour and weekly usage, and the status of your MCP servers, read live from the chat's Claude Code.

## Undo, edit, slice and fork

Every run can be undone.
Edit an earlier message and press **↵** to resend from there, or slice and fork: a new chat starts from the chat as it stood at that run, even while the agent is still busy.
Runs that a restart cut short pick up where they left off the next time Malini opens: Malini logs **Malini started**, and the [Reconciler](/malini/docs/automations.md#reconciler)'s Resume rule continues them.
A prompt Claude had not replied to yet is sent again instead, because Claude Code keeps only a prompt it answered.

## Skills

A chat loads every Claude Code skill that is on.
Settings, Skills ranks your skills and plugins by how often Claude Code used them, and turns them off in Claude Code's own settings.
An [automation](/malini/docs/automations.md) can name the skills it loads.

## MCP servers

The plug in the composer lists the chat's MCP servers by what fixes them: servers to sign in to, claude.ai connectors to reconnect on claude.ai, servers that failed, and duplicates of a server that already connects.
Servers that work fold into **Ready**, and servers you turned off into **Off**.
When two servers share a name, each shows where it comes from, such as claude.ai or the plugin that ships it.

- **Sign in** opens the server's sign-in page in your browser.
  Once it connects, every open chat reconnects it.
- **Retry** reconnects a server that failed; its error shows under its name.
- **Fix** walks every server that needs you, one at a time: it opens the next sign-in page as soon as the last one connects, retries the failed ones, and lets you skip a server or turn it off.
- **Turn off** adds the server to `deniedMcpServers` in your Claude Code settings, so it leaves every chat, here and in the terminal.
  A chat that is open drops it at once, without a restart, and **Turn on** brings it back the same way.

Settings, MCP servers lists every server a chat in the open workstream connects, grouped by where it comes from: claude.ai connectors, each plugin, your own servers, and the repository's `.mcp.json`.
It opens with what it found last time and updates each row live while its server connects, signs in or fails.
Filter it to the servers that need you or the ones that are off, sign in or retry from there, and switch any server on or off.
The refresh button starts its Claude Code again, for a claude.ai connector you just added on claude.ai.

## Tools

In a Malini chat the agent also has Malini's own tools: a browser it shares with you, [secrets](/malini/docs/agent-tools.md#secrets) it asks you for on a card in the chat, and your automations and events.
See [Agent tools](/malini/docs/agent-tools.md).

## Keys

| Key             |                                                        |
| --------------- | ------------------------------------------------------ |
| **↵**           | Send, or queue after the current run                   |
| **⌘↵**          | Steer now, interrupting the run                        |
| **@**           | Mention a file                                         |
| **/**           | Compact the conversation, or run an automation         |
| **⌘T**          | Start a new chat in this workstream                    |
| **⌘N**          | Start a new workstream in this repository              |
| **⌘O**          | Open a folder as a repository                          |
| **⌘,**          | Open Settings                                          |
| **⌘W**          | Close the chat tab                                     |
| **⌘K**          | Run a command or find a repository                     |
| **⌥↑** / **⌥↓** | Move a repository, a workstream, or an inspector panel |
