# 0297 - A folder with no git history gets a first commit

Status: accepted

## Context

**A folder on this Mac** (0253) clones the folder it is given, and `git clone` of a folder with no `.git` fails with "repository '<name>' does not exist", which the setup step showed as **Copy failed**.
A folder with `.git` and no commit cloned, then stopped at "Empty repository. Push a first commit, then retry", which a folder with no remote cannot do.
Every workstream is a git worktree of that clone, so Malini needs at least one commit to start one.
Asked what Malini should do with such a folder, the user picked "Start git in it": run `git init`, commit the folder's files, then make the copy.
A folder with no GitHub remote has no **Draft** or **Merge**, since `shipTarget` refuses it as `not-github`, so its work stays on the workstream's branch in Malini's clone.

## Decision

- `prepareSeedFolder` in `src/lib/shared/repositories/platform/repository.service.ts` runs before each clone of a connected repository: in `repositories.create-repository` and in the clone that brings a lost one back.
  For a connected folder with no remote, it calls `startHistory` in `src/main/git/remote.ts` first.
- `startHistory` runs `git init -q` when the folder has no `.git`, then, while `HEAD` is unborn, `git add -A` and one `Initial commit` with hooks and signing off, under the GitHub account's noreply identity or `malini-agent[bot]`.
- The first commit leaves out `node_modules`, `.venv`, `.env`, `.env.*` and `.DS_Store` at any depth, on top of the folder's own `.gitignore`.
  Those files stay in the folder, untracked.
- Malini starts no git in a folder inside another work tree, and names that repository instead: "This folder is inside the git repository <name>. Open <name> instead."
  It starts none in the home folder or a folder above it.
  Both fail as `unsafe-folder`, an expected error kind, in the **Copy failed** step.
- A folder with commits, and a folder with a remote, stay as they are.

## Consequences

- Any folder opens a workstream, such as a downloaded zip or a folder of notes.
  A folder that failed before works on its next workstream, with no step from the user.
- Malini now writes into a folder the user picked: a `.git` folder and one commit, which the user sees in their own git tools.
  A later push of that folder publishes its files, less the ones the first commit left out.
- A folder with no GitHub remote still has no **Merge**, so its work does not land back in the folder.
- Enforced by `tests/e2e/open-folder.spec.ts`: a plain folder's first commit holds its files without `node_modules` or `.env`, and a folder inside another repository names it and gets no `.git`.
  The home-folder guard has no test.
