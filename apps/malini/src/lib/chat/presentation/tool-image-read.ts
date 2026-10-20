import { toolActionKind } from './tool-display-name';

export type ToolImageRead = {
	path: string;
	fileName: string;
	mediaType: string;
};

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

export function toolImageRead(
	name: string,
	input: unknown,
	output: unknown,
	workstreamId: string | null,
): ToolImageRead | null {
	if (toolActionKind(name, input) !== 'read') return null;
	if (typeof output !== 'string' || output.trim() !== BRIDGE_IMAGE_OUTPUT) return null;

	const path = stringAt(input, PATH_KEYS);
	const mediaType = IMAGE_MEDIA_TYPES[path?.split('.').pop()?.toLowerCase() ?? ''];
	if (!path || !mediaType) return null;

	const read = workstreamRelativePath(path, workstreamId);
	return { path: read, fileName: read.split('/').filter(Boolean).pop() ?? read, mediaType };
}

function workstreamRelativePath(path: string, workstreamId: string | null): string {
	const worktree = `/workstreams/${workstreamId}/`;
	const at = workstreamId === null ? -1 : path.indexOf(worktree);
	return at === -1 ? path : path.slice(at + worktree.length);
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
