import { languageForPath } from '@malini/extension-api';

export type ToolPayloadBlock = Readonly<{ label: string; code: string; language: string | null }>;

const CODE_FIELDS: Readonly<Record<string, 'file' | 'shell' | 'diff'>> = {
	content: 'file',
	old_string: 'file',
	new_string: 'file',
	new_source: 'file',
	code: 'file',
	command: 'shell',
	script: 'shell',
	patch: 'diff',
	diff: 'diff',
};

export function toolInputBlocks(input: unknown, path: string | null): readonly ToolPayloadBlock[] {
	if (!isRecord(input)) return [jsonBlock('Input', input)];
	const fields: Record<string, unknown> = {};
	const code: ToolPayloadBlock[] = [];
	for (const [key, value] of Object.entries(input)) {
		const field = CODE_FIELDS[key];
		if (field === undefined || typeof value !== 'string') {
			fields[key] = value;
			continue;
		}
		code.push({ label: key, code: value, language: fieldLanguage(field, path) });
	}
	if (code.length === 0) return [jsonBlock('Input', input)];
	return Object.keys(fields).length > 0 ? [jsonBlock('Input', fields), ...code] : code;
}

export function toolOutputBlock(
	output: unknown,
	path: string | null,
	readsFile: boolean,
): ToolPayloadBlock {
	if (typeof output !== 'string') return jsonBlock('Output', output);
	return {
		label: 'Output',
		code: output,
		language: readsFile && path ? languageForPath(path) : null,
	};
}

function jsonBlock(label: string, value: unknown): ToolPayloadBlock {
	return { label, code: formatJson(value), language: 'json' };
}

function fieldLanguage(field: 'file' | 'shell' | 'diff', path: string | null): string | null {
	if (field === 'file') return path ? languageForPath(path) : null;
	return field;
}

function formatJson(value: unknown): string {
	if (value === undefined) return '(not provided)';
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
