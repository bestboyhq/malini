import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';

export type ScratchpadNote = Readonly<{
	pos: number;
	from: number;
	to: number;
	prompt: string;
}>;

export function scratchpadNotes(doc: ProseMirrorNode): ScratchpadNote[] {
	const notes: ScratchpadNote[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== 'paragraph') return node.isBlock;
		const note = noteAt(doc.resolve(pos + 1));
		if (note?.pos === pos) notes.push(note);
		return false;
	});
	return notes;
}

export function noteAt($pos: ResolvedPos): ScratchpadNote | null {
	const paragraph = paragraphDepth($pos);
	if (paragraph === null) return null;
	const inListItem = $pos.node(paragraph - 1).type.name === 'listItem';
	const owner = inListItem ? paragraph - 1 : paragraph;
	let cut = owner;
	while (cut > 1 && $pos.node(cut - 1).childCount === 1) cut -= 1;
	return {
		pos: inListItem ? $pos.start(owner) : $pos.before(paragraph),
		from: $pos.before(cut),
		to: $pos.after(cut),
		prompt: markdownLines($pos.node(owner)).join('\n').trim(),
	};
}

function paragraphDepth($pos: ResolvedPos): number | null {
	for (let depth = $pos.depth; depth > 0; depth -= 1) {
		if ($pos.node(depth).type.name === 'paragraph') return depth;
	}
	return null;
}

function markdownLines(node: ProseMirrorNode): string[] {
	if (node.isTextblock) return node.textBetween(0, node.content.size, '\n', '\n').split('\n');
	const lines: string[] = [];
	node.forEach((child, _offset, index) => {
		const childLines = markdownLines(child);
		if (child.type.name !== 'listItem') {
			lines.push(...childLines);
			return;
		}
		const marker = listMarker(node, index);
		childLines.forEach((line, at) =>
			lines.push(at === 0 ? `${marker}${line}` : `${' '.repeat(marker.length)}${line}`),
		);
	});
	return lines;
}

function listMarker(list: ProseMirrorNode, index: number): string {
	if (list.type.name !== 'orderedList') return '- ';
	const start: unknown = list.attrs['start'];
	return `${(typeof start === 'number' ? start : 1) + index}. `;
}
