import { extractChangedFiles, parseUnifiedDiff, type ChangedFile, type DiffFile } from './diff';

export type WorkstreamDiff = Readonly<{
	files: ChangedFile[];
	diffByPath: Record<string, DiffFile>;
	raw: string;
}>;

export function workstreamDiffFromPatch(raw: string): WorkstreamDiff {
	const diffByPath: Record<string, DiffFile> = {};
	for (const file of parseUnifiedDiff(raw)) {
		const path = file.newPath ?? file.oldPath ?? '';
		if (path) diffByPath[path] = file;
	}
	return { files: extractChangedFiles(raw), diffByPath, raw };
}
