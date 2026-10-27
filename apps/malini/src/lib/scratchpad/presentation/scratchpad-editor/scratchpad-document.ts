import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { scratchpadSchema } from './scratchpad-extensions';

export type ScratchpadDocument =
	Readonly<{ kind: 'readable'; json: JSONContent | null }> | Readonly<{ kind: 'unreadable' }>;

export function readScratchpadDocument(content: string | null): ScratchpadDocument {
	if (content === null) return { kind: 'readable', json: null };
	try {
		const json: JSONContent = scratchpadSchema.nodeFromJSON(JSON.parse(content)).toJSON();
		return { kind: 'readable', json };
	} catch {
		return { kind: 'unreadable' };
	}
}

export function isBlankScratchpad(doc: ProseMirrorNode): boolean {
	const blank = doc.type.createAndFill();
	return blank !== null && doc.eq(blank);
}

export type ScratchpadIdea = Readonly<{ title: string; detail: string }>;

export function scratchpadIdeas(content: string | null): ScratchpadIdea[] {
	const doc = parsedScratchpad(content);
	if (!doc) return [];
	const ideas: { title: string; detail: string }[] = [];
	let section: { title: string; detail: string } | null = null;
	doc.forEach((block) => {
		const [first = '', second = ''] = blockLines(block);
		if (block.type.name === 'heading') {
			section = first ? { title: first, detail: '' } : null;
			if (section) ideas.push(section);
		} else if (first && section) {
			section.detail ||= first;
		} else if (first) {
			ideas.push({ title: first, detail: second });
		}
	});
	return ideas;
}

function parsedScratchpad(content: string | null): ProseMirrorNode | null {
	if (content === null) return null;
	try {
		return scratchpadSchema.nodeFromJSON(JSON.parse(content));
	} catch {
		return null;
	}
}

function blockLines(block: ProseMirrorNode): string[] {
	return block
		.textBetween(0, block.content.size, '\n', '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}
