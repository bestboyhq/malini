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

export function maskSensitive(text: string, kind: SensitiveKind): string {
	if (kind === 'user') return maskWord(text);
	const at = text.lastIndexOf('@');
	const labels = text.slice(at + 1).split('.');
	const topLevel = labels.pop() ?? '';
	return `${maskWord(text.slice(0, at))}@${labels.map((label) => `${maskWord(label)}.`).join('')}${topLevel}`;
}

function maskWord(word: string): string {
	const characters = [...word];
	const last = characters.length - 1;
	return characters
		.map((character, index) =>
			(index === 0 && last > 0) || (index === last && last >= 3)
				? character
				: '*'.repeat(character.length),
		)
		.join('');
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
				masked: range.masked.slice(from - range.start, to - range.start),
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
