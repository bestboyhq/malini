import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PermissionMode, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunProfile } from '../agent-profile.js';
import type {
	AgentQuestion,
	ApprovalScope,
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
	'git stash',
	'git checkout',
	'git switch',
	'git restore',
	'git reset',
	'git clean',
	'git rebase',
	'git merge',
	'gh pr create',
] as const;

export function disallowedTools(): string[] {
	return MALINI_OWNED_GIT_COMMANDS.map((command) => `Bash(${command}:*)`);
}

export function permissionModeFor(profile: AgentRunProfile | undefined): PermissionMode {
	if (profile?.mode === 'plan') return 'plan';
	switch (profile?.access ?? 'sandboxed') {
		case 'full':
			return 'bypassPermissions';
		case 'auto':
			return 'auto';
		case 'sandboxed':
			return 'acceptEdits';
	}
}

export function sandboxFor(profile: AgentRunProfile | undefined): {
	enabled: boolean;
	autoAllowBashIfSandboxed?: boolean;
} {
	return (profile?.access ?? 'sandboxed') === 'sandboxed'
		? { enabled: true, autoAllowBashIfSandboxed: true }
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
	if (toolName.startsWith('mcp__')) {
		const server = toolName.split('__')[1] ?? toolName;
		return {
			capability: 'external-service',
			resources: [{ kind: 'service', value: server, boundary: 'external' }],
		};
	}
	return { capability: 'execute', resources: [toolResource(toolName)] };
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
