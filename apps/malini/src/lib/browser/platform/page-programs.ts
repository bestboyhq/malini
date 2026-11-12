const FIND = String.raw`(target) => {
	const ref = /^@e([0-9]+)$/.exec(target);
	if (ref) {
		const element = (globalThis.__maliniRefs ?? [])[Number(ref[1]) - 1];
		return element && element.isConnected ? { element } : { problem: 'stale' };
	}
	try {
		return { element: document.querySelector(target) };
	} catch {
		return { problem: 'invalid' };
	}
}`;

const DESCRIBE = String.raw`(element) => {
	if (!element) return 'nothing';
	const id = element.id ? '#' + element.id : '';
	const classes = [...element.classList].slice(0, 2).map((name) => '.' + name).join('');
	const text = (element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
	const quoted = text ? ' "' + (text.length > 40 ? text.slice(0, 39) + '…' : text) + '"' : '';
	return element.localName + id + classes + quoted;
}`;

const NATIVE_POPUP = String.raw`(element) => {
	const control = element instanceof HTMLLabelElement ? element.control : element;
	if (control instanceof HTMLSelectElement && !control.multiple && control.size <= 1) {
		return control === element ? 'select' : null;
	}
	if (!(control instanceof HTMLInputElement)) return null;
	if (control.type === 'file' || control.type === 'color') return control.type;
	const picker = ['date', 'datetime-local', 'month', 'week', 'time'].includes(control.type);
	return picker && control === element ? control.type : null;
}`;

export const LOCATE_PROGRAM = String.raw`(target, mode) => {
	const find = ${FIND};
	const describe = ${DESCRIBE};
	const nativePopup = ${NATIVE_POPUP};
	const found = find(target);
	if (found.problem) return { problem: found.problem };
	const element = found.element;
	if (!element) return { problem: 'missing' };
	if (mode === 'click') {
		const popup = nativePopup(element);
		if (popup) return { problem: 'popup', kind: popup };
	}
	const before = element.getBoundingClientRect();
	const inView = before.top >= 0 && before.left >= 0 && before.bottom <= innerHeight && before.right <= innerWidth;
	if (!inView) element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
	const rect = element.getBoundingClientRect();
	const shows =
		rect.width > 0 &&
		rect.height > 0 &&
		element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
	if (!shows) return { problem: 'hidden' };
	const left = Math.max(rect.left, 0);
	const right = Math.min(rect.right, innerWidth);
	const top = Math.max(rect.top, 0);
	const bottom = Math.min(rect.bottom, innerHeight);
	const x = right > left ? (left + right) / 2 : rect.left + rect.width / 2;
	const y = bottom > top ? (top + bottom) / 2 : rect.top + rect.height / 2;
	const page = { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
	if (mode === 'see') return { x, y, page };
	let hit = document.elementFromPoint(x, y);
	while (hit && hit.shadowRoot) {
		const inner = hit.shadowRoot.elementFromPoint(x, y);
		if (!inner || inner === hit) break;
		hit = inner;
	}
	const within = (node, root) => {
		for (let at = node; at; at = at.parentNode ?? at.host) if (at === root) return true;
		return false;
	};
	const reaches =
		hit && (within(hit, element) || [...(element.labels ?? [])].some((label) => within(hit, label)));
	return reaches ? { x, y, page } : { problem: 'covered', by: describe(hit) };
}`;

export const TYPE_PROGRAM = String.raw`(target, text, submit) => {
	const find = ${FIND};
	const found = find(target);
	if (found.problem) return { problem: found.problem };
	const element = found.element;
	if (!element) return { problem: 'missing' };
	const announce = () => {
		element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		element.dispatchEvent(new Event('change', { bubbles: true }));
	};
	if (element instanceof HTMLSelectElement) {
		const wanted = text.replace(/\s+/g, ' ').trim();
		const option = [...element.options].find(
			(choice) => choice.value === text || choice.label.replace(/\s+/g, ' ').trim() === wanted,
		);
		if (!option) {
			return { problem: 'option', options: [...element.options].slice(0, 40).map((choice) => choice.label.trim() || choice.value) };
		}
		if (element.disabled || option.disabled) return { problem: 'readonly' };
		element.focus({ preventScroll: true });
		element.value = option.value;
		announce();
		return { done: true };
	}
	const picked = element instanceof HTMLInputElement && ['date', 'datetime-local', 'month', 'week', 'time', 'color', 'range'].includes(element.type);
	if (picked) {
		if (element.readOnly || element.disabled) return { problem: 'readonly' };
		element.focus({ preventScroll: true });
		element.value = text;
		if (text && (element.value === '' || (element.type === 'color' && element.value !== text.toLowerCase()))) {
			return { problem: 'format', kind: element.type };
		}
		announce();
		return { done: true };
	}
	const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
	if (!element.isContentEditable && (!field || element.readOnly || element.disabled)) {
		return { problem: 'readonly' };
	}
	element.focus({ preventScroll: true });
	if (field) element.select();
	else getSelection()?.selectAllChildren(element);
	document.execCommand(text ? 'insertText' : 'delete', false, text);
	if (!submit) return { done: true };
	const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
	const proceed = element.dispatchEvent(new KeyboardEvent('keydown', enter));
	element.dispatchEvent(new KeyboardEvent('keypress', enter));
	if (proceed && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
	element.dispatchEvent(new KeyboardEvent('keyup', enter));
	return { done: true };
}`;

export const PRESENCE_PROGRAM = String.raw`(target, text) => {
	const find = ${FIND};
	const squash = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
	const wanted = text === null ? null : squash(text);
	if (target === null) return squash(document.body?.innerText).includes(wanted);
	const found = find(target);
	if (found.problem) return found.problem;
	const element = found.element;
	if (!element || element.getClientRects().length === 0) return false;
	if (!element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
	return wanted === null || squash(element.innerText).includes(wanted);
}`;

export const SCROLL_POSITION_PROGRAM = String.raw`(x, y) => {
	const describe = ${DESCRIBE};
	const round = Math.round;
	const root = document.scrollingElement ?? document.documentElement;
	const viewport = { width: innerWidth, height: innerHeight };
	const scrolls = (style) => /auto|scroll|overlay/.test(style.overflowX + ' ' + style.overflowY);
	let at = x === null ? null : document.elementFromPoint(x, y);
	while (at && at !== root && at !== document.body) {
		if (scrolls(getComputedStyle(at)) && (at.scrollHeight > at.clientHeight || at.scrollWidth > at.clientWidth)) {
			return { x: round(at.scrollLeft), y: round(at.scrollTop), height: round(at.scrollHeight), container: describe(at), viewport };
		}
		at = at.parentElement ?? at.getRootNode().host ?? null;
	}
	return { x: round(scrollX), y: round(scrollY), height: round(root.scrollHeight), viewport };
}`;

export const SNAPSHOT_PROGRAM = String.raw`(maxLines, maxChars) => {
	const refs = [];
	globalThis.__maliniRefs = refs;
	const lines = [];
	let chars = 0;
	let cut = false;
	const squash = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
	const clip = (text, length) => (text.length > length ? text.slice(0, length - 1) + '…' : text);
	const quote = (text) => JSON.stringify(text);
	const push = (depth, line) => {
		if (cut) return;
		if (lines.length >= maxLines || chars + line.length > maxChars) {
			cut = true;
			return;
		}
		lines.push('  '.repeat(depth) + line);
		chars += line.length + depth * 2 + 1;
	};
	let words = [];
	let wordsDepth = 0;
	const flush = () => {
		const text = squash(words.join(''));
		words = [];
		if (text) push(wordsDepth, 'text ' + quote(clip(text, 300)));
	};
	const INPUTS = {
		button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox',
		radio: 'radio', range: 'slider', file: 'file', color: 'color', search: 'searchbox',
		number: 'spinbutton',
	};
	const LANDMARKS = {
		nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
		form: 'form', dialog: 'dialog', ul: 'list', ol: 'list', menu: 'list', table: 'table', search: 'search',
	};
	const INTERACTIVE = new Set([
		'link', 'button', 'checkbox', 'radio', 'switch', 'slider', 'textbox', 'searchbox', 'spinbutton',
		'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem',
		'file', 'color', 'clickable',
	]);
	const CONTAINERS = new Set([
		'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'dialog', 'alertdialog',
		'list', 'table', 'search', 'region', 'menu', 'menubar', 'tablist', 'tabpanel', 'toolbar', 'tree',
		'grid', 'alert', 'status',
	]);
	const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'path', 'defs']);
	const CONTROLS = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[contenteditable=""],[contenteditable=true]';
	const roleOf = (element) => {
		const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
		if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit;
		const tag = element.localName;
		if (tag === 'a') return element.hasAttribute('href') ? 'link' : null;
		if (tag === 'button' || tag === 'summary') return 'button';
		if (tag === 'input') return element.type === 'hidden' ? null : INPUTS[element.type] ?? 'textbox';
		if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
		if (tag === 'textarea') return 'textbox';
		if (tag === 'img' || (tag === 'svg' && element.getAttribute('aria-label'))) return 'img';
		if (/^h[1-6]$/.test(tag)) return 'heading';
		if (tag === 'iframe') return 'iframe';
		if (tag === 'video' || tag === 'audio' || tag === 'canvas') return tag;
		if (LANDMARKS[tag]) return LANDMARKS[tag];
		const editable = element.getAttribute('contenteditable');
		if (editable === '' || editable === 'true' || editable === 'plaintext-only') return 'textbox';
		return null;
	};
	const textOf = (ids) =>
		squash(ids.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' '));
	const nameOf = (element, role) => {
		const labelledBy = element.getAttribute('aria-labelledby');
		const fromIds = labelledBy ? textOf(labelledBy) : '';
		if (fromIds) return fromIds;
		const label = squash(element.getAttribute('aria-label'));
		if (label) return label;
		const labels = squash([...(element.labels ?? [])].map((each) => each.innerText).join(' '));
		if (labels) return labels;
		if (role === 'img') return squash(element.getAttribute('alt') ?? element.getAttribute('title'));
		if (element instanceof HTMLInputElement && INPUTS[element.type] === 'button') {
			return squash(element.value || element.getAttribute('alt')) || element.type;
		}
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
			return squash(element.getAttribute('placeholder') ?? element.getAttribute('title'));
		}
		const inner = squash(element.innerText);
		if (inner) return inner;
		const image = element.querySelector('img[alt],svg[aria-label],[title]');
		return squash(element.getAttribute('title') ?? image?.getAttribute('alt') ?? image?.getAttribute('aria-label') ?? image?.getAttribute('title'));
	};
	const relative = (href) => {
		try {
			const url = new URL(href, location.href);
			return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
		} catch {
			return href;
		}
	};
	const statesOf = (element, role) => {
		const states = [];
		const aria = (name) => element.getAttribute('aria-' + name);
		if (role === 'heading') states.push('level ' + (Number(element.localName.slice(1)) || Number(aria('level')) || 2));
		if (element.disabled || aria('disabled') === 'true') states.push('disabled');
		if ('checked' in element && (role === 'checkbox' || role === 'radio' || role === 'switch')) {
			if (element.indeterminate) states.push('mixed');
			else if (element.checked) states.push('checked');
		} else if (aria('checked') === 'true') states.push('checked');
		else if (aria('checked') === 'mixed') states.push('mixed');
		if (aria('expanded') === 'true') states.push('expanded');
		if (aria('expanded') === 'false') states.push('collapsed');
		if (aria('selected') === 'true') states.push('selected');
		if (aria('pressed') === 'true') states.push('pressed');
		if (aria('current') && aria('current') !== 'false') states.push('current');
		if (element.required || aria('required') === 'true') states.push('required');
		if (element instanceof HTMLSelectElement) {
			const chosen = [...element.selectedOptions].map((option) => squash(option.label)).join(', ');
			states.push('value ' + quote(clip(chosen, 80)));
		} else if (element instanceof HTMLInputElement && element.type === 'password') {
			if (element.value) states.push('filled');
		} else if ((element instanceof HTMLInputElement && INPUTS[element.type] !== 'button') || element instanceof HTMLTextAreaElement) {
			if (element.value && role !== 'checkbox' && role !== 'radio') states.push('value ' + quote(clip(element.value, 80)));
		}
		if (role === 'link' && element.hasAttribute('href')) states.push('-> ' + relative(element.getAttribute('href')));
		if (document.activeElement === element) states.push('focused');
		return states;
	};
	const shows = (element) => element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
	const childrenOf = (node) => {
		if (node.localName === 'slot') {
			const assigned = node.assignedNodes({ flatten: true });
			return assigned.length > 0 ? assigned : [...node.childNodes];
		}
		return node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes];
	};
	const line = (depth, element, role) => {
		const name = nameOf(element, role);
		const parts = [role === 'clickable' ? 'clickable' : role];
		if (name) parts.push(quote(clip(name, 100)));
		if (INTERACTIVE.has(role) || role === 'heading') {
			refs.push(element);
			parts.push('@e' + refs.length);
		}
		parts.push(...statesOf(element, role));
		push(depth, parts.join(' '));
	};
	const walk = (node, depth) => {
		for (const child of childrenOf(node)) {
			if (cut) return;
			if (child.nodeType === Node.TEXT_NODE) {
				if (words.length === 0) wordsDepth = depth;
				words.push(child.data);
				continue;
			}
			if (child.nodeType !== Node.ELEMENT_NODE) continue;
			const element = child;
			const tag = element.localName;
			if (SKIPPED.has(tag) || element.getAttribute('aria-hidden') === 'true') continue;
			const style = getComputedStyle(element);
			if (style.display === 'contents') {
				walk(element, depth);
				continue;
			}
			if (!shows(element)) continue;
			const block = !style.display.startsWith('inline') && style.display !== 'contents' && style.display !== 'table-cell';
			let role = roleOf(element);
			if (!role && style.cursor === 'pointer' && element.parentElement && getComputedStyle(element.parentElement).cursor !== 'pointer' && !element.querySelector(CONTROLS)) {
				role = 'clickable';
			}
			if (style.display === 'table-cell') words.push(' | ');
			if (role && (INTERACTIVE.has(role) || role === 'heading' || role === 'img' || role === 'iframe' || role === 'video' || role === 'audio' || role === 'canvas')) {
				flush();
				if (role === 'iframe') {
					const title = squash(element.getAttribute('title'));
					push(depth, 'iframe' + (title ? ' ' + quote(title) : '') + ' -> ' + relative(element.getAttribute('src') ?? ''));
				} else if (role !== 'img' || nameOf(element, role)) {
					line(depth, element, role);
				}
				if (role === 'listbox' && !(element instanceof HTMLSelectElement)) walk(element, depth + 1);
				continue;
			}
			if (role && CONTAINERS.has(role)) {
				flush();
				const name = nameOf(element, role);
				push(depth, role + (name && role !== 'list' && role !== 'table' && role !== 'main' && role !== 'form' && role !== 'navigation' ? ' ' + quote(clip(name, 60)) : '') + ':');
				walk(element, depth + 1);
				flush();
				continue;
			}
			if (block) flush();
			walk(element, depth);
			if (block) flush();
		}
	};
	const root = document.scrollingElement ?? document.documentElement;
	push(0, 'Page ' + quote(document.title) + ' at ' + location.href);
	push(0, 'Viewport ' + innerWidth + 'x' + innerHeight + ', scrolled to y ' + Math.round(scrollY) + ' of ' + root.scrollHeight + 'px');
	if (document.body) walk(document.body, 0);
	flush();
	if (cut) lines.push('… The page goes on. Read the rest with browser_evaluate, for example document.querySelector("main").innerText.');
	return lines.join('\n');
}`;

export const SERIALIZE_FUNCTION = String.raw`async function () {
	const value = typeof this === 'function' ? await this() : this;
	if (typeof value === 'string') return value;
	const seen = new WeakSet();
	const describe = (node) => {
		if (!(node instanceof Element)) return node.nodeName;
		const id = node.id ? '#' + node.id : '';
		const classes = [...node.classList].slice(0, 3).map((name) => '.' + name).join('');
		return '<' + node.localName + id + classes + '>';
	};
	const json = JSON.stringify(value, (_key, item) => {
		if (typeof item === 'bigint') return item.toString() + 'n';
		if (typeof item === 'function') return '[function ' + (item.name || 'anonymous') + ']';
		if (typeof item === 'symbol') return item.toString();
		if (typeof item === 'number' && !Number.isFinite(item)) return String(item);
		if (item === undefined) return null;
		if (typeof item !== 'object' || item === null) return item;
		if (item === window) return '[window]';
		if (item instanceof Node) return describe(item);
		if (item instanceof Error) return item.name + ': ' + item.message;
		if (item instanceof Map) return Object.fromEntries([...item].map(([key, entry]) => [String(key), entry]));
		if (item instanceof Set || item instanceof NodeList || item instanceof HTMLCollection) return [...item];
		if (seen.has(item)) return '[repeated]';
		seen.add(item);
		return item;
	});
	return json === undefined ? String(value) : json;
}`;
