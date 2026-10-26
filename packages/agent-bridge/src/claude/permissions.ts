import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
	HookCallback,
	PermissionMode,
	PermissionUpdate,
	SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentLineage, AgentRunProfile } from '../agent-profile.js';
import type {
	AgentQuestion,
	ApprovalScope,
	PermissionCapability,
	PermissionResourceDescriptor,
	ProviderPermissionDescriptor,
} from '../interaction-types.js';
import { isRecord } from '../type-guards.js';
import { MALINI_MCP_SERVER } from './browser-tools.js';

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
	'gh pr merge',
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
const SHELL_TOKEN = /"[^"]*"|'[^']*'|&&|\|\||[;|&\n`(){}]|[^\s"';|&`(){}]+/gu;
const SHELL_OPERATOR = /^(?:&&|\|\||[;|&\n`(){}])$/u;
const BRANCH_COMMANDS = new Set(['git checkout', 'git switch', 'git worktree']);

const NO_WORKAROUND =
	'Do not work around this with another clone, git worktree, gh api or a script.';

export function workElsewhere(lead: boolean): string {
	return lead
		? 'start a workstream with `workstreams_create` from the `malini` MCP server, after `repositories_clone` when Malini lacks the repository, with `base` set to a tag, branch or commit to start there, and hand its chat the task in `prompt`'
		: 'say so in your report and name the repository, for the user to start that work from a chat at Home or in its organization: a workstream never starts another workstream';
}

export function steerToMalini(lead: boolean): HookCallback {
	return async (input) => {
		if (input.hook_event_name !== 'PreToolUse' || !isRecord(input.tool_input)) return {};
		const command = input.tool_input['command'];
		if (typeof command !== 'string') return {};
		const owned = maliniOwnedCommand(command);
		if (owned !== null) {
			return {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'deny',
					permissionDecisionReason: refusal(owned, lead),
				},
			};
		}
		if (!clonesRepository(command)) return {};
		return {
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				additionalContext: `To change that repository's code, ${workElsewhere(lead)}: Malini commits, pushes and opens pull requests only from its workstreams. A clone made with git is only for reading code.`,
			},
		};
	};
}

function refusal(owned: string, lead: boolean): string {
	return BRANCH_COMMANDS.has(owned)
		? `Malini runs \`${owned}\` itself: it owns this workstream's branch and every worktree. To restore files, use git restore. To change code in another repository, such as a fork, or apart from this branch, ${workElsewhere(lead)}. ${NO_WORKAROUND}`
		: `Malini runs \`${owned}\` itself: leave your changes in the working tree, and Malini commits, pushes, opens and merges pull requests. When the user asks you to open a pull request or to merge, run the Open draft or Merge job with \`jobs_run\` from the \`malini\` MCP server. ${NO_WORKAROUND}`;
}

export function maliniOwnedCommand(command: string): string | null {
	for (const [program, args] of programCalls(command)) {
		if (program === 'git') {
			const owned = ownedGitSubcommand(args);
			if (owned !== null) return owned;
		}
		if (program === 'gh' && args[0] === 'pr' && (args[1] === 'create' || args[1] === 'merge')) {
			return `gh pr ${args[1]}`;
		}
	}
	return null;
}

function clonesRepository(command: string): boolean {
	return programCalls(command).some(
		([program, args]) =>
			(program === 'git' && args[gitSubcommandAt(args)] === 'clone') ||
			(program === 'gh' &&
				args[0] === 'repo' &&
				(args[1] === 'clone' || (args[1] === 'fork' && args.includes('--clone')))),
	);
}

// ponytail: tokenizes quotes and operators, not a shell grammar; eval, aliases, scripts and $(…) inside double quotes still pass. Parse a real shell grammar if agents reach for those.
function programCalls(command: string): (readonly [program: string, args: string[]])[] {
	const segments: string[][] = [[]];
	for (const [token] of command.matchAll(SHELL_TOKEN)) {
		if (SHELL_OPERATOR.test(token)) segments.push([]);
		else segments.at(-1)?.push(token.replace(/^(["'])(.*)\1$/su, '$2'));
	}
	return segments.map((words) => {
		let at = 0;
		while (at < words.length && isCommandPrefix(words[at] ?? '', at)) at += 1;
		return [basename(words[at] ?? ''), words.slice(at + 1)] as const;
	});
}

function isCommandPrefix(word: string, at: number): boolean {
	return (
		ENV_ASSIGNMENT.test(word) || COMMAND_PREFIXES.has(word) || (at > 0 && word.startsWith('-'))
	);
}

function gitSubcommandAt(args: readonly string[]): number {
	let at = 0;
	while (args[at]?.startsWith('-')) at += GIT_OPTIONS_TAKING_A_VALUE.has(args[at] ?? '') ? 2 : 1;
	return at;
}

function ownedGitSubcommand(args: readonly string[]): string | null {
	const at = gitSubcommandAt(args);
	const subcommand = args[at];
	if (subcommand === undefined) return null;
	if (OWNED_GIT_SUBCOMMANDS.has(subcommand)) return `git ${subcommand}`;
	const action = args[at + 1];
	if (subcommand === 'worktree') return action === 'list' ? null : 'git worktree';
	const writesStash =
		action === undefined || action.startsWith('-') || STASH_WRITES.includes(action);
	return subcommand === 'stash' && writesStash ? 'git stash' : null;
}

export const LEAD_EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const;

export function disallowedTools(lineage?: AgentLineage): string[] {
	return [
		...MALINI_OWNED_GIT_COMMANDS.map((command) => `Bash(${command}:*)`),
		'Bash(git stash)',
		'Bash(git stash -*)',
		...STASH_WRITES.map((write) => `Bash(git stash ${write}:*)`),
		...(lineage?.lead ? LEAD_EDIT_TOOLS : []),
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
	Record<
		string,
		readonly [capability: PermissionCapability, action: string, nameKey: string | null]
	>
> = {
	mcp__malini__jobs_save: ['write', 'Save job', 'name'],
	mcp__malini__jobs_run: ['execute', 'Run job', 'job'],
	mcp__malini__repositories_clone: ['write', 'Clone repository', 'repository'],
	mcp__malini__repositories_hide: ['write', 'Hide repository', 'repository'],
	mcp__malini__workstreams_create: ['write', 'Start a workstream in', 'repository'],
	mcp__malini__workstreams_archive: ['write', 'Archive workstream', 'workstream'],
};

export function isMaliniTool(toolName: string): boolean {
	return toolName.startsWith(`mcp__${MALINI_MCP_SERVER}__`);
}

function maliniWriteDescriptor(
	toolName: string,
	input: Record<string, unknown>,
): ProviderPermissionDescriptor | null {
	const write = MALINI_WRITE_TOOLS[toolName];
	if (!write) return null;
	const [capability, action, nameKey] = write;
	const name = nameKey && (stringField(input, nameKey) ?? stringField(input, 'id'));
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
	toolName: string,
	suggestions: readonly PermissionUpdate[] | undefined,
	scope: ApprovalScope,
): PermissionUpdate[] | undefined {
	if (scope === 'once' || isMaliniTool(toolName) || !suggestions || suggestions.length === 0) {
		return undefined;
	}
	return suggestions.map((suggestion) => ({ ...suggestion, destination: 'session' }));
}

export function approvedInput(
	toolName: string,
	input: Record<string, unknown>,
	updatedInput: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	return updatedInput && isMaliniTool(toolName) ? { ...updatedInput } : input;
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
