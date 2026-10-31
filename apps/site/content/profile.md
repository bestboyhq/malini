---
title: Public profile
description: Publish your Malini stats to a public profile at bestboy.dev and share cards of it. Every number Malini sends, in plain words, and what never leaves your Mac.
---

Malini counts how you work with agents on your Mac, in the Stats panel.
You can publish those stats to a public profile at `bestboy.dev/@handle`, and then share cards of them.
Your profile lives in your Bestboy account, and publishing is off until you turn it on.

## Your Bestboy account

Settings, Profile shows your Bestboy account.
Signed out, it says **Not signed in to Bestboy**, and **Sign in** opens your browser to sign in with Google or an email code.
Signing in publishes nothing; it only tells Malini who you are on bestboy.dev.
Signed in, it shows your name and email, and **Sign out**.

## Publish my stats

Turn on **Publish my stats** in Settings, Profile, or click **Publish my stats** under **Share card** in the Stats panel.

1. If you are not signed in yet, Malini opens your browser to sign in to Bestboy, and the browser hands you back to Malini through a `malini://` link.
2. Back in Malini, you choose your profile address, `bestboy.dev/@handle`, filled in with your GitHub login.
3. Malini sends your numbers, and **Copy link** copies your profile's address.

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

When you reached a milestone in the past week, your share card peeks out of the sidebar in place of **Recently archived**, with a line above it such as a flame and **7 days straight**, grass untouched, or **3,000 runs**, zero standups.
It shows your newest one, so a milestone you missed on its day still waits for you for a week.
A milestone is a 7, 30, 100 or 365-day streak, a streak longer than any before it, a day with more runs than any before it, or another thousand runs.
The card waits until no agent is working, and hides while streamer mode masks your personal data.

Click the card to see both cards.
Once you publish, **Copy card** and **Copy link** share them; before that, the card offers to show the world at your `bestboy.dev/@handle`, the same steps as **Publish my stats**.
The × dismisses that milestone and any older one for good and brings **Recently archived** back, and **Milestone cards** in Settings, Profile turns them off.
Milestones are worked out on your Mac and nothing about them leaves it until you publish.

## Every number Malini sends

Malini sends numbers only.
Every number counts complete days in your time zone, through yesterday; today is never counted.

- **Version**: always 1.
- **Through**: the last day counted, yesterday.
- **Since**: the first day you ran an agent.
- **Runs**: every agent run up to that day, how many of them a job started, and how many you did not prompt: a job started it, Malini started it on its own (a workstream's report, a resume after a usage limit, **Implement** on a plan), or another chat sent its prompt.
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
