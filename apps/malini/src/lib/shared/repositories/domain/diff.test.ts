import { describe, expect, it } from 'vitest';
import {
	extractChangedFiles,
	parseUnifiedDiff,
	summarizeAdditionsDeletions,
	type DiffFile,
} from './diff';
import { workstreamDiffFromPatch } from './workstream-diff';

const SAMPLE_DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 0123..4567 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,2 +1,3 @@',
	' line one',
	'-line two removed',
	'+line two added',
	'+line three added',
	'@@ -10,2 +11,3 @@ const head = 1;',
	' line ten',
	'-line old eleven removed',
	'+line eleven added',
	'+line twelve added',
].join('\n');

const NEW_FILE_DIFF = [
	'diff --git a/src/new.ts b/src/new.ts',
	'new file mode 100644',
	'index 0000000..abcdef',
	'--- /dev/null',
	'+++ b/src/new.ts',
	'@@ -0,0 +1,3 @@',
	'+export const a = 1;',
	'+export const b = 2;',
	'+export const c = 3;',
].join('\n');

const DELETED_FILE_DIFF = [
	'diff --git a/src/old.ts b/src/old.ts',
	'deleted file mode 100644',
	'index abc..0000000',
	'--- a/src/old.ts',
	'+++ /dev/null',
	'@@ -1,2 +0,0 @@',
	'-export const removed = true;',
	'-export const other = false;',
].join('\n');

const HEADER_ONLY_DIFF = [
	'diff --git "a/assets/caf\\303\\251 logo.png" "b/assets/caf\\303\\251 logo.png"',
	'new file mode 100644',
	'index 0000000..abcdef1',
	'Binary files /dev/null and "b/assets/caf\\303\\251 logo.png" differ',
	'diff --git a/scripts/run me.sh b/scripts/run me.sh',
	'old mode 100644',
	'new mode 100755',
	'diff --git "a/empty file.txt" "b/empty file.txt"',
	'deleted file mode 100644',
	'index e69de29..0000000',
].join('\n');

function firstDiffFile(files: readonly DiffFile[]): DiffFile {
	const file = files[0];
	if (!file) throw new Error('Expected a parsed diff file');
	return file;
}

describe('parseUnifiedDiff', () => {
	it('extracts file, hunks, and per-line kind for a modified file', () => {
		const files = parseUnifiedDiff(SAMPLE_DIFF);
		expect(files).toHaveLength(1);

		const file = firstDiffFile(files);
		expect(file.oldPath).toBe('src/a.ts');
		expect(file.newPath).toBe('src/a.ts');
		expect(file.status).toBe('modified');
		expect(file.hunks).toHaveLength(2);

		const firstHunk = file.hunks[0];
		expect(firstHunk?.oldStart).toBe(1);
		expect(firstHunk?.oldLines).toBe(2);
		expect(firstHunk?.newStart).toBe(1);
		expect(firstHunk?.newLines).toBe(3);

		expect(firstHunk?.lines).toEqual([
			{ kind: 'context', oldLine: 1, newLine: 1, text: 'line one' },
			{ kind: 'deleted', oldLine: 2, newLine: null, text: 'line two removed' },
			{ kind: 'added', oldLine: null, newLine: 2, text: 'line two added' },
			{ kind: 'added', oldLine: null, newLine: 3, text: 'line three added' },
		]);

		expect(file.additions).toBe(4);
		expect(file.deletions).toBe(2);
	});

	it('categorises new-file hunks as added', () => {
		const files = parseUnifiedDiff(NEW_FILE_DIFF);
		expect(files).toHaveLength(1);
		const file = firstDiffFile(files);
		expect(file.status).toBe('added');
		expect(file.oldPath).toBeNull();
		expect(file.newPath).toBe('src/new.ts');
		expect(file.additions).toBe(3);
		expect(file.deletions).toBe(0);
	});

	it('categorises deleted-file hunks as deleted', () => {
		const files = parseUnifiedDiff(DELETED_FILE_DIFF);
		expect(files).toHaveLength(1);
		const file = firstDiffFile(files);
		expect(file.status).toBe('deleted');
		expect(file.oldPath).toBe('src/old.ts');
		expect(file.newPath).toBeNull();
		expect(file.additions).toBe(0);
		expect(file.deletions).toBe(2);
	});

	it('returns an empty list for a no-op diff', () => {
		expect(parseUnifiedDiff('')).toEqual([]);
	});

	it('extracts multiple files in order', () => {
		const combined = `${SAMPLE_DIFF}\n${NEW_FILE_DIFF}`;
		const files = parseUnifiedDiff(combined);
		expect(files).toHaveLength(2);
		expect(files[0]?.status).toBe('modified');
		expect(files[1]?.status).toBe('added');
	});

	it('keeps distinct paths for binary, mode-only, and empty header-only changes', () => {
		const files = parseUnifiedDiff(HEADER_ONLY_DIFF);

		expect(files).toHaveLength(3);
		expect(
			files.map(({ oldPath, newPath, status, additions, deletions }) => ({
				oldPath,
				newPath,
				status,
				additions,
				deletions,
			})),
		).toEqual([
			{
				oldPath: null,
				newPath: 'assets/café logo.png',
				status: 'added',
				additions: 0,
				deletions: 0,
			},
			{
				oldPath: 'scripts/run me.sh',
				newPath: 'scripts/run me.sh',
				status: 'modified',
				additions: 0,
				deletions: 0,
			},
			{
				oldPath: 'empty file.txt',
				newPath: null,
				status: 'deleted',
				additions: 0,
				deletions: 0,
			},
		]);
	});

	it('says why a file has no line delta instead of leaving it at zero', () => {
		const files = parseUnifiedDiff(HEADER_ONLY_DIFF);

		expect(
			files.map(({ newPath, oldPath, noLineChange }) => [newPath ?? oldPath, noLineChange]),
		).toEqual([
			['assets/café logo.png', 'binary'],
			['scripts/run me.sh', 'mode'],
			['empty file.txt', 'empty'],
		]);
	});

	it('leaves noLineChange null for a file that really does change lines', () => {
		expect(parseUnifiedDiff(SAMPLE_DIFF).map(({ noLineChange }) => noLineChange)).toEqual([null]);
	});
});

describe('extractChangedFiles', () => {
	it('returns a flat ChangedFile[] mirroring the parse order', () => {
		const files = extractChangedFiles(SAMPLE_DIFF);
		expect(files).toHaveLength(1);
		expect(files[0]).toEqual({
			path: 'src/a.ts',
			status: 'modified',
			additions: 4,
			deletions: 2,
		});
	});

	it('uses newPath over oldPath for added files', () => {
		const files = extractChangedFiles(NEW_FILE_DIFF);
		expect(files[0]?.path).toBe('src/new.ts');
		expect(files[0]?.status).toBe('added');
	});

	it('returns no files for empty diff text', () => {
		expect(extractChangedFiles('')).toHaveLength(0);
	});
});

describe('summarizeAdditionsDeletions', () => {
	it('counts plus and minus lines but excludes the diff header markers', () => {
		const summary = summarizeAdditionsDeletions(SAMPLE_DIFF);
		expect(summary.additions).toBe(4);
		expect(summary.deletions).toBe(2);
	});

	it('counts zero for empty diffs', () => {
		expect(summarizeAdditionsDeletions('')).toEqual({ additions: 0, deletions: 0 });
	});
});

describe('workstreamDiffFromPatch', () => {
	it('indexes each parsed file by its path next to the flat changed-file list', () => {
		const diff = workstreamDiffFromPatch(`${SAMPLE_DIFF}\n${DELETED_FILE_DIFF}`);

		expect(diff.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/old.ts']);
		expect(Object.keys(diff.diffByPath)).toEqual(['src/a.ts', 'src/old.ts']);
		expect(diff.diffByPath['src/old.ts']?.status).toBe('deleted');
	});

	it('is empty for an empty patch', () => {
		expect(workstreamDiffFromPatch('')).toEqual({ files: [], diffByPath: {}, raw: '' });
	});
});
