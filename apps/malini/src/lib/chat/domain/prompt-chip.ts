export const PROMPT_CHIP_KINDS = [
	'attachment',
	'context',
	'issue',
	'transcript',
	'element',
] as const;

export type PromptChipKind = (typeof PROMPT_CHIP_KINDS)[number];

export type PromptChipRef = Readonly<{ kind: PromptChipKind; id: string }>;

export type PromptChipSegment =
	{ kind: 'text'; text: string } | { kind: 'chip'; ref: PromptChipRef };

const MARKER_PATTERN = /\[\[(attachment|context|issue|transcript|element):([^\][\r\n]*)\]\]/gu;

const ESCAPES: readonly (readonly [string, string])[] = [
	['%', '%25'],
	['[', '%5B'],
	[']', '%5D'],
	['\n', '%0A'],
	['\r', '%0D'],
];

export function escapePromptChipId(id: string): string {
	let escaped = id;
	for (const [raw, encoded] of ESCAPES) escaped = escaped.replaceAll(raw, encoded);
	return escaped;
}

export function unescapePromptChipId(id: string): string {
	let raw = id;
	for (const [decoded, encoded] of [...ESCAPES].reverse()) {
		raw = raw.replaceAll(encoded, decoded);
	}
	return raw;
}

export function promptChipMarker(ref: PromptChipRef): string {
	return `[[${ref.kind}:${escapePromptChipId(ref.id)}]]`;
}

export function isPromptChipKind(value: string): value is PromptChipKind {
	return PROMPT_CHIP_KINDS.some((kind) => kind === value);
}

export function promptChipRefs(prompt: string): PromptChipRef[] {
	const refs: PromptChipRef[] = [];
	for (const segment of promptChipSegments(prompt)) {
		if (segment.kind !== 'chip') continue;
		const seen = refs.some((ref) => ref.kind === segment.ref.kind && ref.id === segment.ref.id);
		if (!seen) refs.push(segment.ref);
	}
	return refs;
}

export function promptChipIds(prompt: string, kind: PromptChipKind): string[] {
	return promptChipRefs(prompt)
		.filter((ref) => ref.kind === kind)
		.map((ref) => ref.id);
}

export function promptChipSegments(prompt: string): PromptChipSegment[] {
	const segments: PromptChipSegment[] = [];
	let cursor = 0;

	for (const match of prompt.matchAll(MARKER_PATTERN)) {
		const index = match.index;
		const [marker, kind, id] = match;
		if (!kind || !isPromptChipKind(kind) || id === undefined) continue;
		if (index > cursor) segments.push({ kind: 'text', text: prompt.slice(cursor, index) });
		segments.push({ kind: 'chip', ref: { kind, id: unescapePromptChipId(id) } });
		cursor = index + marker.length;
	}

	if (cursor < prompt.length) segments.push({ kind: 'text', text: prompt.slice(cursor) });
	return segments;
}

export function promptChipFallbackLabel(ref: PromptChipRef): string {
	switch (ref.kind) {
		case 'context':
			return ref.id.split('/').pop() || ref.id;
		case 'issue':
			return ref.id.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
		case 'element': {
			const parsed = parseElementChipId(ref.id);
			if (!parsed) return ref.id;
			return parsed.domPath.split('>').pop()?.trim() || parsed.url;
		}
		case 'transcript':
			return 'Transcript';
		case 'attachment':
			return 'Attachment';
	}
}

export function promptChipShowsFileIcon(kind: PromptChipKind): boolean {
	return kind === 'context' || kind === 'attachment';
}

export function elementChipId(url: string, domPath: string): string {
	return `${url}\n${domPath}`;
}

export function parseElementChipId(id: string): { url: string; domPath: string } | null {
	const separator = id.indexOf('\n');
	if (separator < 0) return null;
	const url = id.slice(0, separator);
	const domPath = id.slice(separator + 1);
	if (!url || !domPath) return null;
	return { url, domPath };
}
