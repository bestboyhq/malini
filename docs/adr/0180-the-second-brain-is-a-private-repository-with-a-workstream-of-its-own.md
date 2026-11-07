# 0180 - The second brain is a private repository with a workstream of its own

Status: accepted

## Context

The user grows several products and dumps thoughts into chats, then loses them: chats hold what they learned and went through, and nothing recalls it once they are archived.
Their decisions: the brain is "managed by Malini, not a local Obsidian vault", a private repository on GitHub named `brain` that Obsidian can still open, read on a page in Malini, and fed by automations rather than hard-wired code.
Its layout is "neutral on purpose": `log/YYYY-MM-DD.md` is raw capture that agents never rewrite, and `notes/` is written from it by topic, "not only by product", linked back to the log.
"Opinions live in the automation's editable instructions, not in storage or schema", so "a GTM engineer should be able to rewrite them ('accounts, campaigns, objections') without touching Malini's code".
Malini's sandbox writes only to a workstream's checkout (0167), and an automation runs in a workstream, so the brain needs a checkout an automation can work in.
Chats hold secrets and private code, and 0167 lets an automation see only what its page allows.

## Decision

- **A repository and a workstream.**
  `brain.set-up` (`src/lib/brain/platform/brain.service.ts`) makes the brain once.
  Signed in to GitHub, it reads `repos/<login>/brain` with `gh api`, creates it private through `repositories.create-github-repository` (0159) when it is missing, adopts it when it is private, and refuses it when it is public: "<owner>/brain is public. Malini keeps a brain only in a private repository."
  Without GitHub, or with `sync: false`, it starts a git repository in `<checkouts>/brain` on this Mac, which takes pushes into its own checkout (`receive.denyCurrentBranch=updateInstead`) with its hooks off.
  Either way it connects the repository like any other and starts one workstream in it named **Brain**, whose checkout is the brain: capture appends there, the agent writes there, the Brain page reads there and Obsidian opens it.
  A brain on this Mac cannot sync later: "This brain lives on this Mac only. It has no GitHub repository to sync with."
- **Its state is settings.**
  `brain.repository-id`, `brain.workstream-id`, `brain.sync`, `brain.since-seq`, `brain.synced-at`, `brain.problem` and `brain.caught-up-on` live in `settings`.
  `brain.since-seq` is the newest event when the brain was made, so nothing typed before it lands in the log.
  When the Brain workstream is archived, the next run that needs it starts a new one in the same repository.
- **Two automations.**
  **Capture to the log** (`capture-brain`) runs without an agent (0181).
  **Write the notes** (`write-brain-notes`) is an agent automation, `every sunday at 18:00`, whose builder-minded instructions, products, bets, lessons, people, decisions and open questions, live only in its editable instructions.
  Both start Off and are triggerable; `brain.set-up` turns them on, and Reset keeps their trigger.
  Every run of either, from a trigger, a schedule, a Then, the agent's tools or **Run**, runs in the Brain workstream: `automations.run` targets it through `brainWorkstream`, which `src/main/modules.ts` hands from the brain to the automations platform, and refuses with "Set up the brain first in Settings, Brain." when there is none.
- **Write the notes sees only the brain.**
  Its boundary is the event's facts, no automation before it, no chat, no attachment and no internet, so under 0167 it reads and writes its checkout and nothing else.
  When it succeeds, Malini puts back whatever it changed under `log/` (`restoreLog` in `brain-git.ts`) before it commits, so the log stays append-only whatever the instructions say.
- **A slice of its own.**
  `src/lib/brain` holds the platform (`brain.platform.ts`, with `brain.status`, `brain.set-up`, `brain.set-sync`, `brain.list`, `brain.read`, `brain.capture` and the `brain:changed` event) and the renderer layers behind `brain.api.ts`; the Brain page, its route, Settings, Brain with its **Open the brain** and setup's checkbox live in `app`, and **Brain** in the profile menu lives in `stats`.
  `brain.read` opens only a `.md` file under `notes/` or `log/`, and lists the notes that link to it with `[[<path>]]` as **Linked from**.

## Consequences

- What you typed survives the archive, in plain markdown you own, and the notes are only one rewrite of a log that never changes.
- What the brain pays attention to is a prompt you edit on the automation's page, not a Malini release.
- The brain is a repository in the sidebar like any other, so the sandbox, automations and Update from main reach it with no special case.
- Malini makes no new outbound call: GitHub is reached through the GitHub CLI and git with the credentials Malini already uses, and the agent reaches only Anthropic.
- Enforced by `src/lib/brain/platform/brain-git.test.ts` (a brain on this Mac, landing the notes with `log/` put back), `src/lib/automations/platform/register.test.ts` (the two seeded builtins and their boundary), `src/main/db/migrations.test.ts` and `tests/e2e/brain.spec.ts` (the notes run only in the brain, a public repository is refused, a brain on this Mac).
