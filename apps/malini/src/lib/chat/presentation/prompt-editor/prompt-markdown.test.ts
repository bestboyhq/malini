import { describe, expect, it } from 'vitest';

import { elementChipId, promptChipMarker } from '$lib/chat/domain/prompt-chip';

import {
	markdownToPromptDoc,
	promptDocToMarkdown,
	promptEditorSchema,
	replaceChipMarkers,
} from './prompt-markdown';
import { PROMPT_CHIP_NODE_NAME } from './prompt-chip-node';

function roundTrip(markdown: string): string {
	return promptDocToMarkdown(markdownToPromptDoc(markdown));
}

function chipsOf(markdown: string): { kind: string; id: string }[] {
	const chips: { kind: string; id: string }[] = [];
	markdownToPromptDoc(markdown).descendants((node) => {
		if (node.type.name !== PROMPT_CHIP_NODE_NAME) return true;
		chips.push({ kind: String(node.attrs.kind), id: String(node.attrs.id) });
		return false;
	});
	return chips;
}

describe('prompt markdown round trip', () => {
	it('keeps a plain paragraph', () => {
		const markdown = 'Rename the heading and then ship it.';
		expect(roundTrip(markdown)).toBe(markdown);
	});

	it('keeps the four inline marks', () => {
		const markdown = 'Make it **bold**, *quiet*, ~~gone~~, and `exact`.';
		expect(roundTrip(markdown)).toBe(markdown);
	});

	it('keeps a fenced code block with its language', () => {
		const markdown = ['```ts', 'const answer = 42;', '```'].join('\n');
		expect(roundTrip(markdown)).toBe(markdown);

		const block = markdownToPromptDoc(markdown).firstChild;
		expect(block?.type.name).toBe('codeBlock');
		expect(block?.attrs.language).toBe('ts');
	});

	it('keeps typed list and heading markers as plain text', () => {
		const markdown = '1. read the diff\n- run the suite\n\n# not a heading';
		expect(roundTrip(markdown)).toBe(markdown);
		expect(markdownToPromptDoc(markdown).firstChild?.type.name).toBe('paragraph');
	});

	it('keeps two paragraphs apart', () => {
		const markdown = 'First thought.\n\nSecond thought.';
		expect(roundTrip(markdown)).toBe(markdown);

		const doc = markdownToPromptDoc(markdown);
		expect(doc.childCount).toBe(2);
	});

	it('keeps a hard break inside one paragraph as a plain line break', () => {
		const markdown = 'line one\nline two';
		expect(roundTrip(markdown)).toBe(markdown);
		expect(roundTrip('line one\\\nline two')).toBe(markdown);

		const doc = markdownToPromptDoc(markdown);
		expect(doc.childCount).toBe(1);
		expect(doc.firstChild?.child(1).type.name).toBe('hardBreak');
	});
});

describe('prompt markdown chips', () => {
	it('keeps a chip in the middle of a sentence', () => {
		const marker = promptChipMarker({ kind: 'context', id: 'src/routes/+page.svelte' });
		const markdown = `Rename the heading in ${marker} before you push.`;

		expect(roundTrip(markdown)).toBe(markdown);

		const paragraph = markdownToPromptDoc(markdown).firstChild;
		expect(paragraph?.childCount).toBe(3);
		expect(paragraph?.child(0).text).toBe('Rename the heading in ');
		expect(paragraph?.child(1).type.name).toBe(PROMPT_CHIP_NODE_NAME);
		expect(paragraph?.child(1).attrs.id).toBe('src/routes/+page.svelte');
		expect(paragraph?.child(2).text).toBe(' before you push.');
	});

	it('keeps two chips of different kinds in one sentence', () => {
		const issue = promptChipMarker({
			kind: 'issue',
			id: 'https://linear.app/acme/issue/COR-12',
		});
		const context = promptChipMarker({ kind: 'context', id: 'src/lib/app.ts' });
		const markdown = `Close ${issue} by editing ${context} today.`;

		expect(roundTrip(markdown)).toBe(markdown);
		expect(chipsOf(markdown)).toEqual([
			{ kind: 'issue', id: 'https://linear.app/acme/issue/COR-12' },
			{ kind: 'context', id: 'src/lib/app.ts' },
		]);
	});

	it('keeps an element chip whose id contains a newline', () => {
		const id = elementChipId('https://example.com/pricing', 'main > section > h1');
		const marker = promptChipMarker({ kind: 'element', id });

		expect(marker).toContain('%0A');
		expect(marker).not.toContain('\n');

		const markdown = `Tighten ${marker} copy.`;
		expect(roundTrip(markdown)).toBe(markdown);
		expect(chipsOf(markdown)).toEqual([{ kind: 'element', id }]);
	});

	it('leaves a literal double bracket that is not a marker as text', () => {
		const markdown = 'Docs use \\[\\[double brackets\\]\\] for wiki links.';

		expect(roundTrip(markdown)).toBe(markdown);
		expect(chipsOf(markdown)).toEqual([]);
		expect(markdownToPromptDoc(markdown).textContent).toBe(
			'Docs use [[double brackets]] for wiki links.',
		);
	});

	it('leaves a marker inside a code block as literal text', () => {
		const markdown = ['```', '[[context:src/lib/app.ts]]', '```'].join('\n');

		expect(roundTrip(markdown)).toBe(markdown);
		expect(chipsOf(markdown)).toEqual([]);
	});

	it('splits markers out of an already parsed doc', () => {
		const marker = promptChipMarker({ kind: 'transcript', id: 'run-7' });
		const doc = promptEditorSchema.node('doc', null, [
			promptEditorSchema.node('paragraph', null, [
				promptEditorSchema.text(`See ${marker} for the trace.`),
			]),
		]);

		const replaced = replaceChipMarkers(doc);
		const paragraph = replaced.firstChild;

		expect(paragraph?.childCount).toBe(3);
		expect(paragraph?.child(1).type.name).toBe(PROMPT_CHIP_NODE_NAME);
		expect(paragraph?.child(1).attrs.kind).toBe('transcript');
		expect(paragraph?.child(1).attrs.id).toBe('run-7');
		expect(promptDocToMarkdown(replaced)).toBe(`See ${marker} for the trace.`);
	});

	it('keeps a chip inside a bold span from splitting the mark', () => {
		const marker = promptChipMarker({ kind: 'attachment', id: 'shot.png' });
		const markdown = `**Compare ${marker} with the design.**`;

		expect(roundTrip(markdown)).toBe(markdown);
	});
});

describe('prompt editor schema', () => {
	it('holds exactly the nodes and marks the composer can produce', () => {
		expect(Object.keys(promptEditorSchema.nodes).sort()).toEqual([
			'codeBlock',
			'doc',
			'hardBreak',
			'paragraph',
			'promptChip',
			'text',
		]);
		expect(Object.keys(promptEditorSchema.marks).sort()).toEqual([
			'bold',
			'code',
			'italic',
			'strike',
		]);
	});
});
