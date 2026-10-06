export type ChangedFileStatus = 'added' | 'modified' | 'deleted';

export type ChangedFile = {
	path: string;
	status: ChangedFileStatus;
	additions: number;
	deletions: number;
};

export type DiffLineKind = 'context' | 'added' | 'deleted';

export type DiffLine = {
	kind: DiffLineKind;
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

export type DiffHunk = {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
};

export type DiffFile = {
	oldPath: string | null;
	newPath: string | null;
	hunks: DiffHunk[];
	status: ChangedFileStatus;
	rawText: string;
	additions: number;
	deletions: number;
	noLineChange: DiffFileNoLineChange | null;
};

export type DiffFileNoLineChange = 'binary' | 'mode' | 'empty';

export const NO_LINE_CHANGE_LABEL: Readonly<Record<DiffFileNoLineChange, string>> = Object.freeze({
	binary: 'Binary',
	mode: 'Mode changed',
	empty: 'Empty file',
});

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function parseUnifiedDiff(text: string): DiffFile[] {
	if (!text || text.trim().length === 0) {
		return [];
	}

	const files: DiffFile[] = [];
	const segments = text.split(/^diff --git /m).filter((segment) => segment.trim().length > 0);

	for (const segment of segments) {
		const file = parseFileSegment(`diff --git ${segment}`);
		if (file) {
			files.push(file);
		}
	}

	return files;
}

function parseFileSegment(segment: string): DiffFile | null {
	const lines = segment.split('\n');
	if (lines.length === 0) {
		return null;
	}

	const headerLines: string[] = [];
	let bodyStart = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (line.startsWith('@@')) {
			bodyStart = i;
			break;
		}
		headerLines.push(line);
	}

	const oldPath = stripPathPrefix(extractMarkerPath(headerLines, '--- '));
	const newPath = stripPathPrefix(extractMarkerPath(headerLines, '+++ '));
	const gitHeaderPaths = extractGitHeaderPaths(headerLines);
	const oldGitPath = stripPathPrefix(gitHeaderPaths?.oldPath ?? null);
	const newGitPath = stripPathPrefix(gitHeaderPaths?.newPath ?? null);
	const status = inferStatus(headerLines, oldPath, newPath, oldGitPath, newGitPath);

	const hunks: DiffHunk[] = [];
	let additions = 0;
	let deletions = 0;

	let i = bodyStart;
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const match = HUNK_HEADER_RE.exec(line);
		if (!match) {
			i += 1;
			continue;
		}

		const oldStart = parseInt(match[1] ?? '0', 10);
		const oldLines = match[2] ? parseInt(match[2], 10) : 1;
		const newStart = parseInt(match[3] ?? '0', 10);
		const newLines = match[4] ? parseInt(match[4], 10) : 1;

		const hunkLines: DiffLine[] = [];
		let oldCursor = oldStart;
		let newCursor = newStart;
		const oldEnd = oldStart + oldLines;
		const newEnd = newStart + newLines;

		i += 1;
		while (i < lines.length) {
			const content = lines[i] ?? '';
			if (content.startsWith('diff --git ') || HUNK_HEADER_RE.test(content)) {
				break;
			}

			if (content.startsWith('\\ No newline at end of file')) {
				i += 1;
				continue;
			}

			if (content.startsWith('+')) {
				hunkLines.push({
					kind: 'added',
					oldLine: null,
					newLine: newCursor,
					text: content.slice(1),
				});
				additions += 1;
				newCursor += 1;
			} else if (content.startsWith('-')) {
				hunkLines.push({
					kind: 'deleted',
					oldLine: oldCursor,
					newLine: null,
					text: content.slice(1),
				});
				deletions += 1;
				oldCursor += 1;
			} else if (content.startsWith(' ') || content.length === 0) {
				hunkLines.push({
					kind: 'context',
					oldLine: oldCursor,
					newLine: newCursor,
					text: content.length === 0 ? '' : content.slice(1),
				});
				oldCursor += 1;
				newCursor += 1;
			}

			i += 1;

			if (oldCursor >= oldEnd && newCursor >= newEnd) {
				break;
			}
		}

		hunks.push({
			header: match[0],
			oldStart,
			oldLines,
			newStart,
			newLines,
			lines: hunkLines,
		});
	}

	const canonicalOld = status === 'added' && oldPath === null ? null : (oldPath ?? oldGitPath);
	const canonicalNew = status === 'deleted' && newPath === null ? null : (newPath ?? newGitPath);

	return {
		oldPath: canonicalOld,
		newPath: canonicalNew,
		hunks,
		status,
		rawText: segment,
		additions,
		deletions,
		noLineChange: additions === 0 && deletions === 0 ? classifyNoLineChange(lines) : null,
	};
}

function classifyNoLineChange(lines: readonly string[]): DiffFileNoLineChange {
	let sawOldMode = false;
	let sawNewMode = false;
	for (const line of lines) {
		if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) return 'binary';
		if (line.startsWith('old mode ')) sawOldMode = true;
		else if (line.startsWith('new mode ')) sawNewMode = true;
	}
	return sawOldMode && sawNewMode ? 'mode' : 'empty';
}

function extractMarkerPath(headerLines: string[], marker: string): string | null {
	for (const header of headerLines) {
		if (header.startsWith(marker)) {
			const value = decodeGitPath(header.slice(marker.length).trim());
			if (value === '/dev/null') {
				return null;
			}
			return value;
		}
	}
	return null;
}

function extractGitHeaderPaths(headerLines: string[]): { oldPath: string; newPath: string } | null {
	const header = headerLines.find((line) => line.startsWith('diff --git '));
	if (!header) return null;
	const payload = header.slice('diff --git '.length).trim();

	const first = readGitPathToken(payload, 0);
	const second = first ? readGitPathToken(payload, first.end) : null;
	if (first && second && payload.slice(second.end).trim().length === 0) {
		const oldPath = decodeGitPath(first.raw);
		const newPath = decodeGitPath(second.raw);
		if (oldPath.startsWith('a/') && newPath.startsWith('b/')) {
			return { oldPath, newPath };
		}
	}

	const candidates: Array<{ oldPath: string; newPath: string }> = [];
	let separator = payload.indexOf(' b/');
	while (separator >= 0) {
		const oldPath = decodeGitPath(payload.slice(0, separator).trim());
		const newPath = decodeGitPath(payload.slice(separator + 1).trim());
		if (oldPath.startsWith('a/') && newPath.startsWith('b/')) {
			candidates.push({ oldPath, newPath });
		}
		separator = payload.indexOf(' b/', separator + 1);
	}
	return (
		candidates.find(({ oldPath, newPath }) => oldPath.slice(2) === newPath.slice(2)) ??
		candidates[0] ??
		null
	);
}

function readGitPathToken(input: string, start: number): { raw: string; end: number } | null {
	let index = start;
	while (index < input.length && /\s/u.test(input[index] ?? '')) index += 1;
	if (index >= input.length) return null;
	const tokenStart = index;
	if (input[index] === '"') {
		index += 1;
		while (index < input.length) {
			if (input[index] === '\\') {
				index += 2;
				continue;
			}
			index += 1;
			if (input[index - 1] === '"') {
				return { raw: input.slice(tokenStart, index), end: index };
			}
		}
		return null;
	}
	while (index < input.length && !/\s/u.test(input[index] ?? '')) index += 1;
	return { raw: input.slice(tokenStart, index), end: index };
}

function decodeGitPath(raw: string): string {
	if (!(raw.startsWith('"') && raw.endsWith('"'))) return raw;
	const input = raw.slice(1, -1);
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	const escapedBytes: Record<string, number> = {
		a: 0x07,
		b: 0x08,
		t: 0x09,
		n: 0x0a,
		v: 0x0b,
		f: 0x0c,
		r: 0x0d,
		'"': 0x22,
		'\\': 0x5c,
	};

	for (let index = 0; index < input.length; index += 1) {
		const character = input[index] ?? '';
		if (character !== '\\') {
			const codePoint = input.codePointAt(index);
			if (codePoint === undefined) continue;
			const decoded = String.fromCodePoint(codePoint);
			bytes.push(...encoder.encode(decoded));
			if (codePoint > 0xffff) index += 1;
			continue;
		}

		const escaped = input[index + 1];
		if (escaped === undefined) {
			bytes.push(0x5c);
			continue;
		}
		if (/^[0-7]$/u.test(escaped)) {
			let octal = escaped;
			let consumed = 1;
			while (consumed < 3 && /^[0-7]$/u.test(input[index + 1 + consumed] ?? '')) {
				octal += input[index + 1 + consumed];
				consumed += 1;
			}
			bytes.push(Number.parseInt(octal, 8));
			index += consumed;
			continue;
		}
		bytes.push(escapedBytes[escaped] ?? escaped.charCodeAt(0));
		index += 1;
	}

	return new TextDecoder().decode(Uint8Array.from(bytes));
}

function stripPathPrefix(raw: string | null): string | null {
	if (raw === null) {
		return null;
	}
	if (raw.startsWith('a/') || raw.startsWith('b/')) {
		return raw.slice(2);
	}
	return raw;
}

function inferStatus(
	headerLines: string[],
	oldPath: string | null,
	newPath: string | null,
	oldGitPath: string | null,
	newGitPath: string | null,
): ChangedFileStatus {
	const marker = headerLines.join('\n');
	if (marker.includes('new file mode')) {
		return 'added';
	}
	if (marker.includes('deleted file mode')) {
		return 'deleted';
	}
	const oldRef = oldGitPath ?? oldPath;
	const newRef = newGitPath ?? newPath;
	if (oldRef === null && newRef !== null) {
		return 'added';
	}
	if (newRef === null && oldRef !== null) {
		return 'deleted';
	}
	if (oldRef !== null && newRef !== null && oldRef !== newRef) {
		return 'modified';
	}
	return 'modified';
}

export function extractChangedFiles(diffText: string): ChangedFile[] {
	const files = parseUnifiedDiff(diffText);
	return files.map((file) => {
		const path = file.newPath ?? file.oldPath ?? '';
		return {
			path,
			status: file.status,
			additions: file.additions,
			deletions: file.deletions,
		};
	});
}

export function summarizeAdditionsDeletions(diffText: string): {
	additions: number;
	deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	const lines = diffText.split('\n');
	for (const line of lines) {
		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}
		if (line.startsWith('+')) {
			additions += 1;
		} else if (line.startsWith('-')) {
			deletions += 1;
		}
	}
	return { additions, deletions };
}
