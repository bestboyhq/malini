# 0231 - Projects on Bestboy go up from Settings, Profile

Status: accepted

## Context

The front page of bestboy.dev becomes a showcase of projects built with Malini, and a project starts there only from Malini, never from a link pasted on the web.
Bestboy builds its side at the same time, against one contract: `PUT /api/projects` takes the whole set of projects a person has on and answers each one's state and page.
Each project gets a preview page that only its makers see, and the platform alone decides when it can be submitted; Malini is a public repository, so it only shows the state the platform answers.
Private repositories are allowed, so the link must be all that names a project.
0121 already signs in to Bestboy and uploads stats, with a Bearer token, a User-Agent and backoff, but only after **Publish my stats**.
A project shares less than a profile and more than a number: its link and its changelog are words the person chose to publish.

## Decision

- Settings, Profile gets **Projects on Bestboy** under the profile settings, from `BestboyProjectsSettings.svelte` and `BestboyProjectRow.svelte` in `src/lib/stats/presentation/`.
  It lists every repository with runs, from `readProjectSources` in `src/lib/stats/platform/projects.ts`, busiest first, each with a switch and its link.
- The link is prefilled from the repository's GitHub homepage, read by `createRepositoryLookup` in `published-stats.ts` together with its visibility, one `gh api` call cached for an hour.
  A repository without a valid link cannot be turned on.
- `projectLink` in `src/lib/stats/domain/projects.ts` checks the platform's link rules before anything is sent, on both sides of the bridge: `https://` when none is written, no password, no port, no IP address, a public top-level domain, at most 300 characters.
- A project needs the Bestboy sign-in and nothing else; it is independent of **Publish my stats**.
  The projects and their last answers live in `<appData>/bestboy-projects.json`, apart from the profile, so signing out sends nothing and keeps them.
- `BestboyProjects` sends `{ version: 1, projects: [{ link, days, changelog? }] }` through `Bestboy.putProjects`, the same client as the stats upload.
  It sends two seconds after a person turns a project on or off or changes the link of one that is on, and at most once per local day besides, checked every 15 minutes.
  `days` are the complete local days with runs in that repository among the 371 ending yesterday, runs capped at 3,000.
  `changelog` is the start of `CHANGELOG.md` on the default branch, read with `git show` from `origin/<branch>` or the local branch, at most 32 KB cut at a line end, and left out when there is none.
- 408, 425, 429, 5xx and network failures retry from one minute, doubling to an hour, and show their message under the section.
  401 signs Malini out of Bestboy as the stats upload does.
  404 is quiet, so the section works before Bestboy deploys its side.
  A 400 shows its `error` on the row its `field` names.
- Each answer is stored by the link's address, the host without `www.` and the path without its closing slash, and its `url` is kept only when it is a page on the Bestboy origin.
- The **Changelog on merge** recipe writes `CHANGELOG.md` in the form the platform reads: a dated release, a one-line headline, then short notes that lead with bold words, for the people who use the product.

## Consequences

- Malini makes a twelfth outbound call, `PUT /api/projects` on bestboy.dev, only while a signed-in person has a project on or has just turned the last one off.
- Nothing about a project leaves the Mac but its link, its runs per day and its changelog: never the repository's name, files, code, prompts or pull requests.
  The name stays in the renderer for the person's own list.
- Malini holds no rule about when a project can be submitted; a new state needs a new label in `PROJECT_STATE_LABELS` and a new entry in `PROJECT_STATES`, and an unknown one shows no label.
- A body is at most 512 KB, so many projects with full 32 KB changelogs get a 413, shown under the section; the contract, not Malini, has to change for them all to go up.
- Bestboy takes 24 uploads in a UTC day, so a person who toggles often reaches its 429 and Malini backs off.
- Enforced by `src/lib/stats/domain/projects.test.ts` (link rules, addresses, days, the changelog cut), `src/lib/stats/platform/projects.test.ts` (the body carries no name, 404 is quiet and waits a day, a 400 lands on its row, an answer shows, turning off sends an empty list, signed out sends nothing) and `tests/e2e/profile.spec.ts` (the whole flow in the app, through a sign-out).
