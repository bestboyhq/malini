const WIKI_LINK = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/gu;
const WIKI_LINK_ATTRIBUTE = 'data-wiki-link';
const SKIPPED_ANCESTORS = 'a, code, pre';

export function linkifyWikiLinksIn(root: DocumentFragment): void {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!(node instanceof Text) || !node.data.includes('[[')) continue;
		if (node.parentElement?.closest(SKIPPED_ANCESTORS)) continue;
		nodes.push(node);
	}
	for (const node of nodes) linkifyTextNode(node);
}

function linkifyTextNode(node: Text): void {
	const fragment = document.createDocumentFragment();
	let cursor = 0;
	for (const match of node.data.matchAll(WIKI_LINK)) {
		const index = match.index ?? 0;
		const target = (match[1] ?? '').trim();
		if (target.length === 0) continue;
		fragment.append(node.data.slice(cursor, index));
		const anchor = document.createElement('a');
		anchor.setAttribute('href', '#');
		anchor.setAttribute(WIKI_LINK_ATTRIBUTE, target);
		anchor.textContent = (match[2] ?? target).trim();
		fragment.append(anchor);
		cursor = index + match[0].length;
	}
	if (cursor === 0) return;
	fragment.append(node.data.slice(cursor));
	node.replaceWith(fragment);
}

export function readWikiLinkTarget(element: Element): string | null {
	return element.getAttribute(WIKI_LINK_ATTRIBUTE);
}
