import { DOMParser, Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { PROMPT_CHIP_NODE_NAME } from './prompt-chip-node';
import {
	promptClipboardHtml,
	promptDocToMarkdown,
	promptEditorSchema,
	replaceChipMarkersInSlice,
} from './prompt-markdown';

const PROMPT = 'Match [[attachment:att-1]] per **[[context:AGENTS.md]]**\n\nthen ship';

function chipsIn(slice: Slice): { id: string; label: string | null }[] {
	const chips: { id: string; label: string | null }[] = [];
	slice.content.descendants((node) => {
		if (node.type.name === PROMPT_CHIP_NODE_NAME)
			chips.push({ id: node.attrs.id, label: node.attrs.label });
	});
	return chips;
}

describe('copying a prompt to paste into another chat', () => {
	it('carries every chip with its name in HTML the prompt editor reads back', () => {
		const html = promptClipboardHtml(PROMPT, (ref) =>
			ref.kind === 'attachment' ? 'shot.png' : 'AGENTS.md',
		);
		const holder = document.createElement('div');
		holder.innerHTML = html;
		const doc = DOMParser.fromSchema(promptEditorSchema).parse(holder);

		expect(promptDocToMarkdown(doc)).toBe(PROMPT);
		expect(chipsIn(new Slice(doc.content, 0, 0))).toEqual([
			{ id: 'att-1', label: 'shot.png' },
			{ id: 'AGENTS.md', label: 'AGENTS.md' },
		]);
	});

	it('turns pasted plain-text markers into chips, but leaves them alone inside code', () => {
		const paragraph = promptEditorSchema.node('paragraph', null, [
			promptEditorSchema.text('see [[attachment:att-2]] now'),
		]);
		const code = promptEditorSchema.node('codeBlock', null, [
			promptEditorSchema.text('[[attachment:att-3]]'),
		]);

		const pasted = replaceChipMarkersInSlice(
			new Slice(promptEditorSchema.node('doc', null, [paragraph, code]).content, 0, 0),
		);

		expect(chipsIn(pasted)).toEqual([{ id: 'att-2', label: null }]);
	});
});
