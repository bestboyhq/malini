type JsonNode = Readonly<Record<string, unknown>>;

export function appendScratchpadIdea(content: string | null, idea: string): string | null {
	const doc = content === null ? { type: 'doc' } : scratchpadDoc(content);
	const lines = idea
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (doc === null || lines.length === 0) return null;
	const blocks: unknown[] = Array.isArray(doc['content']) ? [...doc['content']] : [];
	while (isEmptyParagraph(blocks.at(-1))) blocks.pop();
	const inline = lines.flatMap<JsonNode>((text, index) =>
		index === 0 ? [{ type: 'text', text }] : [{ type: 'hardBreak' }, { type: 'text', text }],
	);
	const section = blocks.filter(isHeading).at(-1);
	const block = section
		? { type: 'heading', attrs: section['attrs'], content: inline }
		: { type: 'paragraph', content: inline };
	return JSON.stringify({ ...doc, content: [...blocks, block] });
}

function scratchpadDoc(content: string): JsonNode | null {
	try {
		const value: unknown = JSON.parse(content);
		if (!isNode(value) || value['type'] !== 'doc') return null;
		return value['content'] === undefined || Array.isArray(value['content']) ? value : null;
	} catch {
		return null;
	}
}

function isNode(value: unknown): value is JsonNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeading(block: unknown): block is JsonNode {
	return isNode(block) && block['type'] === 'heading';
}

function isEmptyParagraph(block: unknown): boolean {
	if (!isNode(block) || block['type'] !== 'paragraph') return false;
	return !Array.isArray(block['content']) || block['content'].length === 0;
}
