import { mcpServerDisplayName } from './session-runtime-metadata';
import { relativizeWorkstreamPath } from './workstream-path';

export type ToolActionKind = 'command' | 'read' | 'edit' | 'search' | 'other';
export type ToolActivityStatus = 'running' | 'completed';

const GENERIC_NAME_KEYS = new Set([
	'',
	'tool',
	'tool_call',
	'tool_use',
	'unknown_tool',
	'function',
	'function_call',
]);

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
	'tool',
	'tool_name',
	'toolName',
	'function',
	'operation',
	'command',
	'cmd',
	'action',
	'query',
	'pattern',
	'glob',
	'search',
	'name_pattern',
	...TOOL_PATH_KEYS,
] as const;

const MAX_LIVE_INPUT_SUMMARY_CHARS = 4_096;

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

const IDENTIFIER_LABELS: Readonly<Record<string, string>> = {
	apply_patch: 'apply_patch',
	bash: 'Bash',
	computer_use: 'Computer Use',
	'computer-use': 'Computer Use',
	edit: 'Edit',
	edit_file: 'Edit',
	editfile: 'Edit',
	exec_command: 'Exec Command',
	read: 'Read',
	read_file: 'Read',
	readfile: 'Read',
	shell: 'Shell',
	view_image: 'View Image',
	web_search: 'Web Search',
	websearch: 'Web Search',
	write: 'Write',
	write_file: 'Write',
	writefile: 'Write',
};

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
	if (isGenericName(trimmed)) return inferGenericToolName(input);

	const mcpMatch = /^mcp__([^_].*?)__(.+)$/iu.exec(trimmed);
	if (mcpMatch) {
		return contextualToolName(joinedProtocolLabel(mcpMatch[1] ?? '', mcpMatch[2] ?? ''), input);
	}

	const slashIndex = trimmed.lastIndexOf('/');
	if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
		return contextualToolName(
			joinedProtocolLabel(trimmed.slice(0, slashIndex), trimmed.slice(slashIndex + 1)),
			input,
		);
	}

	const dotMatch = /^(?:functions?|tools?)\.(.+)$/iu.exec(trimmed);
	if (dotMatch) return contextualToolName(identifierLabel(dotMatch[1] ?? trimmed), input);

	return contextualToolName(identifierLabel(trimmed), input);
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

export function toolDescriptionLabel(rawName: string, input: unknown): string | null {
	const describable =
		AGENT_TOOL_NAMES.has(rawName.trim()) || toolActionKind(rawName, input) === 'command';
	if (!describable) return null;
	const description = stringAt(input, ['description']);
	return description ? short(description) : null;
}

export function toolActivityLabel(
	rawName: string,
	input: unknown,
	status: ToolActivityStatus,
): string {
	const displayName = toolDisplayName(rawName, input);
	const kind = toolActionKind(rawName, input);
	const path = stringAt(input, TOOL_PATH_KEYS);
	const command = stringAt(input, ['command', 'cmd']);
	const query = stringAt(input, ['query', 'pattern', 'glob', 'search', 'name_pattern']);

	if (kind === 'command' && command) return `${displayName} · ${short(command)}`;
	if ((kind === 'read' || kind === 'edit') && path) {
		return `${displayName} · ${relativizeWorkstreamPath(path)}`;
	}
	if (kind === 'search' && query) return `${displayName} · ${short(query)}`;
	if (isBackgroundAgent(rawName, input)) return displayName;
	return status === 'running' ? `Running ${displayName}` : displayName;
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

function inferGenericToolName(input: unknown): string {
	if (!isRecord(input)) return 'Unknown operation';
	const record = input;

	for (const key of ['tool', 'tool_name', 'toolName', 'function', 'operation']) {
		const candidate = record[key];
		if (typeof candidate === 'string' && !isGenericName(candidate)) {
			return toolDisplayName(candidate);
		}
	}
	if (stringAt(record, ['command', 'cmd'])) return 'Bash';
	if (stringAt(record, ['patch', 'diff'])) return 'apply_patch';
	if (stringAt(record, ['query', 'pattern', 'glob', 'search', 'name_pattern'])) return 'Search';

	const action = stringAt(record, ['action']);
	if (action) {
		const normalized = identifierKey(action);
		if (
			['click', 'double_click', 'drag', 'key', 'move', 'scroll', 'screenshot', 'type'].includes(
				normalized,
			)
		) {
			return `Computer Use · ${identifierLabel(action)}`;
		}
		return identifierLabel(action);
	}

	const path = stringAt(record, TOOL_PATH_KEYS);
	if (path) {
		if (hasAny(record, ['old_string', 'new_string', 'edits', 'replacement'])) return 'Edit';
		if (hasAny(record, ['content', 'contents', 'text'])) return 'Write';
		return 'File operation';
	}
	if (stringAt(record, ['url', 'uri'])) return 'Fetch';
	return 'Unknown operation';
}

function contextualToolName(displayName: string, input: unknown): string {
	if (displayName !== 'Computer Use') return displayName;
	const action = stringAt(input, ['action']);
	return action ? `${displayName} · ${identifierLabel(action)}` : displayName;
}

function isGenericName(value: string): boolean {
	return GENERIC_NAME_KEYS.has(identifierKey(value));
}

function identifierLabel(value: string): string {
	const trimmed = value.trim();
	const known = IDENTIFIER_LABELS[trimmed.toLowerCase()];
	if (known) return known;
	const words = trimmed
		.replace(/ToolCall$/u, '')
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

function hasAny(record: Record<string, unknown>, keys: readonly string[]): boolean {
	return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

function short(value: string): string {
	const firstLine = value.split('\n')[0]?.trim() ?? value;
	return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}
