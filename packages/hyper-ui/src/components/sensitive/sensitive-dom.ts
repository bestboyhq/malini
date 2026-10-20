import { SENSITIVE_REVEAL_LABEL, hasSensitiveText, sensitiveSegments } from './sensitive-segments';

export function maskSensitiveText(root: ParentNode): void {
	const document = root.ownerDocument ?? root;
	if (!('createTreeWalker' in document)) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (node instanceof Text && hasSensitiveText(node.data)) nodes.push(node);
	}
	for (const node of nodes) {
		const fragment = document.createDocumentFragment();
		for (const segment of sensitiveSegments(node.data)) {
			if (!segment.kind) {
				fragment.append(segment.text);
				continue;
			}
			const control = document.createElement('span');
			control.className = 'hyper-sensitive';
			control.dataset['sensitive'] = segment.kind;
			control.setAttribute('role', 'button');
			control.tabIndex = 0;
			control.setAttribute('aria-label', SENSITIVE_REVEAL_LABEL[segment.kind]);
			const mask = document.createElement('span');
			mask.className = 'hyper-sensitive-mask';
			mask.textContent = segment.text;
			control.append(mask);
			fragment.append(control);
		}
		node.replaceWith(fragment);
	}
}

export function revealSensitiveTarget(event: Event): boolean {
	if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
	const target = event.target;
	if (!(target instanceof Element)) return false;
	const control = target.closest('.hyper-sensitive[data-sensitive]');
	if (!control) return false;
	event.preventDefault();
	event.stopPropagation();
	control.replaceWith(...(control.firstElementChild?.childNodes ?? []));
	return true;
}

export function maskSensitiveHtml(html: string): string {
	if (typeof document === 'undefined' || !hasSensitiveText(html)) return html;
	const template = document.createElement('template');
	template.innerHTML = html;
	maskSensitiveText(template.content);
	return template.innerHTML;
}
