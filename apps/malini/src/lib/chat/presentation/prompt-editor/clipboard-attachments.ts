export type ClipboardAttachmentCandidate = {
	file: File;
	fileName: string;
};

const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'application/pdf': 'pdf',
	'application/json': 'json',
	'text/plain': 'txt',
	'text/markdown': 'md',
};

const PLACEHOLDER_BASE_NAMES = new Set(['', 'image', 'blob', 'file', 'unknown', 'untitled']);

export function clipboardAttachmentCandidates(
	data: DataTransfer | null,
	seed = '',
): ClipboardAttachmentCandidate[] {
	if (!data) return [];
	const files = Array.from(data.files ?? []);
	const types = Array.from(data.types ?? []);
	const carriesText = types.includes('text/plain') || types.includes('text/html');

	if (carriesText && files.length === 0) return [];

	const candidates: ClipboardAttachmentCandidate[] = [];
	for (const file of files) {
		if (file.size === 0) continue;
		const fileName = candidateFileName(file, seed, candidates.length);
		if (!fileName) continue;
		candidates.push({ file, fileName });
	}
	return candidates;
}

function candidateFileName(file: File, seed: string, index: number): string | null {
	const given = (file.name ?? '').split(/[\\/]/).pop() ?? '';
	const extension = given.includes('.') ? (given.split('.').pop() ?? '') : '';
	const base = extension ? given.slice(0, -(extension.length + 1)) : given;
	if (extension && !PLACEHOLDER_BASE_NAMES.has(base.toLowerCase())) return given;

	const mintedExtension = EXTENSION_BY_MEDIA_TYPE[file.type?.toLowerCase() ?? ''] ?? extension;
	if (!mintedExtension) return null;
	const label = file.type?.startsWith('image/') ? 'pasted-image' : 'pasted-file';
	return `${label}${uniqueSuffix(seed, index)}.${mintedExtension}`;
}

function uniqueSuffix(seed: string, index: number): string {
	const safeSeed = seed
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const parts = [safeSeed, index > 0 ? String(index + 1) : ''].filter(Boolean);
	return parts.length ? `-${parts.join('-')}` : '';
}
