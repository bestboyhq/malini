// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { promptEditorExtensions } from './minimal-extensions';
import { addPendingChip, dropPendingChips, landPendingChip, pendingChipsOf } from './pending-chips';

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

function open(text: string): Editor {
	editor = new Editor({
		extensions: promptEditorExtensions({ placeholder: '' }),
		content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
	});
	return editor;
}

function positions(active: Editor): Record<string, number> {
	return Object.fromEntries(pendingChipsOf(active.state).map((chip) => [chip.key, chip.pos]));
}

describe('pending chips', () => {
	it('stay before what is typed after them and draw without entering the prompt', () => {
		const active = open('look');
		active.view.dispatch(addPendingChip(active.state.tr, { key: 'a', pos: 5, labels: ['x.png'] }));
		active.view.dispatch(active.state.tr.insertText(' here', 5));
		expect(positions(active)).toEqual({ a: 5 });
		expect(active.getText()).toBe('look here');
		expect(active.view.dom.querySelector('[data-pending-chip]')?.textContent).toBe('x.png');
	});

	it('hand their place to the next paste at the same spot when one lands', () => {
		const active = open('look');
		active.view.dispatch(addPendingChip(active.state.tr, { key: 'a', pos: 5, labels: ['a.png'] }));
		active.view.dispatch(addPendingChip(active.state.tr, { key: 'b', pos: 5, labels: ['b.png'] }));
		active.view.dispatch(landPendingChip(active.state.tr.insertText(' A ', 5), 'a', 8));
		expect(positions(active)).toEqual({ b: 8 });
		active.view.dispatch(dropPendingChips(active.state.tr, ['b']));
		expect(pendingChipsOf(active.state)).toEqual([]);
	});
});
