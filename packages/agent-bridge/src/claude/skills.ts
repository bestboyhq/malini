import { query as sdkQuery, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSkill, AgentSkillSource } from '../protocol.js';
import { idle } from './capabilities.js';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment, type ClaudeContextUsage, type QueryFunction } from './session.js';

const SKILLS_TIMEOUT_MS = 15_000;
const MAX_DESCRIPTION_CHARACTERS = 280;
const PLUGIN_PREFIX = /^\([^)]*\)\s*/u;

type SkillFrontmatter = NonNullable<ClaudeContextUsage['skills']>['skillFrontmatter'][number];

export interface SkillListOptions {
	readonly findExecutable?: () => string | null;
	readonly query?: QueryFunction;
}

export async function listClaudeSkills(
	cwd: string,
	options: SkillListOptions = {},
): Promise<AgentSkill[]> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) throw new Error('Claude Code is not installed');
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), SKILLS_TIMEOUT_MS);
	const probe = (options.query ?? sdkQuery)({
		prompt: idle(released),
		options: {
			cwd,
			abortController,
			pathToClaudeCodeExecutable: executable,
			env: claudeEnvironment(),
			settingSources: ['user', 'project', 'local'],
			settings: { disableAllHooks: true },
			mcpServers: {},
			strictMcpConfig: true,
			persistSession: false,
			skills: 'all',
		},
	});
	try {
		const init = await probe.initializationResult();
		const usage = await probe.getContextUsage({ detail: 'summary' });
		return agentSkills(usage.skills?.skillFrontmatter ?? [], init.commands);
	} finally {
		clearTimeout(timeout);
		release();
		probe.close();
	}
}

export function agentSkills(
	frontmatter: readonly SkillFrontmatter[],
	commands: readonly SlashCommand[],
): AgentSkill[] {
	const descriptions = new Map(commands.map(({ name, description }) => [name, description]));
	return frontmatter.map(({ name, source, tokens }) => {
		const origin = skillSource(source);
		return {
			name,
			description: cleanDescription(descriptions.get(name) ?? '', origin),
			source: origin,
			tokens,
		};
	});
}

function cleanDescription(description: string, source: AgentSkillSource): string {
	const unprefixed = source === 'plugin' ? description.replace(PLUGIN_PREFIX, '') : description;
	const text = unprefixed.replace(/\s+/gu, ' ').trim();
	if ([...text].length <= MAX_DESCRIPTION_CHARACTERS) return text;
	return `${[...text]
		.slice(0, MAX_DESCRIPTION_CHARACTERS - 1)
		.join('')
		.trimEnd()}…`;
}

function skillSource(source: string): AgentSkillSource {
	if (source === 'userSettings') return 'personal';
	if (source === 'projectSettings' || source === 'localSettings') return 'repository';
	if (source === 'plugin') return 'plugin';
	if (source === 'built-in' || source === 'bundled') return 'claude-code';
	return 'other';
}
