import { toolTarget } from '$lib/chat/domain/tool-target';
import { mcpServerDisplayName } from './session-runtime-metadata';
import { relativizeWorkstreamCommand, relativizeWorkstreamPath } from './workstream-path';

export type ToolActionKind = 'command' | 'read' | 'edit' | 'search' | 'other';

const TOOL_PATH_KEYS = [
	'file_path',
	'path',
	'filePath',
	'file',
	'filename',
	'notebook_path',
	'notebookPath',
] as const;

const LIVE_INPUT_SUMMARY_KEYS = [
	'command',
	'query',
	'pattern',
	'glob',
	'search',
	'name_pattern',
	...TOOL_PATH_KEYS,
	'url',
	'selector',
] as const;

const MAX_LIVE_INPUT_SUMMARY_CHARS = 4_096;

const LEADING_CD_RE = /^(?:cd\s+(?:"[^"]*"|'[^']*'|(?:[^\s;&|\\]|\\.)+)\s*(?:&&|;|\n)\s*)+/u;

const SHELL_EXIT_RE = /^\s*Exit code (\d+)\s*(?:\n|$)/u;

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

const ACRONYM_LABELS: Readonly<Record<string, string>> = {
	api: 'API',
	cli: 'CLI',
	css: 'CSS',
	git: 'Git',
	github: 'GitHub',
	html: 'HTML',
	js: 'JavaScript',
	json: 'JSON',
	mcp: 'MCP',
	repl: 'REPL',
	sql: 'SQL',
	ui: 'UI',
	uri: 'URI',
	url: 'URL',
	ux: 'UX',
};

export function isBackgroundAgent(rawName: string, input: unknown): boolean {
	return (
		AGENT_TOOL_NAMES.has(rawName.trim()) && isRecord(input) && input['run_in_background'] === true
	);
}

export function toolDisplayName(rawName: string, input?: unknown): string {
	const trimmed = rawName.trim();
	if (isBackgroundAgent(trimmed, input)) return 'Background agent';
	const mcpMatch = /^mcp__([^_].*?)__(.+)$/iu.exec(trimmed);
	if (mcpMatch) return joinedProtocolLabel(mcpMatch[1] ?? '', mcpMatch[2] ?? '');
	return identifierLabel(trimmed);
}

export function toolActionKind(rawName: string, input?: unknown): ToolActionKind {
	const key = `${rawName} ${toolDisplayName(rawName, input)}`.toLowerCase();
	if (
		key.includes('bash') ||
		key.includes('shell') ||
		key.includes('command') ||
		key.includes('exec') ||
		key.includes('terminal')
	) {
		return 'command';
	}
	if (key.includes('read') || key.includes('view') || key.includes('cat') || key.includes('open')) {
		return 'read';
	}
	if (
		key.includes('edit') ||
		key.includes('write') ||
		key.includes('patch') ||
		key.includes('create') ||
		key.includes('update')
	) {
		return 'edit';
	}
	if (
		key.includes('search') ||
		key.includes('grep') ||
		key.includes('glob') ||
		key.includes('find')
	) {
		return 'search';
	}
	return 'other';
}

export const TOOL_FAILURE_REASON_MAX_CHARS = 240;

export function toolFailureReason(error: string | null | undefined): string | null {
	const firstLine = error
		?.split('\n')
		.map((line) => line.trim())
		.find(Boolean);
	if (!firstLine) return null;
	return firstLine.length > TOOL_FAILURE_REASON_MAX_CHARS
		? `${firstLine.slice(0, TOOL_FAILURE_REASON_MAX_CHARS - 1)}…`
		: firstLine;
}

export function shellExitCode(error: string | null | undefined): number | null {
	const code = error ? SHELL_EXIT_RE.exec(error)?.[1] : undefined;
	return code === undefined ? null : Number(code);
}

export function withoutShellExit(error: string | null): string | null {
	return error?.replace(SHELL_EXIT_RE, '') || null;
}

export function shellCommandLabel(command: string): string {
	return relativizeWorkstreamCommand(command.replace(LEADING_CD_RE, '') || command);
}

export function toolDescriptionLabel(rawName: string, input: unknown): string | null {
	const describable =
		AGENT_TOOL_NAMES.has(rawName.trim()) || toolActionKind(rawName, input) === 'command';
	if (!describable) return null;
	const description = stringAt(input, ['description']);
	return description ? short(description) : null;
}

export function toolActivityLabel(rawName: string, input: unknown): string {
	const displayName = toolDisplayName(rawName, input);
	const kind = toolActionKind(rawName, input);
	const path = stringAt(input, TOOL_PATH_KEYS);
	const command = stringAt(input, ['command']);
	const query = stringAt(input, ['query', 'pattern', 'glob', 'search', 'name_pattern']);
	const target = isRecord(input) ? toolTarget(input) : null;

	if (kind === 'command' && command) {
		return `${displayName} · ${short(shellCommandLabel(command))}`;
	}
	if ((kind === 'read' || kind === 'edit') && path) {
		return `${displayName} · ${relativizeWorkstreamPath(path)}`;
	}
	if (kind === 'search' && query) return `${displayName} · ${short(query)}`;
	if (target) return `${displayName} · ${short(relativizeWorkstreamPath(target))}`;
	return displayName;
}

export function backgroundAgentSummary(
	rawName: string,
	input: unknown,
	output: unknown,
): string | null {
	if (!isBackgroundAgent(rawName, input) || typeof output !== 'string') return null;
	const firstLine = output
		.split('\n')
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine ? short(firstLine) : null;
}

export function summarizeLiveToolInput(json: string | null | undefined): unknown {
	const trimmed = json?.trim();
	if (!trimmed) return undefined;

	if (trimmed.length <= MAX_LIVE_INPUT_SUMMARY_CHARS) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
		} catch {}
	}

	const prefix = trimmed.slice(0, MAX_LIVE_INPUT_SUMMARY_CHARS);
	const summary: Record<string, string> = {};
	for (const key of LIVE_INPUT_SUMMARY_KEYS) {
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
		const match = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'u').exec(prefix);
		if (!match) continue;
		try {
			summary[key] = JSON.parse(`"${match[1]}"`) as string;
		} catch {}
	}
	return Object.keys(summary).length > 0 ? summary : undefined;
}

function joinedProtocolLabel(rawServer: string, rawOperation: string): string {
	const server = mcpServerDisplayName(rawServer);
	const serverKey = identifierKey(rawServer.replace(/(?:[-_.:/]+mcp)$/iu, ''));
	let operationSource = rawOperation;
	const operationKey = identifierKey(operationSource);
	if (serverKey && operationKey.startsWith(`${serverKey}_`)) {
		operationSource = operationKey.slice(serverKey.length + 1);
	}
	const operation = identifierLabel(operationSource);
	return identifierKey(server) === identifierKey(operation) ? server : `${server} · ${operation}`;
}

function identifierLabel(value: string): string {
	const words = value
		.trim()
		.replace(/([a-z\d])([A-Z])/gu, '$1 $2')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.split(/\s+/u)
		.filter(Boolean);
	if (words.length === 0) return 'Unknown operation';
	return words
		.map((word) => {
			const lower = word.toLowerCase();
			const acronym = ACRONYM_LABELS[lower];
			if (acronym) return acronym;
			return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
		})
		.join(' ');
}

function identifierKey(value: string): string {
	return value
		.replace(/([a-z\d])([A-Z])/gu, '$1_$2')
		.replace(/[^\p{L}\p{N}]+/gu, '_')
		.replace(/^_+|_+$/gu, '')
		.toLowerCase();
}

function stringAt(value: unknown, keys: readonly string[]): string | null {
	if (!isRecord(value)) return null;
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function short(value: string): string {
	const firstLine = value.split('\n')[0]?.trim() ?? value;
	return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}
