export type TurnReportImage = Readonly<{ src: string; alt: string }>;

export type TurnNoteKind = 'note' | 'changed' | 'verified' | 'next';

export type TurnNote = Readonly<{ kind: TurnNoteKind; text: string }>;

export type TurnStatus = 'waiting' | 'done';

export type TurnComparison = Readonly<{ before: TurnReportImage; after: TurnReportImage }>;

export type TurnVariant = Readonly<{ id: string; name: string; note: string; src: string }>;

export type TurnReport = Readonly<{
	outcome: string | null;
	needs: readonly string[];
	commit: string | null;
	pullRequest: string | null;
	images: readonly TurnReportImage[];
	comparison: TurnComparison | null;
	variants: readonly TurnVariant[];
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
const NOTE_LABEL =
	/^(?:\*\*|__)?(changed|verified|deferred|next(?: steps?)?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*/iu;
const STATE_LABEL = /^(before|after)\s*[:\-–—]\s*/iu;
const VARIANT_LABEL = /^variant\s+([a-z\d]{1,3})\s*[:\-–—·]\s*(.*)$/iu;
const NAME_AND_NOTE = /\s+[-–—]\s+/u;
const VIDEO_PATH = /\.(?:mp4|m4v|mov|webm)$/iu;
const TIME_FRAGMENT = /^t=(\d+(?:\.\d+)?)/u;
const MIN_VARIANTS = 2;

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
	const media = reportMedia(
		[...body.matchAll(CODE_OR_MARKDOWN_IMAGE)]
			.filter((match) => match[1] === undefined)
			.map((image) => ({ alt: image[4]?.trim() ?? '', src: image[5] ?? '' })),
	);
	return {
		outcome: footer.get('outcome') || null,
		needs: neededActions(footer.get('needs') ?? ''),
		commit: footer.get('commit') || null,
		pullRequest: footer.get('pull request') || null,
		...media,
		diagrams: blocks.slice(0, diagramCount),
		notes: blocks.slice(diagramCount).map(turnNote),
	};
}

export function hasTurnReport(report: TurnReport): boolean {
	return report.outcome !== null;
}

export function turnStatus(report: TurnReport, needsOpen: boolean): TurnStatus {
	return needsOpen && report.needs.length > 0 ? 'waiting' : 'done';
}

export function isVideoPath(src: string): boolean {
	return VIDEO_PATH.test(mediaPath(src));
}

export function mediaPath(src: string): string {
	const hash = src.indexOf('#');
	return hash === -1 ? src : src.slice(0, hash);
}

export function mediaMarker(src: string): number | null {
	const hash = src.indexOf('#');
	if (hash === -1) return null;
	const seconds = TIME_FRAGMENT.exec(src.slice(hash + 1))?.[1];
	return seconds === undefined ? null : Number(seconds);
}

function reportMedia(
	images: readonly TurnReportImage[],
): Pick<TurnReport, 'images' | 'comparison' | 'variants'> {
	const before = images.find((image) => stateOf(image) === 'before');
	const after = images.find((image) => stateOf(image) === 'after');
	const comparison =
		before && after && isVideoPath(before.src) === isVideoPath(after.src)
			? { before: unlabeled(before), after: unlabeled(after) }
			: null;
	const labeled = images
		.map((image) => ({ image, variant: variantOf(image) }))
		.filter(
			(entry): entry is { image: TurnReportImage; variant: TurnVariant } => entry.variant !== null,
		);
	const variants = uniqueVariants(labeled.map((entry) => entry.variant));
	const picked =
		variants.length >= MIN_VARIANTS ? new Set(labeled.map(({ image }) => image)) : null;
	return {
		comparison,
		variants: picked ? variants : [],
		images: images.filter(
			(image) => !(comparison && (image === before || image === after)) && !picked?.has(image),
		),
	};
}

function stateOf(image: TurnReportImage): 'before' | 'after' | null {
	const state = STATE_LABEL.exec(image.alt)?.[1]?.toLowerCase();
	return state === 'before' || state === 'after' ? state : null;
}

function unlabeled(image: TurnReportImage): TurnReportImage {
	return { src: image.src, alt: image.alt.replace(STATE_LABEL, '').trim() };
}

function variantOf(image: TurnReportImage): TurnVariant | null {
	const match = VARIANT_LABEL.exec(image.alt);
	if (!match) return null;
	const [name = '', ...rest] = (match[2] ?? '').trim().split(NAME_AND_NOTE);
	return {
		id: (match[1] ?? '').toUpperCase(),
		name: name.trim(),
		note: rest.join(' - ').trim(),
		src: image.src,
	};
}

function uniqueVariants(variants: readonly TurnVariant[]): TurnVariant[] {
	const seen = new Set<string>();
	return variants.filter((variant) => {
		if (seen.has(variant.id)) return false;
		seen.add(variant.id);
		return true;
	});
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
	return { kind: noteKind(kind), text: block.slice(label[0].length) };
}

function noteKind(label: string): TurnNoteKind {
	if (label === 'changed' || label === 'verified') return label;
	return 'next';
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
