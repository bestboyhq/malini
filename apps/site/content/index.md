---
title: What Malini is
description: Malini is a free, open source agentic development environment for builders moving fast. Run as many agents as you want. Malini handles the chores, so you only review pull requests and the gains compound.
---

Malini is agentic development environment for builders moving fast, as a Mac app.
Each task you start is a **workstream**: its own git worktree, its own branch, and its own agent chats.
Agents write the code, and Malini owns git: it commits, opens the pull request, fixes red checks, answers reviews, and merges.
It runs on Claude Code today.
Agents run on a plan you already pay for: Claude Pro or Max, ChatGPT Go, Plus or Pro, OpenCode Go or Console, or a DeepSeek key, picked [per prompt](/malini/docs/chat.md#model-and-effort-per-prompt).
Malini compacts a long chat at 280K tokens instead of near Claude Code's 1M and puts every message back, so a long Opus chat uses about a quarter less of your plan and remembers more ([how](/malini/docs/chat.md#compact-the-conversation)).

Malini is free and open source under AGPL-3.0.
Malini needs no account and no subscription, and there is no Malini server.
A Bestboy account comes in only if you publish your stats to a [public profile](/malini/docs/profile.md) or an [extension](/malini/docs/extensions.md#publish-an-extension) to the marketplace.

## How it works

1. **Start a task.**
   Each task is a workstream: its own git worktree, its own branch, its own chats.
   Start one or start a hundred.
2. **Keep it moving.**
   Queue prompts, plan first if you like.
   Agents write code, and Malini owns git.
3. **Press Draft, then Merge.**
   Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.

## What is in the box

- [Workstreams](/malini/docs/workstreams.md): one git worktree and branch per task, which Malini takes from Draft to merged.
- [Chat](/malini/docs/chat.md): chats that start workstreams across your repositories, queue or steer prompts, plan mode, model and effort per prompt, undo, edit, and fork.
- [Automations](/malini/docs/automations.md): work you reuse by name, that runs when you run it or when something happens, with a Then that runs next.
- [Second brain](/malini/docs/brain.md): what you typed in your chats, logged in a private repository and turned into notes every week.
- [Agent tools](/malini/docs/agent-tools.md): the browser, automations, and events, as tools the agent can call.
- [Extensions](/malini/docs/extensions.md): Malini's own marketplace of MCP servers and skills for every agent, which anyone with a Bestboy handle publishes to, and the inspector they sit beside.
- [Updates and compatibility](/malini/docs/updates.md): how Malini updates itself and keeps your automations working.
- [Public profile](/malini/docs/profile.md): publish your stats to a profile at bestboy.dev, and share cards of it.

## Where your code goes

Your code leaves your Mac only through your own Claude Code, to Anthropic or the provider you pick, and the GitHub CLI, to GitHub.
Malini makes eight calls of its own: update checks to GitHub Releases, usage data to Logdash, stored in the EU, the model lists of DeepSeek and OpenCode from models.dev, one-token messages to opencode.ai when you save an OpenCode key, to learn whether it runs Go or Console, the usage of an OpenCode Go key from opencode.ai while you use it or point at the composer's gauge, [the extension marketplace](/malini/docs/extensions.md#what-reaches-bestboydev) at bestboy.dev while Extensions or Profile is open in Settings or something is installed, only after you turn on **Publish my stats**, [the numbers on your profile](/malini/docs/profile.md) at bestboy.dev, and, only after you sign in with ChatGPT, [OpenAI](/malini/docs/chat.md#chatgpt-plan), which runs the GPT models your plan covers.
Usage data counts the days Malini runs, the agent runs it finishes and the profiles you publish, and names the errors it hits, such as which command failed on which version.
For a new install, it marks each first step once: the first open, the first repository, with whether it came from GitHub, a folder or a new repository, the first workstream, prompt, merge and published profile, and the first return in the following week and month.
Each mark says the day you first opened Malini and how many days have passed.
When Malini installs Claude Code or the GitHub CLI, or you sign in to either, it counts the start and the finish, cancel or failure, with the tool, which try it was, the seconds it took, and whether it came before your first prompt.
For a failure it adds the step that failed and the name of the error, never the message.
On the first launch of a new month, it also sends how many days Malini ran in the last month you used it.
While you are signed in to Bestboy and have accepted its current Terms and Privacy Policy, each count carries your Bestboy account, as a hash Malini makes on your Mac, so we see which accounts use Malini on which days.
Signed out, a count carries no id, and signed in on terms you have not accepted, Malini sends no usage data at all.
Once you answer where you heard about Malini, after your first merge, each count carries the option you picked, never the words you typed for somewhere else.
Once a day it also sends a few counts about the day before: workstreams started, prompts, merges, workstreams archived without a merge, the prompts and minutes a typical merge took, and roughly how long you have used Malini.
Settings, Privacy, **Yesterday's numbers** shows those counts exactly as Malini sends them.
It never contains your code, what your prompts say, paths, keys, or error messages, and Logdash stores no IP address.
**What are we working on?** says so.
Turn it off under Settings, Privacy, **Share usage stats**, or set `DO_NOT_TRACK=1` in your shell.
Turning the switch off sends one last count that says so, with no account and nothing else, so we know how many people the numbers leave out; after that, nothing.

**Help and feedback** at the bottom of the sidebar holds **Report a problem**, which files an issue on [bestboyhq/malini](https://github.com/bestboyhq/malini/issues) through your GitHub CLI, under your own GitHub account.
The issue is public, so anyone can read it, and you can follow up on it on GitHub.
It holds what you write and the facts you leave on below it: the Malini and macOS versions, how many repositories, prompts and merges you have, and the last command that failed in the past day, with the name and kind of its error.
It never holds error messages, paths, code or chats.
You can switch off any fact, and nothing goes until you press **File issue**.
**Join the Discord** only opens bestboy.dev/malini/discord in your browser, which sends you on to the Bestboy Discord.

## For agents reading this

Every page of these docs is plain markdown at its URL plus `.md`.
[llms.txt](https://bestboy.dev/malini/llms.txt) lists every page, and [llms-full.txt](https://bestboy.dev/malini/llms-full.txt) holds all of them in one file.
