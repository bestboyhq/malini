---
title: Public profile
description: Publish your Malini stats to a public profile at bestboy.dev, share cards of it, and put the projects you build on bestboy.dev. Everything Malini sends, in plain words, and what never leaves your Mac.
---

Malini counts how you work with agents on your Mac, in the Stats panel.
You can publish those stats to a public profile at `bestboy.dev/@handle`, and then share cards of them.
Your profile lives in your Bestboy account, and publishing is off until you turn it on.
The same account puts the projects you build with Malini on bestboy.dev; see [Projects on Bestboy](#projects-on-bestboy).

## Your Bestboy account

Settings, Profile shows your Bestboy account.
Signed out, it says **Not signed in to Bestboy**, and **Sign in** opens your browser to sign in with Google or an email code.
Signing in publishes nothing; it only tells Malini who you are on bestboy.dev.
While you are signed in and have accepted Bestboy's current Terms and Privacy Policy, Malini's usage stats carry your account, as a hash made on your Mac; otherwise they carry a random ID made for this install, linked to nothing else.
You turn them off in Settings, Privacy, **Share usage stats**.
Signed in, it shows your name and email, and **Sign out**.

Your picture and handle sit at the bottom of the sidebar, or a plain figure while Malini knows neither.
Click them for **Stats**, **Brain** and **Settings**; **⌘,** opens Settings too.
Signed in, the menu adds your name and a line about your week: a flame and a cheer such as **Crushing it as always** while you keep up your pace, or a sun and one such as **Warming up before taking over the world** while it is quieter.
You keep up your pace when the last 7 days hold at least three quarters of your average week over the 4 weeks before them, counted on your Mac.
Signed in, **Open profile** opens your public profile once you publish, and **Sign out** signs you out.
The same account publishes your extensions, from **Extensions you publish** lower on Profile; see [Publish an extension](/malini/docs/extensions.md#publish-an-extension).

## Publish my stats

Turn on **Publish my stats** in Settings, Profile, or click **Publish my stats** under **Share card** in the Stats panel.

1. If you are not signed in yet, Malini opens your browser to sign in to Bestboy, and the browser hands you back to Malini through a `malini://` link.
2. Back in Malini, you choose your profile address, `bestboy.dev/@handle`, filled in with your GitHub login.
3. Malini sends your numbers, and **Copy link** copies your profile's address.

When Bestboy's Terms and Privacy Policy change after you accepted them, **Publish my stats** says **Publishing accepts the Terms and Privacy Policy.** while it is off, and both open in your browser.
Publishing then sends the date of the ones you saw with your handle, which accepts them, and the line goes away.
Signing in to Bestboy accepts them too.
If you already publish, Malini shows nothing and keeps publishing as before; the new ones apply to you only once you accept them, by signing in again or publishing anew.
Until then, Malini's usage stats carry this install's random ID instead of your account.

While it stays on, Malini sends your numbers once a day, and again when you change your public repositories or what your profile shows.
bestboy.dev publishes changes once a day at 03:00 UTC, for everyone at the same moment, so your profile never shows when you work.
The first upload after you turn it on goes public at once.

Turn the switch off, and Malini removes your numbers from bestboy.dev at once and hides your profile.
**Sign out** does the same first, then signs Malini out of Bestboy.
When bestboy.dev cannot be reached, Malini keeps trying until it can.

The `malini://` link opens the Malini you installed.
A link meant for another sign-in, or one that reaches a Malini that never asked for it, changes nothing.

### Your profile only grows

Your first upload seeds your profile with everything Malini counted until then.
After that, bestboy.dev only adds the days that follow: a day already on your profile keeps its numbers, and your totals never go down, even when you delete a chat or a repository on your Mac.
So your profile can count more than the Stats panel, which counts what your Mac still holds.
Agents at once, run lengths, steps and your picked repositories follow your latest upload.

bestboy.dev caps every number far above what anyone reaches, such as 100 agents at once or 3,000 runs a day, and refuses numbers that contradict each other.
Turn the switch off, and your next upload seeds your profile again.

### What your profile shows

Your profile shows how you work with agents: runs, streaks, agents at once and the rest of the numbers below.
It also shows how many tokens your agents went through, and your automation score: the share of runs you did not prompt yourself.

### Public repositories

Your profile names no repository unless you pick it.
Under **Public repositories**, Settings lists the repositories you ran agents in that GitHub reports public, and you can pick up to 10.
Malini names a picked repository only while GitHub still reports it public.
Every other repository counts only toward two totals, public and private, and a repository that is not on GitHub counts as private.

## Share cards

Share cards come with your profile.
Once you publish, open the Stats panel from the readout at the bottom of the sidebar.
**Share card** shows two cards drawn from your numbers: **Heatmap** and **Readout**.
Click one to copy it as a picture, then paste it anywhere.

The cards count complete days only, through yesterday, so a card you copy matches your profile.
They show your name and picture from GitHub, and your Bestboy handle.
Until you publish, **Share card** offers **Publish my stats** instead.

## Milestone cards

When you reached a milestone in the past week, your share card peeks out of the sidebar in place of **Recently archived**, with a line above it such as a flame and **7 days straight**, agents skipped lunch, or **3,000 runs**, agents want a raise.
It shows your newest one, so a milestone you missed on its day still waits for you for a week.
A milestone is a 7, 30, 100 or 365-day streak, a streak longer than any before it, a day with more runs than any before it, or another thousand runs.
The card waits until no agent is working, and hides while streamer mode masks your personal data.

Until you publish, click the card to see both cards and claim your `bestboy.dev/@handle` to brag with them, the same steps as **Publish my stats**.
Once your profile is public, only the line shows, with **Share** beside it: it opens both cards, and **Copy card** and **Copy link** share them.
The × closes the card and brings **Recently archived** back, and no card shows for a week after.
After that week, only a milestone reached since you closed the last card shows, so a card stays rare.
**Milestone cards** in Settings, Profile turns them off.
Milestones are worked out on your Mac and nothing about them leaves it until you publish.

## Every number Malini sends

Malini sends numbers only.
Every number counts complete days in your time zone, through yesterday; today is never counted.

- **Version**: always 1.
- **Through**: the last day counted, yesterday.
- **Since**: the first day you ran an agent.
- **Runs**: every agent run up to that day, how many of them an automation started, and how many you did not prompt: an automation started it, Malini started it on its own (a workstream's report, a resume after a usage limit, **Implement** on a plan), or another chat sent its prompt.
- **Runs that changed code**: runs that changed at least one file.
- **Active days**: days with at least one run.
- **Tool calls**: every tool call agents made, sub-agents included, and how many of them were screenshots in Malini's browser.
- **Workstreams**: workstreams you opened, and how many of them you merged through a pull request.
- **Lines and files**: lines agents added and removed, and how many different files they changed in each repository.
- **Tokens**: tokens agents read and wrote in finished runs; read tokens count prompt-cache reads and writes, so they run far above fresh input.
- **Days**: for each day with a run in the last 53 weeks, the date, how many runs started that day, and how many agents ran at once on average while any ran.
- **Agents at once**: the average weighted by time, the typical number, the number reached in the busiest tenth of the time, and the peak.
- **Run length**: the typical run, the run longer than nine in ten, and the longest run.
- **Steps per run**: tool calls in a run, typical, one in ten, and most; a run without a tool call counts as zero.
- **Runs on an active day**: typical, one in ten, and most.
- **Lines per change**: lines added plus removed in a typical run that changed code.
- **Runs per workstream**: runs in a typical workstream.
- **Public repositories you picked**: runs in each.
- **Other repositories**: how many and how many runs, as public and private.

The only names Malini sends are the public repositories you picked.
It sends no tool, skill, MCP server, model or language name.

## What never leaves your Mac

- Your prompts, code, file names, and paths.
- The name of any repository you did not pick.
- When you work: no time of day, no session times, no sign of whether you are online, and bestboy.dev never shows when an upload arrived.
- Your email address and your team.

Anyone could change the numbers their own Malini sends, so a profile says its stats are self-reported by Malini.
Once seeded, a profile grows only as days pass, so a made-up history takes as long to build as a real one.

## Projects on Bestboy

The front page of bestboy.dev shows projects built with Malini, and a project gets there only from Malini.
Settings, Profile, **Projects on Bestboy** lists the repositories you ran agents in, busiest first, with their runs and the days you ran them.
Each one has a switch and a link: the page a visitor opens, such as `https://garden-wars.io`.
Malini fills the link in from the repository's homepage on GitHub when it has one, and a repository without a link stays off until you write one.

A link is a public web address.
Malini assumes `https://` when you write none, and refuses a password, a port, an IP address, or a name that only works on your network, such as one ending `.local` or `.test`.
It says what is wrong under the field before it sends anything.

Turning a project on needs you signed in to Bestboy, and nothing more: it does not need **Publish my stats**.
Each project you turn on gets a preview page on bestboy.dev that only its makers see.
Submit it from that page, and someone at Bestboy reviews it by hand before it joins the board.

Beside the switch, Malini shows what bestboy.dev last said about the project:

- **Preview**: its page is up, and only its makers see it.
- **Ready to submit**: its page offers **Submit**.
- **In review**: someone at Bestboy is looking at it.
- **Live**: it is on the board.
- **Asked to join**: the link is already a live project someone else makes, and its makers decide whether to add you.
- **Taken down**: it came off the board after a report.

**Open it** opens the project's page in your browser, or **Open its page** once it is live, whenever bestboy.dev lets you open it.

Malini sends every project you have on each time you turn one on or off or change a link, and once a day besides.
Turn a project off, and its preview leaves bestboy.dev; a live project stays on the board.
Signing out of Bestboy sends nothing and keeps your projects as they are, and they go up again once you sign back in.
When bestboy.dev cannot be reached, Malini keeps trying until it can.

### What a project sends

- **Link**: the address you wrote.
- **Days**: for each complete day in your time zone with a run in that repository in the last 53 weeks, through yesterday, the date and how many runs started that day.
- **Changelog**: the start of `CHANGELOG.md` on the repository's default branch, up to 32 KB, cut at the end of a line, and nothing when there is none.
  The **Changelog on merge** recipe on the Automations page keeps it for you, written for the people who use the project.

Nothing else about a project leaves your Mac: never the repository's name, its files or code, your prompts, or its pull requests.
A private repository is a project like any other, since its link is all that names it.
