import { sensitiveMasking } from './sensitive-masking.svelte';

export type SensitiveKind = 'email' | 'user';

export type SensitiveSegment = Readonly<{
	text: string;
	masked: string;
	kind: SensitiveKind | null;
	match: number;
}>;

const EMAIL = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w:-])`;
const HOME_USER = String.raw`(?<=/(?:Users|home)/)[^/\s"'\x60<>:]+`;
const SENSITIVE = new RegExp(`(${EMAIL})|(${HOME_USER})`, 'gu');

type SensitiveRange = Readonly<{ start: number; end: number; kind: SensitiveKind; masked: string }>;

function sensitiveRanges(text: string): SensitiveRange[] {
	if (!sensitiveMasking.on) return [];
	return [...text.matchAll(SENSITIVE)].map((match) => {
		const kind = match[1] === undefined ? 'user' : 'email';
		return {
			start: match.index,
			end: match.index + match[0].length,
			kind,
			masked: maskSensitive(match[0], kind),
		};
	});
}

const MASK = '***';
const LAST_LETTER_FROM_LENGTH = 5;

export function maskSensitive(text: string, kind: SensitiveKind): string {
	if (kind === 'user') return maskName(text);
	return `${maskName(text.slice(0, text.lastIndexOf('@')))}@${MASK}`;
}

function maskName(name: string): string {
	const characters = [...name];
	const last = characters.length >= LAST_LETTER_FROM_LENGTH ? characters.at(-1) : '';
	return `${characters[0] ?? ''}${MASK}${last}`;
}

export function hasSensitiveText(text: string): boolean {
	return sensitiveMasking.on && text.search(SENSITIVE) !== -1;
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
			if (from > cursor) segments.push(plain(part.slice(cursor - start, from - start)));
			segments.push({
				text: part.slice(from - start, to - start),
				masked: from === range.start ? range.masked : '',
				kind: range.kind,
				match,
			});
			cursor = to;
		});
		if (cursor < end) segments.push(plain(part.slice(cursor - start)));
		return segments;
	});
}

function plain(text: string): SensitiveSegment {
	return { text, masked: text, kind: null, match: -1 };
}

export function sensitiveSegments(text: string): SensitiveSegment[] {
	return sensitiveSegmentsAcross([text])[0] ?? [];
}

export const SENSITIVE_REVEAL_LABEL: Readonly<Record<SensitiveKind, string>> = {
	email: 'Reveal email address',
	user: 'Reveal user name',
};
