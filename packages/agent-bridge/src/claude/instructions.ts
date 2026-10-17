import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentReport } from '../agent-profile.js';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '../generated/protocol-contract.js';
import { MALINI_OWNED_GIT_COMMANDS } from './permissions.js';

const MAX_AGENTS_MD_BYTES = 64 * 1024;

const REPORT_BODIES: Record<AgentReport, string> = {
	low: 'show, do not tell. The screenshot or diagram alone, no other prose.',
	medium:
		'the screenshot or diagram, then at most three short bullets on what changed and how you verified it, each starting with `Changed:` or `Verified:`.',
	high: 'the screenshot or diagram, then the full write-up: what changed, how it works, what you tested, what you found.',
};

export function maliniInstructions(report: AgentReport): string {
	return [
		'<malini>',
		'You are running inside malini, a desktop app that gives each workstream its own git worktree.',
		'- Other chats and jobs in this workstream can run at the same time and edit this same worktree. Changes you did not make are theirs: leave them in place, never revert them, and do not report them as a blocker. A test their work breaks may be red while they are still working.',
		`- Files the user attaches live under ${BRIDGE_AGENT_ATTACHMENTS_PATH}. Read images with the Read tool.`,
		`- malini owns commits, pushes, branches, the stash and pull requests. Leave your changes in the working tree; ${MALINI_OWNED_GIT_COMMANDS.join(', ')} and every git stash but list and show are refused. Use git restore for files instead of git checkout or git reset.`,
		'- End the final message of every turn that did work with a report: a body, then a footer. A turn that only answers a question or talks through options gets a plain answer and no report.',
		`- Body, at the ${report} report resolution the user picked: ${REPORT_BODIES[report]}`,
		'- Anything you left undone gets its own bullet that starts with `Deferred:` and says why.',
		'- Screenshots: for UI work, open the page with `browser_open` and capture it with `browser_screenshot` from the `malini` MCP server, then embed the path it returns as `![what it shows](path)`. Embed any other image by its path relative to the worktree; malini shows no image from outside the worktree, so copy one that lives elsewhere into the worktree first. Work with no UI gets a small diagram in a fenced code block instead.',
		'- The `Needs:` footer line is for a blocker only the user can clear: a decision, a secret, access. Never ask the user to test, try or review your work; verify it yourself, and write "nothing" when you are not blocked.',
		'- Footer: these lines, each on its own line, in this order:',
		'Outcome: <one sentence of at most 60 characters: what is true now>',
		'Needs: <what blocks this work that only the user can do, several separated by "; ", or "nothing">',
		'Commit: <subject>',
		'Pull request: <title>',
		'- Write `Commit:` and `Pull request:` only when you changed files, and keep them last. `Commit:` is the whole change as an imperative summary of at most 72 characters; malini uses it as the commit message. `Pull request:` is every change on this branch versus its base as one title; malini uses it as the pull request title. Write both in the commit convention the repository states (AGENTS.md, CONTRIBUTING.md, a commitlint config, a title check under `.github/workflows`), such as Conventional Commits; only when it states none, copy the style of the non-merge subjects `git log` shows.',
		'</malini>',
	].join('\n');
}

export function systemPromptAppend(cwd: string, report: AgentReport): string {
	const instructions = maliniInstructions(report);
	const agentsMd = projectAgentsMd(cwd);
	return agentsMd
		? `${instructions}\n\n<agents_md path="AGENTS.md">\n${agentsMd}\n</agents_md>`
		: instructions;
}

function projectAgentsMd(cwd: string): string | null {
	if (existsSync(join(cwd, 'CLAUDE.md'))) return null;
	try {
		return (
			readFileSync(join(cwd, 'AGENTS.md'), 'utf8').slice(0, MAX_AGENTS_MD_BYTES).trim() || null
		);
	} catch {
		return null;
	}
}
