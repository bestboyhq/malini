// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptEditorExtensions } from './minimal-extensions';
import {
	createPromptChipNodeView,
	PromptChip,
	type PromptChipAttributes,
} from './prompt-chip-node';
import { markdownToPromptDoc, promptDocToMarkdown } from './prompt-markdown';

type EditorStub = {
	view: {
		posAtDOM: (dom: HTMLElement, offset: number) => number;
		dispatch: (tr: unknown) => void;
	};
	state: {
		doc: { content: { size: number }; textBetween: (from: number, to: number) => string };
		tr: { delete: (from: number, to: number) => unknown };
	};
	commands: { focus: () => void; setTextSelection: (position: number) => void };
};

function editorStub(pos = 4): EditorStub {
	const transaction = { delete: vi.fn(() => 'deleted') };
	return {
		view: { posAtDOM: vi.fn(() => pos), dispatch: vi.fn(() => undefined) },
		state: { doc: { content: { size: 20 }, textBetween: () => '' }, tr: transaction },
		commands: { focus: vi.fn(() => undefined), setTextSelection: vi.fn(() => undefined) },
	};
}

function buildChip(
	attrs: PromptChipAttributes,
	editor: EditorStub = editorStub(),
): {
	view: ReturnType<typeof createPromptChipNodeView>;
	chip: HTMLElement;
	remove: HTMLElement;
	editor: EditorStub;
} {
	const view = createPromptChipNodeView({ node: { attrs }, editor });
	const chip = view.dom;
	const remove = chip.querySelector<HTMLElement>('[data-testid="chat-composer-chip-remove"]');
	if (!remove) throw new Error('the chip lost its remove control');
	return { view, chip, remove, editor };
}

const CONTEXT_CHIP: PromptChipAttributes = {
	kind: 'context',
	id: 'src/routes/+page.svelte',
	label: 'workstream.json',
};

describe('prompt chip node view', () => {
	it('declares the rich hover help its remove control lives under', () => {
		const { chip, remove } = buildChip(CONTEXT_CHIP);

		expect(chip.dataset.hovercardTrigger).toBe('');
		expect(remove.closest('[data-hovercard-trigger]')).toBe(chip);
		expect(remove.getAttribute('aria-label')).toBe('Remove workstream.json');
	});

	it('keeps the remove control deleting exactly its own node', () => {
		const { chip, remove, editor } = buildChip(CONTEXT_CHIP, editorStub(7));

		remove.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(editor.view.posAtDOM).toHaveBeenCalledWith(chip, 0);
		expect(editor.state.tr.delete).toHaveBeenCalledWith(7, 8);
		expect(editor.view.dispatch).toHaveBeenCalledWith('deleted');
		expect(editor.commands.focus).toHaveBeenCalled();
	});

	it('puts the caret after a chip pressed anywhere but its remove control, never selecting it', () => {
		const { view, chip, remove, editor } = buildChip(CONTEXT_CHIP, editorStub(7));
		const label = chip.lastElementChild;
		if (!label) throw new Error('the chip lost its label');

		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		label.dispatchEvent(press);

		expect(press.defaultPrevented).toBe(true);
		expect(view.stopEvent(press)).toBe(true);
		expect(editor.commands.setTextSelection).toHaveBeenCalledWith(8);
		expect(editor.commands.focus).toHaveBeenCalled();
		expect(PromptChip.config.selectable).toBe(false);

		remove.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		expect(editor.commands.setTextSelection).toHaveBeenCalledTimes(1);
	});

	it('leaves the document alone when the chip is no longer in it', () => {
		const { remove, editor } = buildChip(CONTEXT_CHIP, editorStub(-1));

		remove.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(editor.view.dispatch).not.toHaveBeenCalled();
	});

	it('holds the marker across a label repaint', () => {
		const { view, chip } = buildChip(CONTEXT_CHIP);

		expect(
			view.update({
				type: { name: PromptChip.name },
				attrs: { ...CONTEXT_CHIP, label: 'settings.json' },
			}),
		).toBe(true);
		expect(chip.dataset.hovercardTrigger).toBe('');
		expect(
			chip.querySelector('[data-testid="chat-composer-chip-remove"]')?.getAttribute('aria-label'),
		).toBe('Remove settings.json');
	});
});

describe('removing a chip from a sentence', () => {
	const editors: Editor[] = [];
	afterEach(() => {
		while (editors.length > 0) editors.pop()?.destroy();
	});

	function composerWith(markdown: string): Editor {
		const element = document.createElement('div');
		document.body.append(element);
		const editor = new Editor({
			element,
			extensions: promptEditorExtensions({ placeholder: '' }),
			content: markdownToPromptDoc(markdown).toJSON(),
		});
		editors.push(editor);
		return editor;
	}

	const SENTENCE = 'Keep this sentence intact [[attachment:att-1]] and this end.';

	it('leaves one space where its remove control took it out', () => {
		const editor = composerWith(SENTENCE);
		const remove = editor.view.dom.querySelector<HTMLElement>(
			'[data-testid="chat-composer-chip-remove"]',
		);
		remove?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(promptDocToMarkdown(editor.state.doc)).toBe('Keep this sentence intact and this end.');
	});

	it('leaves one space where Backspace or Delete took it out', () => {
		for (const [key, caret] of [
			['Backspace', 'Keep this sentence intact '.length + 2],
			['Delete', 'Keep this sentence intact '.length + 1],
		] as const) {
			const editor = composerWith(SENTENCE);
			editor.commands.setTextSelection(caret);
			editor.commands.keyboardShortcut(key);

			expect(promptDocToMarkdown(editor.state.doc), key).toBe(
				'Keep this sentence intact and this end.',
			);
		}
	});

	it('leaves an empty composer when it was all the composer held', () => {
		const removals: ReadonlyArray<readonly [string, (editor: Editor) => void]> = [
			[
				'remove control',
				(editor) =>
					editor.view.dom
						.querySelector<HTMLElement>('[data-testid="chat-composer-chip-remove"]')
						?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
			],
			[
				'Backspace',
				(editor) => {
					editor.commands.setTextSelection(2);
					editor.commands.keyboardShortcut('Backspace');
				},
			],
		];
		for (const [removal, remove] of removals) {
			const editor = composerWith('');
			editor.commands.insertPromptChip({ kind: 'attachment', id: 'att-1', label: 'brief.pdf' });
			remove(editor);

			expect(editor.isEmpty, removal).toBe(true);
		}
	});

	it('keeps the space between the chip before it and the next word', () => {
		const editor = composerWith('[[attachment:att-1]][[attachment:att-2]] and this end.');
		editor.view.dom
			.querySelectorAll<HTMLElement>('[data-testid="chat-composer-chip-remove"]')[1]
			?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(promptDocToMarkdown(editor.state.doc)).toBe('[[attachment:att-1]] and this end.');
	});

	it('keeps the spacing the user typed around it', () => {
		const editor = composerWith('Two  spaces [[attachment:att-1]]and no space after.');
		editor.view.dom
			.querySelector<HTMLElement>('[data-testid="chat-composer-chip-remove"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(promptDocToMarkdown(editor.state.doc)).toBe('Two  spaces and no space after.');
	});
});
