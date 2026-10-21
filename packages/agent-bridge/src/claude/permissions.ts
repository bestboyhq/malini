import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
	HookCallback,
	PermissionMode,
	PermissionUpdate,
	SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunProfile } from '../agent-profile.js';
import type {
	AgentQuestion,
	ApprovalScope,
	PermissionCapability,
	PermissionResourceDescriptor,
	ProviderPermissionDescriptor,
} from '../interaction-types.js';
import { isRecord } from '../type-guards.js';

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch', 'SandboxNetworkAccess']);

export const MALINI_OWNED_GIT_COMMANDS = [
	'git commit',
	'git push',
	'git checkout',
	'git switch',
	'git reset',
	'git clean',
	'git rebase',
	'git merge',
	'gh pr create',
] as const;

const STASH_WRITES = ['push', 'save', 'pop', 'apply', 'drop', 'clear', 'store', 'branch'];

const OWNED_GIT_SUBCOMMANDS = new Set(
	MALINI_OWNED_GIT_COMMANDS.filter((command) => command.startsWith('git ')).map((command) =>
		command.slice('git '.length),
	),
);
const GIT_OPTIONS_TAKING_A_VALUE = new Set([
	'-C',
	'-c',
	'--git-dir',
	'--work-tree',
	'--namespace',
	'--config-env',
	'--exec-path',
]);
const COMMAND_PREFIXES = new Set(['env', 'command', 'exec', 'sudo', 'nohup', 'time']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

export const refuseMaliniOwnedCommands: HookCallback = async (input) => {
	if (input.hook_event_name !== 'PreToolUse' || !isRecord(input.tool_input)) return {};
	const command = input.tool_input['command'];
	const owned = typeof command === 'string' ? maliniOwnedCommand(command) : null;
	if (owned === null) return {};
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: `Malini runs \`${owned}\` itself: leave your changes in the working tree, and Malini commits, pushes and opens the pull request.`,
		},
	};
};

// ponytail: splits on shell operators with naive quoting, not a shell parser; eval, aliases and scripts still pass. Parse a real shell grammar if agents reach for those.
export function maliniOwnedCommand(command: string): string | null {
	for (const segment of command.split(/&&|\|\||[;|&\n`(){}]/u)) {
		const words = (segment.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []).map((word) =>
			word.replace(/^(["'])(.*)\1$/u, '$2'),
		);
		let at = 0;
		while (at < words.length && isCommandPrefix(words[at] ?? '', at)) at += 1;
		const program = basename(words[at] ?? '');
		const args = words.slice(at + 1);
		if (program === 'git') {
			const owned = ownedGitSubcommand(args);
			if (owned !== null) return owned;
		}
		if (program === 'gh' && args[0] === 'pr' && args[1] === 'create') return 'gh pr create';
	}
	return null;
}

function isCommandPrefix(word: string, at: number): boolean {
	return (
		ENV_ASSIGNMENT.test(word) || COMMAND_PREFIXES.has(word) || (at > 0 && word.startsWith('-'))
	);
}

function ownedGitSubcommand(args: readonly string[]): string | null {
	let at = 0;
	while (args[at]?.startsWith('-')) at += GIT_OPTIONS_TAKING_A_VALUE.has(args[at] ?? '') ? 2 : 1;
	const subcommand = args[at];
	if (subcommand === undefined) return null;
	if (OWNED_GIT_SUBCOMMANDS.has(subcommand)) return `git ${subcommand}`;
	const stashAction = args[at + 1];
	const writesStash =
		stashAction === undefined || stashAction.startsWith('-') || STASH_WRITES.includes(stashAction);
	return subcommand === 'stash' && writesStash ? 'git stash' : null;
}

export function disallowedTools(): string[] {
	return [
		...MALINI_OWNED_GIT_COMMANDS.map((command) => `Bash(${command}:*)`),
		'Bash(git stash)',
		'Bash(git stash -*)',
		...STASH_WRITES.map((write) => `Bash(git stash ${write}:*)`),
	];
}

export function permissionModeFor(profile: AgentRunProfile | undefined): PermissionMode {
	if (profile?.mode === 'plan') return 'plan';
	switch (profile?.access ?? 'auto') {
		case 'full':
			return 'bypassPermissions';
		case 'auto':
			return 'auto';
		case 'sandboxed':
			return 'acceptEdits';
	}
}

const GITHUB_ACTIONS_RESULTS_HOSTS = Array.from(
	{ length: 20 },
	(_, index) => `productionresultssa${index}.blob.core.windows.net`,
);
const GITHUB_HOSTS = [
	'github.com',
	'api.github.com',
	'*.githubusercontent.com',
	...GITHUB_ACTIONS_RESULTS_HOSTS,
];
const MACOS_CERTIFICATE_TRUST_SERVICE = 'com.apple.trustd.agent';

export function sandboxFor(profile: AgentRunProfile | undefined): SandboxSettings {
	return (profile?.access ?? 'auto') === 'sandboxed'
		? {
				enabled: true,
				autoAllowBashIfSandboxed: true,
				network: {
					allowedDomains: GITHUB_HOSTS,
					allowMachLookup: [MACOS_CERTIFICATE_TRUST_SERVICE],
					allowLocalBinding: true,
				},
			}
		: { enabled: false };
}

export function permissionDescriptor(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	blockedPath: string | undefined,
): ProviderPermissionDescriptor {
	if (READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)) {
		const path = blockedPath ?? stringField(input, 'file_path') ?? stringField(input, 'path');
		return {
			capability: READ_TOOLS.has(toolName) ? 'read' : 'write',
			resources: path ? [pathResource(path, cwd)] : [toolResource(toolName)],
		};
	}
	if (toolName === 'Bash') {
		const command = stringField(input, 'command') ?? '';
		return {
			capability: 'execute',
			resources: [{ kind: 'command', value: command, boundary: 'unknown' }],
		};
	}
	if (NETWORK_TOOLS.has(toolName)) {
		const target =
			stringField(input, 'url') ??
			stringField(input, 'query') ??
			stringField(input, 'host') ??
			toolName;
		return {
			capability: 'network',
			resources: [{ kind: 'url', value: target, boundary: 'external' }],
		};
	}
	const maliniWrite = maliniWriteDescriptor(toolName, input);
	if (maliniWrite) return maliniWrite;
	if (toolName.startsWith('mcp__')) {
		const server = toolName.split('__')[1] ?? toolName;
		return {
			capability: 'external-service',
			resources: [{ kind: 'service', value: server, boundary: 'external' }],
		};
	}
	return { capability: 'execute', resources: [toolResource(toolName)] };
}

const MALINI_WRITE_TOOLS: Readonly<
	Record<string, readonly [capability: PermissionCapability, action: string, nameKey: string]>
> = {
	mcp__malini__jobs_save: ['write', 'Save job', 'name'],
	mcp__malini__jobs_run: ['execute', 'Run job', 'job'],
	mcp__malini__routines_save: ['write', 'Save routine', 'label'],
};

function maliniWriteDescriptor(
	toolName: string,
	input: Record<string, unknown>,
): ProviderPermissionDescriptor | null {
	const write = MALINI_WRITE_TOOLS[toolName];
	if (!write) return null;
	const [capability, action, nameKey] = write;
	const name = stringField(input, nameKey) ?? stringField(input, 'id');
	return {
		capability,
		resources: [
			{ kind: 'tool', value: name ? `${action} ‘${name}’` : action, boundary: 'workstream' },
		],
	};
}

function toolResource(toolName: string): PermissionResourceDescriptor {
	return { kind: 'tool', value: toolName, boundary: 'unknown' };
}

function pathResource(path: string, cwd: string): PermissionResourceDescriptor {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	const canonical = canonicalPath(absolute);
	const inside = isInside(canonicalPath(cwd), canonical);
	return {
		kind: 'path',
		value: path,
		boundary: inside ? 'workstream' : 'external',
		...(inside ? {} : { canonicalValue: canonical }),
	};
}

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(canonicalPath(parent), basename(path));
	}
}

function isInside(root: string, candidate: string): boolean {
	const relation = relative(root, candidate);
	return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' && value ? value : undefined;
}

export function autoModeRule(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
): string {
	const command = toolName === 'Bash' ? stringField(input, 'command') : undefined;
	if (command) return `Bash(${escapeRuleContent(command)})`;
	const url = toolName === 'WebFetch' ? stringField(input, 'url') : undefined;
	if (url && URL.canParse(url)) return `WebFetch(domain:${new URL(url).hostname})`;
	const path =
		READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)
			? (stringField(input, 'file_path') ?? stringField(input, 'notebook_path'))
			: undefined;
	if (path) return `${toolName}(/${escapeRuleContent(resolve(cwd, path))})`;
	return toolName;
}

function escapeRuleContent(content: string): string {
	return content.replace(/[()]/gu, '\\$&');
}

export function autoModeCategory(reason: string | undefined): string {
	return reason?.trim().replace(/^\[(.+)\]$/su, '$1') || 'no reason given';
}

export function retryKey(toolName: string, input: unknown): string {
	const command = toolName === 'Bash' && isRecord(input) ? input['command'] : undefined;
	return `${toolName}\u0000${typeof command === 'string' ? command : JSON.stringify(input)}`;
}

export function rememberedPermissions(
	suggestions: readonly PermissionUpdate[] | undefined,
	scope: ApprovalScope,
): PermissionUpdate[] | undefined {
	if (scope === 'once' || !suggestions || suggestions.length === 0) return undefined;
	return suggestions.map((suggestion) => ({ ...suggestion, destination: 'session' }));
}

export function claudeQuestions(input: Record<string, unknown>): AgentQuestion[] {
	const questions = Array.isArray(input['questions']) ? input['questions'] : [];
	return questions.filter(isRecord).map((question, index) => ({
		id: `q${index}`,
		prompt: typeof question['question'] === 'string' ? question['question'] : '',
		...(typeof question['header'] === 'string' ? { header: question['header'] } : {}),
		options: (Array.isArray(question['options']) ? question['options'] : [])
			.filter(isRecord)
			.map((option) => ({
				label: typeof option['label'] === 'string' ? option['label'] : '',
				...(typeof option['description'] === 'string'
					? { description: option['description'] }
					: {}),
			})),
		multiSelect: question['multiSelect'] === true,
		allowFreeText: true,
	}));
}

export function claudeAnswers(
	questions: readonly AgentQuestion[],
	answers: readonly { readonly questionId: string; readonly values: readonly string[] }[],
): Record<string, string> {
	const byId = new Map(answers.map((answer) => [answer.questionId, answer.values]));
	return Object.fromEntries(
		questions.map((question) => [question.prompt, (byId.get(question.id) ?? []).join(', ')]),
	);
}
