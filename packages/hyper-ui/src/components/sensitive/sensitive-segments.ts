export type SensitiveKind = 'email' | 'user';

export type SensitiveSegment = Readonly<{
	text: string;
	kind: SensitiveKind | null;
	match: number;
}>;

const EMAIL = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w:-])`;
const HOME_USER = String.raw`(?<=/(?:Users|home)/)[^/\s"'\x60<>:]+`;
const SENSITIVE = new RegExp(`(${EMAIL})|(${HOME_USER})`, 'gu');

type SensitiveRange = Readonly<{ start: number; end: number; kind: SensitiveKind }>;

function sensitiveRanges(text: string): SensitiveRange[] {
	return [...text.matchAll(SENSITIVE)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
		kind: match[1] === undefined ? 'user' : 'email',
	}));
}

export function hasSensitiveText(text: string): boolean {
	return text.search(SENSITIVE) !== -1;
}

export function sensitiveSegmentsAcross(parts: readonly string[]): SensitiveSegment[][] {
	const ranges = sensitiveRanges(parts.join(''));
	let offset = 0;
	return parts.map((part) => {
		const start = offset;
		const end = offset + part.length;
		offset = end;
		const segments: SensitiveSegment[] = [];
		let cursor = start;
		ranges.forEach((range, match) => {
			const from = Math.max(range.start, start);
			const to = Math.min(range.end, end);
			if (from >= to) return;
			if (from > cursor)
				segments.push({ text: part.slice(cursor - start, from - start), kind: null, match: -1 });
			segments.push({ text: part.slice(from - start, to - start), kind: range.kind, match });
			cursor = to;
		});
		if (cursor < end) segments.push({ text: part.slice(cursor - start), kind: null, match: -1 });
		return segments;
	});
}

export function sensitiveSegments(text: string): SensitiveSegment[] {
	return sensitiveSegmentsAcross([text])[0] ?? [];
}

export const SENSITIVE_REVEAL_LABEL: Readonly<Record<SensitiveKind, string>> = {
	email: 'Reveal email address',
	user: 'Reveal user name',
};
