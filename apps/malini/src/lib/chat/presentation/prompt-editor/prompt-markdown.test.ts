// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { elementChipId, promptChipMarker } from '$lib/chat/domain/prompt-chip';

import {
	markdownToPromptDoc,
	promptDocToMarkdown,
	promptEditorSchema,
	replaceChipMarkers,
} from './prompt-markdown';
import { promptEditorExtensions } from './minimal-extensions';
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

function paragraphDoc(content: PMNode[]): PMNode {
	return promptEditorSchema.node('doc', null, [
		promptEditorSchema.node('paragraph', null, content),
	]);
}

function literalText(markdown: string): string | null {
	const doc = markdownToPromptDoc(markdown);
	let formatted = false;
	doc.descendants((node) => {
		if (node.marks.length > 0 || node.type.name === PROMPT_CHIP_NODE_NAME) formatted = true;
	});
	return formatted ? null : doc.textContent;
}

describe('prompt markdown literal text', () => {
	it.each([
		'GET /_ld/script.js',
		'Event names must match [a-z][a-z0-9_]{0,63}.',
		'C:\\temp\\x',
		'~approx',
		'a lone ` backtick',
	])('sends %s exactly as typed', (typed) => {
		expect(promptDocToMarkdown(paragraphDoc([promptEditorSchema.text(typed)]))).toBe(typed);
	});

	it.each(['*not italic*', '`not code`', 'C:\\temp\\_x', '~~not struck~~'])(
		'escapes %s so it reads back as literal text',
		(typed) => {
			const markdown = promptDocToMarkdown(paragraphDoc([promptEditorSchema.text(typed)]));

			expect(markdown).not.toBe(typed);
			expect(literalText(markdown)).toBe(typed);
		},
	);

	it('escapes only the character that would pair up as formatting', () => {
		const typed = 'GET /_ld/script.js, regex [a-z][a-z0-9_]{0,63}';
		const markdown = promptDocToMarkdown(paragraphDoc([promptEditorSchema.text(typed)]));

		expect(markdown).toBe('GET /_ld/script.js, regex [a-z][a-z0-9\\_]{0,63}');
		expect(literalText(markdown)).toBe(typed);
	});

	it('escapes text whose formatting only appears across a line break', () => {
		const doc = paragraphDoc([
			promptEditorSchema.text('keep _this'),
			promptEditorSchema.node('hardBreak'),
			promptEditorSchema.text('and that_ literal'),
		]);

		expect(literalText(promptDocToMarkdown(doc))).toBe('keep _thisand that_ literal');
	});

	it('keeps the literal text beside a mark readable', () => {
		const doc = paragraphDoc([
			promptEditorSchema.text('Serve '),
			promptEditorSchema.text('script.js', [promptEditorSchema.mark('code')]),
			promptEditorSchema.text(' from /_ld/script.js'),
		]);

		expect(promptDocToMarkdown(doc)).toBe('Serve `script.js` from /_ld/script.js');
	});
});

describe('prompt editor input', () => {
	const editors: Editor[] = [];

	beforeEach(() => {
		vi.stubGlobal(
			'ClipboardEvent',
			class extends Event {
				readonly clipboardData = null;
			},
		);
	});

	afterEach(() => {
		while (editors.length > 0) editors.pop()?.destroy();
		vi.unstubAllGlobals();
	});

	function emptyEditor(): Editor {
		const element = document.createElement('div');
		document.body.append(element);
		const editor = new Editor({ element, extensions: promptEditorExtensions({ placeholder: '' }) });
		editors.push(editor);
		return editor;
	}

	function pasted(text: string): string {
		const editor = emptyEditor();
		editor.view.pasteText(text);
		return promptDocToMarkdown(editor.state.doc);
	}

	function typed(text: string): string {
		const editor = emptyEditor();
		const { view } = editor;
		for (const char of text) {
			const { from, to } = view.state.selection;
			const insert = () => view.state.tr.insertText(char, from, to);
			const handled = view.someProp('handleTextInput', (handle) =>
				handle(view, from, to, char, insert),
			);
			if (!handled) view.dispatch(insert());
		}
		return promptDocToMarkdown(editor.state.doc);
	}

	it('pastes paths, patterns and arithmetic exactly as written', () => {
		const text =
			'GET /_ld/script.js, match [a-z][a-z0-9]{0,63} in src/**/*.ts, size 2 * 3 * 4, ~approx';
		expect(pasted(text)).toBe(text);
	});

	it('pastes markdown formatting as formatting', () => {
		const text = 'Make it **bold**, *quiet*, _soft_, ~~gone~~ and run `pnpm check`.';
		const doc = markdownToPromptDoc(pasted(text));
		const marks = new Set<string>();
		doc.descendants((node) => {
			for (const mark of node.marks) marks.add(mark.type.name);
		});

		expect(pasted(text)).toBe('Make it **bold**, *quiet*, *soft*, ~~gone~~ and run `pnpm check`.');
		expect([...marks].sort()).toEqual(['bold', 'code', 'italic', 'strike']);
	});

	it('keeps an underscore inside a word literal', () => {
		expect(pasted('call _a_b now')).toBe('call _a_b now');
	});

	it('keeps typed arithmetic with spaced asterisks as text', () => {
		expect(typed('size 2 * 3 * 4')).toBe('size 2 * 3 * 4');
	});

	it('formats typed emphasis', () => {
		expect(typed('keep it *quiet* and **loud**')).toBe('keep it *quiet* and **loud**');
	});
});

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
		const transcript = promptChipMarker({ kind: 'transcript', id: 'session-9f2c' });
		const context = promptChipMarker({ kind: 'context', id: 'src/lib/app.ts' });
		const markdown = `Follow ${transcript} by editing ${context} today.`;

		expect(roundTrip(markdown)).toBe(markdown);
		expect(chipsOf(markdown)).toEqual([
			{ kind: 'transcript', id: 'session-9f2c' },
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
		const typed = 'Docs use [[double brackets]] for wiki links.';

		expect(roundTrip('Docs use \\[\\[double brackets\\]\\] for wiki links.')).toBe(typed);
		expect(chipsOf(typed)).toEqual([]);
		expect(markdownToPromptDoc(typed).textContent).toBe(typed);
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
