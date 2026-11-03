# 0154 - Copy speaks Bestboy's voice, from the private brand repository

Status: accepted

## Context

Malini's deadpan voice lived in three places: the `deadpan-copy` skill in the user's dotfiles, which only agents on their Mac load, 0131's account of the milestone voice, and about ten `*-copy.ts` files; nothing told an agent where to find it.
The user wants it held at scale: "it's very important for the brands and everything to follow the particular language and be consistent with it".
Copying the guide into this public repository would publish its rules and the lines the user turned down: "I don't want it to leak."
Making it open source was weighed and left for later ("I actually don't know if I wanna make it open"), since a private repository can turn public later and a public one cannot be taken back.
Offered a place beside `docs/design.md` in `bestboyhq/platform`, the user asked "why not just make it another repo?"; the design stays in platform, whose `AGENTS.md` has it change with the code that implements it and whose code comments and `design` skill point at it, so moving it would split every design change across two pull requests.

## Decision

- Bestboy's voice is `voice.md` in the private `bestboyhq/brand`: where it applies, its rules, the canon of lines the user picked, and the log of lines they turned down, in their words.
- `AGENTS.md` points every agent that writes or changes copy a user reads at it, read with `gh api repos/bestboyhq/brand/contents/voice.md --jq .content | base64 -d`.
- The `deadpan-copy` skill reads it on every run and keeps no copy; a round of copy ends with its pick and its turned-down lines in a pull request to `bestboyhq/brand`.
- This repository quotes shipped lines and names the rule they follow; the rules and the log stay in `bestboyhq/brand`, so 0153 names its rounds instead of quoting them.
- `docs/design.md` stays in `bestboyhq/platform` (0042).

## Consequences

- The voice changes in one place, and every Bestboy repository can point at it.
- An agent without access to `bestboyhq/brand`, such as an outside contributor's or CI's, writes copy without the guide, and the user catches the drift in review.
- A copy round costs a second pull request, in `bestboyhq/brand`, for its log.
- Nothing enforces that copy follows the guide, or that the guide stays out of this repository.
  A job that reviews copy was turned down ("Skip the job."): the user sees new copy in its prototypes and screenshots, and the job waits until drift shows up.
