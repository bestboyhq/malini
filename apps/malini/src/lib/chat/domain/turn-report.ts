export type TurnReportImage = Readonly<{ src: string; alt: string }>;

export type TurnNoteKind = 'note' | 'verified' | 'deferred';

export type TurnNote = Readonly<{ kind: TurnNoteKind; text: string }>;

export type TurnStatus = 'waiting' | 'deferred' | 'done';

export type TurnReport = Readonly<{
	outcome: string | null;
	needs: readonly string[];
	commit: string | null;
	pullRequest: string | null;
	images: readonly TurnReportImage[];
	diagrams: readonly string[];
	notes: readonly TurnNote[];
}>;

type FooterKey = 'outcome' | 'needs' | 'commit' | 'pull request';

const FOOTER_LINE =
	/^\s*(?:[-*]\s+)?(?:\*\*|__)?(outcome|needs|commit|pull request|resolved)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/iu;
const NOTHING_NEEDED = /^(?:nothing|none|no|n\/a|-|—)\.?$/iu;
const CODE_OR_MARKDOWN_IMAGE =
	/((?:^|\n) {0,3}(`{3,}|~{3,})[\s\S]*?(?:\n {0,3}\2|$)|(`+)[^\n]*?\3)|!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/gu;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/u;
const BULLET = /^(?:[-*+]|\d{1,9}[.)])\s+/u;
const NOTE_LABEL = /^(?:\*\*|__)?(changed|verified|deferred)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*/iu;

export function parseTurnReport(text: string): TurnReport {
	const lines = text.replace(/\r\n?/gu, '\n').split('\n');
	const footer = new Map<FooterKey, string>();
	let bodyEnd = lines.length;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? '';
		if (line.trim() === '') continue;
		const match = FOOTER_LINE.exec(line);
		const key = match?.[1]?.toLowerCase();
		if (match && key === 'resolved') {
			bodyEnd = index;
			continue;
		}
		if (!match || !isFooterKey(key) || footer.has(key)) break;
		footer.set(key, stripEmphasis(match[2] ?? ''));
		bodyEnd = index;
	}
	const body = lines.slice(0, bodyEnd).join('\n');
	const blocks = markdownBlocks(
		body.replace(CODE_OR_MARKDOWN_IMAGE, (_image, code: string | undefined) => code ?? ''),
	);
	const leadingDiagrams = blocks.findIndex((block) => !isFence(block));
	const diagramCount = leadingDiagrams === -1 ? blocks.length : leadingDiagrams;
	return {
		outcome: footer.get('outcome') || null,
		needs: neededActions(footer.get('needs') ?? ''),
		commit: footer.get('commit') || null,
		pullRequest: footer.get('pull request') || null,
		images: [...body.matchAll(CODE_OR_MARKDOWN_IMAGE)]
			.filter((match) => match[1] === undefined)
			.map((image) => ({ alt: image[4]?.trim() ?? '', src: image[5] ?? '' })),
		diagrams: blocks.slice(0, diagramCount),
		notes: blocks.slice(diagramCount).map(turnNote),
	};
}

export function hasTurnReport(report: TurnReport): boolean {
	return report.outcome !== null;
}

export function turnStatus(report: TurnReport, needsOpen: boolean): TurnStatus {
	if (needsOpen && report.needs.length > 0) return 'waiting';
	return report.notes.some((note) => note.kind === 'deferred') ? 'deferred' : 'done';
}

export function leadNote(notes: readonly TurnNote[]): TurnNote | null {
	return (
		notes.find((note) => note.kind === 'deferred') ??
		notes.find((note) => note.kind === 'verified') ??
		notes.find((note) => !isFence(note.text)) ??
		notes[0] ??
		null
	);
}

function markdownBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	let fence: string | null = null;
	const flush = (): void => {
		const block = current.join('\n').trim();
		if (block) blocks.push(block);
		current = [];
	};
	for (const line of markdown.split('\n')) {
		if (fence !== null) {
			current.push(line);
			if (line.trim().startsWith(fence) && line.trim().replaceAll(fence[0] ?? '', '') === '') {
				fence = null;
				flush();
			}
			continue;
		}
		const opening = FENCE_OPEN.exec(line);
		if (opening) {
			flush();
			fence = opening[1] ?? '```';
			current.push(line);
		} else if (line.trim() === '') {
			flush();
		} else if (BULLET.test(line)) {
			flush();
			current.push(line.replace(BULLET, ''));
		} else {
			current.push(line);
		}
	}
	flush();
	return blocks;
}

function turnNote(block: string): TurnNote {
	const label = NOTE_LABEL.exec(block);
	const kind = label?.[1]?.toLowerCase();
	if (!label || kind === undefined) return { kind: 'note', text: block };
	return {
		kind: kind === 'verified' || kind === 'deferred' ? kind : 'note',
		text: block.slice(label[0].length),
	};
}

function isFence(block: string): boolean {
	return FENCE_OPEN.test(block);
}

function neededActions(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed || NOTHING_NEEDED.test(trimmed)) return [];
	return trimmed
		.split(';')
		.map((need) => need.trim())
		.filter(Boolean);
}

function stripEmphasis(value: string): string {
	return value.replace(/^(?:\*\*|__)\s*|\s*(?:\*\*|__)$/gu, '').trim();
}

function isFooterKey(value: string | undefined): value is FooterKey {
	return value === 'outcome' || value === 'needs' || value === 'commit' || value === 'pull request';
}
