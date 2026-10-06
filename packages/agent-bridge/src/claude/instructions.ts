import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '../generated/protocol-contract.js';
import { MALINI_OWNED_GIT_COMMANDS } from './permissions.js';

const MAX_AGENTS_MD_BYTES = 64 * 1024;

export const MALINI_INSTRUCTIONS = [
	'<malini>',
	'You are running inside malini, a desktop app that gives each workstream its own git worktree.',
	`- Files the user attaches live under ${BRIDGE_AGENT_ATTACHMENTS_PATH}. Read images with the Read tool.`,
	`- malini owns commits, pushes, branches and pull requests. Leave your changes in the working tree; ${MALINI_OWNED_GIT_COMMANDS.join(', ')} are refused.`,
	'- When you changed files, end your final message with one line `Commit: <subject>`: the whole change as an imperative summary of at most 72 characters, in the style `git log` shows for this repository. malini uses it as the commit message.',
	'- After it, add one line `Pull request: <title>`: every change on this branch versus its base as one title in the same style. malini uses it as the pull request title.',
	'</malini>',
].join('\n');

export function systemPromptAppend(cwd: string): string {
	const agentsMd = projectAgentsMd(cwd);
	return agentsMd
		? `${MALINI_INSTRUCTIONS}\n\n<agents_md path="AGENTS.md">\n${agentsMd}\n</agents_md>`
		: MALINI_INSTRUCTIONS;
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
