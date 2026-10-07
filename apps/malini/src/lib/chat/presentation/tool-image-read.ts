import { toolActionKind } from './tool-display-name';
import { relativizeWorkstreamPath } from './workstream-path';

export type ToolImageRead = {
	path: string;
	fileName: string;
	mediaType: string;
	bytes: number | null;
	note: string | null;
	previewable: boolean;
};

const IMAGE_MEDIA_PREFIX = 'image/';

const PATH_KEYS = [
	'path',
	'file_path',
	'filePath',
	'file',
	'filename',
	'notebook_path',
	'notebookPath',
] as const;

const BRIDGE_IMAGE_OUTPUT = '[image]';

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

export function toolImageRead(name: string, input: unknown, output: unknown): ToolImageRead | null {
	if (toolActionKind(name, input) !== 'read') return null;
	const record = typeof output === 'string' ? bridgeImageOutput(output, input) : asRecord(output);
	if (!record || record.kind !== 'image') return null;

	const mediaType = stringAt(record, ['mediaType', 'media_type']);
	if (!mediaType?.startsWith(IMAGE_MEDIA_PREFIX)) return null;

	const path = stringAt(record, PATH_KEYS) ?? stringAt(asRecord(input), PATH_KEYS);
	if (!path) return null;

	const relative = relativizeWorkstreamPath(path);
	return {
		path: relative,
		fileName: relative.split('/').filter(Boolean).pop() ?? relative,
		mediaType,
		bytes: numberAt(record, ['bytesRead', 'bytes_read', 'size']),
		note: stringAt(record, ['note']),
		previewable: !relative.startsWith('/') && !relative.startsWith('~'),
	};
}

function bridgeImageOutput(output: string, input: unknown): Record<string, unknown> | null {
	if (output.trim() !== BRIDGE_IMAGE_OUTPUT) return null;
	const path = stringAt(asRecord(input), PATH_KEYS);
	const mediaType = IMAGE_MEDIA_TYPES[path?.split('.').pop()?.toLowerCase() ?? ''];
	return mediaType ? { kind: 'image', mediaType } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
	if (!record) return null;
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	}
	return null;
}

function numberAt(record: Record<string, unknown>, keys: readonly string[]): number | null {
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
	}
	return null;
}
