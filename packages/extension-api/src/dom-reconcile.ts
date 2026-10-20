const KEY_ATTRIBUTE = 'data-reconcile-key';

const ELEMENT_NODE = 1;

type FormState = Readonly<{
	value: string;
	checked: boolean | null;
	indeterminate: boolean | null;
}> | null;

type FormElement = Element & {
	value: string;
	checked?: boolean;
	indeterminate?: boolean;
};

const boundHandlers = new WeakMap<Element, Map<string, (event: Event, element: Element) => void>>();

const installedDispatchers = new WeakMap<Element, Set<string>>();

export function bindEvent<E extends Element, K extends keyof HTMLElementEventMap>(
	element: E,
	type: K,
	handler: (event: HTMLElementEventMap[K], element: E) => void,
): void {
	let handlers = boundHandlers.get(element);
	if (handlers === undefined) {
		handlers = new Map();
		boundHandlers.set(element, handlers);
	}
	handlers.set(type, handler as (event: Event, element: Element) => void);
	installDispatcher(element, type);
}

export function reconcileChildren(parent: Element, next: readonly Node[]): void {
	const keyed = new Map<string, ChildNode>();
	for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
		const key = nodeKey(child);
		if (key !== null && !keyed.has(key)) keyed.set(key, child);
	}

	let cursor: ChildNode | null = parent.firstChild;
	for (const candidate of next) {
		const key = nodeKey(candidate);
		let match: ChildNode | null = null;
		if (key !== null) {
			const existing = keyed.get(key);
			if (existing !== undefined && isCompatible(existing, candidate)) {
				keyed.delete(key);
				match = existing;
			}
		} else if (cursor !== null && nodeKey(cursor) === null && isCompatible(cursor, candidate)) {
			match = cursor;
		}

		if (match === null) {
			parent.insertBefore(candidate, cursor);
			continue;
		}
		if (match === cursor) cursor = cursor.nextSibling;
		else parent.insertBefore(match, cursor);
		morph(match, candidate);
	}

	while (cursor !== null) {
		const following: ChildNode | null = cursor.nextSibling;
		parent.removeChild(cursor);
		cursor = following;
	}
}

function installDispatcher(element: Element, type: string): void {
	let installed = installedDispatchers.get(element);
	if (installed === undefined) {
		installed = new Set();
		installedDispatchers.set(element, installed);
	}
	if (installed.has(type)) return;
	installed.add(type);
	element.addEventListener(type, (event: Event) => {
		boundHandlers.get(element)?.get(type)?.(event, element);
	});
}

function transferBoundHandlers(current: Element, next: Element): void {
	const nextHandlers = boundHandlers.get(next);
	const currentHandlers = boundHandlers.get(current);
	if (nextHandlers === undefined) {
		currentHandlers?.clear();
		return;
	}
	if (currentHandlers === undefined) {
		boundHandlers.set(current, new Map(nextHandlers));
	} else {
		currentHandlers.clear();
		for (const [type, handler] of nextHandlers) currentHandlers.set(type, handler);
	}
	for (const type of nextHandlers.keys()) installDispatcher(current, type);
}

function morph(current: ChildNode, next: Node): void {
	if (!isElement(current) || !isElement(next)) {
		if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
		return;
	}
	const form = captureFormState(next);
	syncAttributes(current, next);
	transferBoundHandlers(current, next);
	reconcileChildren(current, Array.from(next.childNodes));
	applyFormState(current, form);
}

function syncAttributes(current: Element, next: Element): void {
	const incoming = next.attributes;
	for (let index = 0; index < incoming.length; index += 1) {
		const attribute = incoming[index];
		if (attribute === undefined) continue;
		if (current.getAttribute(attribute.name) !== attribute.value) {
			current.setAttribute(attribute.name, attribute.value);
		}
	}
	const existing = current.attributes;
	for (let index = existing.length - 1; index >= 0; index -= 1) {
		const attribute = existing[index];
		if (attribute === undefined) continue;
		if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
	}
}

function captureFormState(element: Element): FormState {
	if (!isFormElement(element)) return null;
	switch (element.tagName) {
		case 'SELECT':
		case 'TEXTAREA':
			return { value: element.value, checked: null, indeterminate: null };
		case 'INPUT':
			return {
				value: element.value,
				checked: element.checked ?? null,
				indeterminate: element.indeterminate ?? null,
			};
		default:
			return null;
	}
}

function applyFormState(element: Element, state: FormState): void {
	if (state === null) return;
	if (!isFormElement(element)) return;
	if (element.value !== state.value) element.value = state.value;
	if (state.checked !== null && element.checked !== state.checked) element.checked = state.checked;
	if (state.indeterminate !== null && element.indeterminate !== state.indeterminate) {
		element.indeterminate = state.indeterminate;
	}
}

function isFormElement(element: Element): element is FormElement {
	return (
		element.tagName === 'SELECT' || element.tagName === 'TEXTAREA' || element.tagName === 'INPUT'
	);
}

function nodeKey(node: Node): string | null {
	return isElement(node) ? node.getAttribute(KEY_ATTRIBUTE) : null;
}

function isElement(node: Node): node is Element {
	return node.nodeType === ELEMENT_NODE;
}

function isCompatible(current: Node, next: Node): boolean {
	if (current.nodeType !== next.nodeType) return false;
	if (!isElement(current) || !isElement(next)) return true;
	return current.tagName === next.tagName && current.namespaceURI === next.namespaceURI;
}
