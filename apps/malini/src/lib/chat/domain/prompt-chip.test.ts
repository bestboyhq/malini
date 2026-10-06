import { describe, expect, it } from 'vitest';

import {
	elementChipId,
	escapePromptChipId,
	parseElementChipId,
	promptChipFallbackLabel,
	promptChipIds,
	promptChipMarker,
	promptChipRefs,
	promptChipSegments,
	unescapePromptChipId,
} from './prompt-chip';

describe('prompt chip id escaping', () => {
	it('escapes only the five characters that could forge or split a marker', () => {
		expect(escapePromptChipId('src/routes/+page.svelte')).toBe('src/routes/+page.svelte');
		expect(escapePromptChipId('a[b]c')).toBe('a%5Bb%5Dc');
		expect(escapePromptChipId('one\ntwo\r')).toBe('one%0Atwo%0D');
	});

	it('round trips an id that already contains a percent sign', () => {
		const id = '100% [done] %5B%0A literal';
		const escaped = escapePromptChipId(id);

		expect(escaped).not.toContain('[');
		expect(escaped).not.toContain(']');
		expect(unescapePromptChipId(escaped)).toBe(id);
	});

	it('round trips every character the escape table covers', () => {
		const id = '%[]\n\r all at once';
		expect(unescapePromptChipId(escapePromptChipId(id))).toBe(id);
	});

	it('writes a marker the segment scanner reads back', () => {
		const marker = promptChipMarker({ kind: 'context', id: 'a[b]\nc' });

		expect(marker).toBe('[[context:a%5Bb%5D%0Ac]]');
		expect(promptChipSegments(marker)).toEqual([
			{ kind: 'chip', ref: { kind: 'context', id: 'a[b]\nc' } },
		]);
	});
});

describe('promptChipSegments', () => {
	it('splits mixed text into prose and chips in order', () => {
		const prompt = 'Fix [[context:src/app.ts]] then close [[issue:COR-12]] please';

		expect(promptChipSegments(prompt)).toEqual([
			{ kind: 'text', text: 'Fix ' },
			{ kind: 'chip', ref: { kind: 'context', id: 'src/app.ts' } },
			{ kind: 'text', text: ' then close ' },
			{ kind: 'chip', ref: { kind: 'issue', id: 'COR-12' } },
			{ kind: 'text', text: ' please' },
		]);
	});

	it('returns one text segment when there is no marker', () => {
		expect(promptChipSegments('nothing to see')).toEqual([
			{ kind: 'text', text: 'nothing to see' },
		]);
	});

	it('returns nothing for an empty prompt', () => {
		expect(promptChipSegments('')).toEqual([]);
	});

	it('leaves an unknown kind as text', () => {
		expect(promptChipSegments('a [[wiki:page]] b')).toEqual([
			{ kind: 'text', text: 'a [[wiki:page]] b' },
		]);
	});
});

describe('promptChipRefs', () => {
	it('dedupes repeated references while keeping first-seen order', () => {
		const prompt = '[[context:b.ts]] and [[context:a.ts]] and [[context:b.ts]] again';

		expect(promptChipRefs(prompt)).toEqual([
			{ kind: 'context', id: 'b.ts' },
			{ kind: 'context', id: 'a.ts' },
		]);
	});

	it('treats the same id under two kinds as two references', () => {
		const prompt = '[[context:x]] [[attachment:x]]';

		expect(promptChipRefs(prompt)).toEqual([
			{ kind: 'context', id: 'x' },
			{ kind: 'attachment', id: 'x' },
		]);
		expect(promptChipIds(prompt, 'context')).toEqual(['x']);
		expect(promptChipIds(prompt, 'attachment')).toEqual(['x']);
		expect(promptChipIds(prompt, 'issue')).toEqual([]);
	});
});

describe('element chip ids', () => {
	it('round trips a url and a DOM path', () => {
		const id = elementChipId('https://example.com/pricing', 'main > section > h1');

		expect(parseElementChipId(id)).toEqual({
			url: 'https://example.com/pricing',
			domPath: 'main > section > h1',
		});
	});

	it('rejects an id that is not a url plus a path', () => {
		expect(parseElementChipId('just-a-string')).toBeNull();
		expect(parseElementChipId('\nmain > h1')).toBeNull();
		expect(parseElementChipId('https://example.com\n')).toBeNull();
	});
});

describe('promptChipFallbackLabel', () => {
	it('names an attachment and a transcript by their kind', () => {
		expect(promptChipFallbackLabel({ kind: 'attachment', id: 'shot.png' })).toBe('Attachment');
		expect(promptChipFallbackLabel({ kind: 'transcript', id: 'run-7' })).toBe('Transcript');
	});

	it('names a workstream file by its basename', () => {
		expect(promptChipFallbackLabel({ kind: 'context', id: 'src/routes/+page.svelte' })).toBe(
			'+page.svelte',
		);
		expect(promptChipFallbackLabel({ kind: 'context', id: 'README.md' })).toBe('README.md');
	});

	it('names an issue by its url without the scheme or trailing slash', () => {
		expect(promptChipFallbackLabel({ kind: 'issue', id: 'https://linear.app/acme/COR-12/' })).toBe(
			'linear.app/acme/COR-12',
		);
	});

	it('names an element by the last step of its DOM path', () => {
		expect(
			promptChipFallbackLabel({
				kind: 'element',
				id: elementChipId('https://example.com/pricing', 'main > section > h1'),
			}),
		).toBe('h1');
	});

	it('falls back to the raw id for an unparseable element', () => {
		expect(promptChipFallbackLabel({ kind: 'element', id: 'legacy-handle' })).toBe('legacy-handle');
	});
});
