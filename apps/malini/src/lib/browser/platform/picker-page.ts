export type PickerCommand =
	| { readonly kind: 'select'; readonly reselect: boolean }
	| { readonly kind: 'prompt' }
	| { readonly kind: 'end' };

export function pickerScript(command: PickerCommand): string {
	return `(${PICKER_PROGRAM})(${JSON.stringify(command)}, ${JSON.stringify(PICKER_CSS)})`;
}

export function sourceScript(domPath: string): string {
	return `(${SOURCE_PROGRAM})(${JSON.stringify(domPath)})`;
}

/* eslint-disable @malini/desktop/no-literal-product-colors */
const PAGE_PALETTE = {
	surface: '#312f2d',
	border: '#42403f',
	text: '#f7f5f3',
	faint: '#86817e',
	placeholder: '#74706d',
	accent: '#3e9df3',
	accentFill: '#3e9df31f',
	accentRing: '#3e9df359',
	send: '#fcfbfb',
	sendHover: '#ede9e7',
	sendText: '#161413',
	sendDisabled: '#2a2927',
	sendDisabledText: '#696563',
	shadow: '#00000066',
	shadowNear: '#00000033',
} as const;
/* eslint-enable @malini/desktop/no-literal-product-colors */

const SYSTEM_FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
const MONO_FONT = `ui-monospace, 'SF Mono', Menlo, monospace`;

const PICKER_CSS = `
[hidden] { display: none !important; }
.layer {
	position: fixed; inset: 0; pointer-events: none;
	font: 13px/20px ${SYSTEM_FONT}; color: ${PAGE_PALETTE.text};
	-webkit-font-smoothing: antialiased; letter-spacing: normal; text-align: left;
}
.box {
	position: fixed; top: 0; left: 0; box-sizing: border-box;
	border: 1.5px solid ${PAGE_PALETTE.accent}; border-radius: 3px; background: ${PAGE_PALETTE.accentFill};
	transition: transform 80ms ease-out, width 80ms ease-out, height 80ms ease-out;
}
.box.locked {
	border-width: 2px; background: transparent; box-shadow: 0 0 0 3px ${PAGE_PALETTE.accentRing};
}
.shield { position: fixed; top: 0; left: 0; pointer-events: auto; cursor: default; }
.tag {
	position: fixed; top: 0; left: 0; display: flex; align-items: baseline; gap: 6px;
	box-sizing: border-box; max-width: calc(100vw - 12px); padding: 2px 7px;
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 6px; background: ${PAGE_PALETTE.surface};
	box-shadow: 0 2px 8px ${PAGE_PALETTE.shadowNear};
	font: 500 11px/16px ${MONO_FONT}; white-space: nowrap;
}
.tag-name, .panel-name { overflow: hidden; text-overflow: ellipsis; }
.tag-size, .panel-size { flex: none; color: ${PAGE_PALETTE.faint}; font-weight: 400; }
.hint {
	position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
	display: flex; gap: 8px; padding: 6px 12px;
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 999px; background: ${PAGE_PALETTE.surface};
	box-shadow: 0 8px 24px ${PAGE_PALETTE.shadow}; font-size: 12px; line-height: 16px; white-space: nowrap;
}
.hint.bottom { top: auto; bottom: 12px; }
.hint-keys { color: ${PAGE_PALETTE.faint}; }
.panel {
	position: fixed; top: 0; left: 0; display: flex; flex-direction: column; gap: 4px;
	box-sizing: border-box; padding: 8px 8px 8px 12px;
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 12px; background: ${PAGE_PALETTE.surface};
	box-shadow: 0 12px 32px ${PAGE_PALETTE.shadow}, 0 2px 6px ${PAGE_PALETTE.shadowNear};
	pointer-events: auto; animation: malini-picker-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.panel:focus-within {
	border-color: ${PAGE_PALETTE.accent};
	box-shadow: 0 0 0 3px ${PAGE_PALETTE.accentRing}, 0 12px 32px ${PAGE_PALETTE.shadow}, 0 2px 6px ${PAGE_PALETTE.shadowNear};
}
.panel-label {
	display: flex; gap: 6px; padding-right: 4px;
	color: ${PAGE_PALETTE.faint}; font: 11px/16px ${MONO_FONT}; white-space: nowrap;
}
.field {
	all: unset; display: block; box-sizing: border-box; width: 100%; min-height: 40px; max-height: 160px;
	overflow-y: auto; padding-right: 4px; color: ${PAGE_PALETTE.text}; font: inherit; line-height: 20px;
	white-space: pre-wrap; overflow-wrap: anywhere; caret-color: ${PAGE_PALETTE.accent}; cursor: text;
}
.field::placeholder { color: ${PAGE_PALETTE.placeholder}; opacity: 1; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.keys { color: ${PAGE_PALETTE.faint}; font-size: 11px; line-height: 16px; }
.send {
	all: unset; display: grid; place-items: center; flex: none; box-sizing: border-box;
	width: 28px; height: 28px; border-radius: 999px;
	background: ${PAGE_PALETTE.send}; color: ${PAGE_PALETTE.sendText}; cursor: pointer;
	transition: transform 100ms ease-out;
}
.send:hover:not(:disabled) { background: ${PAGE_PALETTE.sendHover}; }
.send:active:not(:disabled) { transform: scale(0.94); }
.send:focus-visible { box-shadow: 0 0 0 2px ${PAGE_PALETTE.surface}, 0 0 0 4px ${PAGE_PALETTE.accent}; }
.send:disabled { background: ${PAGE_PALETTE.sendDisabled}; color: ${PAGE_PALETTE.sendDisabledText}; cursor: default; }
.send svg { width: 16px; height: 16px; }
.live { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes malini-picker-in { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) {
	.box, .send { transition: none; }
	.panel { animation: none; }
}
`;

const PICKER_PROGRAM = String.raw`(command, css) => {
	const KEY = '__maliniPicker';
	const running = globalThis[KEY];
	if (command.kind === 'end') {
		if (running) running.end();
		return null;
	}
	if (command.kind === 'prompt') return running ? running.prompt() : null;
	return (running || start()).select(command.reselect === true);

	function start() {
		const doc = document;
		const previousFocus =
			doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
		const host = doc.createElement('malini-picker');
		host.style.cssText =
			'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; pointer-events: none !important;';
		const root = host.attachShadow({ mode: 'open' });
		adopt(root);

		const layer = part('div', 'layer');
		const box = part('div', 'box');
		const tag = part('div', 'tag');
		const tagName = part('span', 'tag-name');
		const tagSize = part('span', 'tag-size');
		tag.append(tagName, tagSize);
		const shield = part('div', 'shield');
		const hint = part('div', 'hint');
		const hintMain = part('span', 'hint-main');
		const hintKeys = part('span', 'hint-keys');
		hint.append(hintMain, hintKeys);
		const panel = part('div', 'panel');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');
		const panelLabel = part('div', 'panel-label');
		const panelName = part('span', 'panel-name');
		const panelSize = part('span', 'panel-size');
		panelLabel.setAttribute('aria-hidden', 'true');
		panelLabel.append(panelName, panelSize);
		const field = doc.createElement('textarea');
		field.className = 'field';
		field.rows = 2;
		field.maxLength = 4000;
		field.placeholder = 'Ask about this element…';
		field.setAttribute('aria-label', 'Prompt');
		field.setAttribute('aria-describedby', 'malini-picker-keys');
		const foot = part('div', 'foot');
		const keys = part('span', 'keys');
		keys.id = 'malini-picker-keys';
		keys.textContent = 'Enter to send · Esc to cancel';
		const send = doc.createElement('button');
		send.type = 'button';
		send.className = 'send';
		send.setAttribute('aria-label', 'Send');
		send.append(arrow());
		foot.append(keys, send);
		panel.append(panelLabel, field, foot);
		const live = part('div', 'live');
		live.setAttribute('role', 'status');
		layer.append(box, tag, shield, hint, panel, live);
		root.append(layer);
		for (const piece of [box, tag, shield, hint, panel]) piece.hidden = true;
		doc.documentElement.append(host);

		let mode = 'select';
		let current = null;
		let locked = null;
		let lockedRect = null;
		let reselectTarget = null;
		let side = null;
		let pending = null;
		let scheduled = false;
		let ended = false;
		let usedKeys = false;

		const guards = {
			mouseover: onMove,
			mousemove: onMove,
			pointerdown: onPress,
			pointerup: onPress,
			mousedown: onPress,
			mouseup: onPress,
			dblclick: onPress,
			auxclick: onPress,
			contextmenu: onPress,
			dragstart: onPress,
			click: onClick,
			keydown: onKey,
			keyup: shieldUi,
			keypress: shieldUi,
			beforeinput: shieldUi,
			input: onInput,
			compositionstart: shieldUi,
			compositionupdate: shieldUi,
			compositionend: shieldUi,
			paste: shieldUi,
			copy: shieldUi,
			cut: shieldUi,
			focusin: shieldUi,
			focusout: shieldUi,
			scroll: schedule,
			resize: schedule,
		};
		const passive = { mouseover: true, mousemove: true, scroll: true, resize: true };
		for (const type of Object.keys(guards)) {
			window.addEventListener(type, guards[type], { capture: true, passive: passive[type] === true });
		}

		const api = { select, prompt, end };
		globalThis[KEY] = api;
		return api;

		function select(reselect) {
			return new Promise((resolve) => {
				finish(null);
				pending = resolve;
				mode = 'select';
				side = null;
				panel.hidden = true;
				const target = reselect ? reselectTarget : null;
				reselectTarget = null;
				if (target && target.isConnected) {
					lock(target);
					return;
				}
				locked = null;
				showHint();
				announce(
					'Pick an element: click it, or move with the arrow keys and press Enter. Press Escape to cancel.',
				);
				schedule();
			});
		}

		function prompt() {
			return new Promise((resolve) => {
				finish(null);
				if (!locked || ended) {
					resolve(null);
					return;
				}
				pending = resolve;
				mode = 'prompt';
				side = null;
				const name = describe(locked);
				panelName.textContent = name;
				panelSize.textContent = size(lockedRect);
				panel.setAttribute('aria-label', 'Ask about ' + name);
				field.value = '';
				panel.hidden = false;
				refresh();
				update();
				field.focus({ preventScroll: true });
				announce('Selected ' + name + '. Type a prompt, then press Enter to send.');
			});
		}

		function end() {
			if (ended) return;
			ended = true;
			for (const type of Object.keys(guards)) window.removeEventListener(type, guards[type], true);
			host.remove();
			if (globalThis[KEY] === api) delete globalThis[KEY];
			if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
				previousFocus.focus({ preventScroll: true });
			}
			finish(null);
		}

		function finish(value) {
			const resolve = pending;
			pending = null;
			if (resolve) resolve(value);
		}

		async function lock(target) {
			mode = 'locked';
			locked = target;
			current = target;
			for (const piece of [box, tag, shield, hint]) piece.hidden = true;
			await nextFrames();
			if (ended) return;
			lockedRect = target.getBoundingClientRect();
			finish({
				domPath: domPath(target),
				rect: {
					top: lockedRect.top,
					left: lockedRect.left,
					width: lockedRect.width,
					height: lockedRect.height,
				},
				html: target.outerHTML.slice(0, 2048),
				url: location.href,
				viewport: { width: innerWidth, height: innerHeight },
			});
		}

		function submit() {
			const text = field.value.trim();
			if (mode !== 'prompt' || text.length === 0) return;
			finish({ kind: 'send', prompt: text });
			end();
		}

		function inUi(event) {
			return event.composedPath().includes(host);
		}

		function block(event) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}

		function onMove(event) {
			if (mode !== 'select' || inUi(event)) return;
			const target = event.target;
			if (target instanceof Element && target !== current) {
				current = target;
				schedule();
			}
		}

		function onPress(event) {
			if (inUi(event)) event.stopImmediatePropagation();
			else block(event);
		}

		function onClick(event) {
			const path = event.composedPath();
			if (path.includes(host)) {
				event.stopImmediatePropagation();
				if (mode === 'prompt' && path.includes(send)) submit();
				if (mode === 'select' && path.includes(shield) && current) lock(current);
				return;
			}
			block(event);
			const target = event.target instanceof Element ? event.target : null;
			if (!target) return;
			if (mode === 'select') {
				lock(target);
			} else if (mode === 'prompt') {
				reselectTarget = target;
				finish({ kind: 'reselect' });
			}
		}

		function onKey(event) {
			if (event.key === 'Escape' && !event.isComposing) {
				block(event);
				end();
				return;
			}
			if (mode === 'select') {
				if (moveSelection(event)) block(event);
				return;
			}
			if (!inUi(event)) return;
			event.stopImmediatePropagation();
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				submit();
			} else if (event.key === 'Tab') {
				event.preventDefault();
				cycleFocus(event.shiftKey);
			}
		}

		function onInput(event) {
			if (!inUi(event)) return;
			event.stopImmediatePropagation();
			refresh();
		}

		function shieldUi(event) {
			if (inUi(event)) event.stopImmediatePropagation();
		}

		function moveSelection(event) {
			if (event.key === 'Enter') {
				if (current) lock(current);
				return true;
			}
			const steps = {
				ArrowUp: 'parentElement',
				ArrowDown: 'firstElementChild',
				ArrowLeft: 'previousElementSibling',
				ArrowRight: 'nextElementSibling',
			};
			const step = steps[event.key];
			if (!step) return false;
			const next = current ? current[step] : startingElement();
			if (next && next !== doc.documentElement) {
				current = next;
				if (typeof current.scrollIntoView === 'function') {
					current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				}
				announce(describe(current));
			}
			if (!usedKeys) {
				usedKeys = true;
				showHint();
			}
			schedule();
			return true;
		}

		function startingElement() {
			const center =
				typeof doc.elementFromPoint === 'function'
					? doc.elementFromPoint(innerWidth / 2, innerHeight / 2)
					: null;
			return center && center !== doc.documentElement ? center : doc.body;
		}

		function cycleFocus(backwards) {
			const stops = send.disabled ? [field] : [field, send];
			const index = stops.indexOf(root.activeElement);
			const next = stops[(index + (backwards ? -1 : 1) + stops.length) % stops.length] || field;
			next.focus();
		}

		function refresh() {
			send.disabled = field.value.trim().length === 0;
			field.style.height = 'auto';
			field.style.height = Math.min(field.scrollHeight, 160) + 'px';
			schedule();
		}

		function schedule() {
			if (scheduled || ended) return;
			scheduled = true;
			if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
			else setTimeout(update, 16);
		}

		function update() {
			scheduled = false;
			if (ended) return;
			if (mode === 'select') {
				const rect = current && current.isConnected ? current.getBoundingClientRect() : null;
				outline(rect, false);
				showTag(rect);
				cover(rect);
				placeHint(rect);
			} else if (mode === 'prompt') {
				const rect = locked.isConnected ? locked.getBoundingClientRect() : lockedRect;
				outline(rect, true);
				placePanel(rect);
			}
		}

		function outline(rect, isLocked) {
			box.hidden = !rect;
			if (!rect) return;
			box.classList.toggle('locked', isLocked);
			box.style.transform = 'translate(' + rect.left + 'px, ' + rect.top + 'px)';
			box.style.width = rect.width + 'px';
			box.style.height = rect.height + 'px';
		}

		function showTag(rect) {
			tag.hidden = !rect;
			if (!rect) return;
			tagName.textContent = describe(current);
			tagSize.textContent = size(rect);
			const width = tag.offsetWidth;
			const height = tag.offsetHeight;
			let top = rect.top - height - 6;
			if (top < 6) top = rect.bottom + 6;
			if (top + height > innerHeight - 6) top = clamp(rect.top + 6, 6, innerHeight - height - 6);
			const left = clamp(rect.left, 6, innerWidth - width - 6);
			tag.style.transform = 'translate(' + left + 'px, ' + top + 'px)';
		}

		function cover(rect) {
			const framed = Boolean(rect) && /^(?:iframe|frame|embed|object)$/.test(current.localName);
			shield.hidden = !framed;
			if (!framed) return;
			shield.style.transform = 'translate(' + rect.left + 'px, ' + rect.top + 'px)';
			shield.style.width = rect.width + 'px';
			shield.style.height = rect.height + 'px';
		}

		function showHint() {
			hintMain.textContent = usedKeys ? 'Arrow keys to move' : 'Click an element to ask about it';
			hintKeys.textContent = usedKeys ? 'Enter to select · Esc to cancel' : 'Esc to cancel';
			hint.hidden = false;
		}

		function placeHint(rect) {
			hint.hidden = false;
			const width = hint.offsetWidth;
			const height = hint.offsetHeight;
			const covered =
				Boolean(rect) &&
				rect.top < height + 20 &&
				rect.bottom > 0 &&
				rect.left < (innerWidth + width) / 2 &&
				rect.right > (innerWidth - width) / 2;
			hint.classList.toggle('bottom', covered);
		}

		function placePanel(rect) {
			const margin = 8;
			const gap = 8;
			const width = Math.min(340, innerWidth - margin * 2);
			panel.style.width = width + 'px';
			const height = panel.offsetHeight;
			if (!side) {
				if (innerHeight - rect.bottom - gap - margin >= height) side = 'below';
				else if (rect.top - gap - margin >= height) side = 'above';
				else if (innerWidth - rect.right - gap - margin >= width) side = 'right';
				else if (rect.left - gap - margin >= width) side = 'left';
				else side = 'inside';
			}
			let left = rect.left;
			let top = innerHeight - height - margin;
			if (side === 'below') top = rect.bottom + gap;
			if (side === 'above') top = rect.top - gap - height;
			if (side === 'right' || side === 'left') {
				left = side === 'right' ? rect.right + gap : rect.left - gap - width;
				top = rect.top;
			}
			panel.style.left = clamp(left, margin, innerWidth - width - margin) + 'px';
			panel.style.top = clamp(top, margin, innerHeight - height - margin) + 'px';
			panel.style.transformOrigin = side === 'above' ? 'bottom left' : 'top left';
		}

		function announce(text) {
			live.textContent = text;
		}

		function nextFrames() {
			return new Promise((resolve) => {
				const timer = setTimeout(resolve, 150);
				if (typeof requestAnimationFrame !== 'function') return;
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						clearTimeout(timer);
						resolve();
					}),
				);
			});
		}

		function describe(element) {
			const name = element.localName;
			if (element.id) return name + '#' + element.id;
			const classes = readableClasses(element);
			return classes.length > 0 ? name + '.' + classes.join('.') : name;
		}

		function readableClasses(element) {
			return Array.from(element.classList)
				.filter((value) => /^[A-Za-z_][\w-]{0,31}$/.test(value) && !value.startsWith('svelte-'))
				.slice(0, 2);
		}

		function domPath(element) {
			const parts = [];
			for (let at = element; at && at !== doc.documentElement; at = at.parentElement) {
				if (at === doc.body) {
					parts.unshift('body');
					break;
				}
				if (at.id && doc.querySelectorAll('#' + cssEscape(at.id)).length === 1) {
					parts.unshift(at.localName + '#' + cssEscape(at.id));
					break;
				}
				let piece = at.localName + readableClasses(at).map((value) => '.' + cssEscape(value)).join('');
				const parent = at.parentElement;
				const twins = parent
					? Array.from(parent.children).filter((sibling) => sibling.localName === at.localName)
					: [];
				if (twins.length > 1) piece += ':nth-of-type(' + (twins.indexOf(at) + 1) + ')';
				parts.unshift(piece);
			}
			return parts.length > 0 ? parts.join(' > ') : element.localName;
		}

		function cssEscape(value) {
			return globalThis.CSS && typeof CSS.escape === 'function' ? CSS.escape(value) : value;
		}

		function size(rect) {
			return Math.round(rect.width) + ' × ' + Math.round(rect.height);
		}

		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), Math.max(min, max));
		}

		function part(name, className) {
			const element = doc.createElement(name);
			element.className = className;
			return element;
		}

		function adopt(target) {
			try {
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(css);
				target.adoptedStyleSheets = [sheet];
			} catch {
				const style = doc.createElement('style');
				style.textContent = css;
				target.append(style);
			}
		}

		function arrow() {
			const ns = 'http://www.w3.org/2000/svg';
			const svg = doc.createElementNS(ns, 'svg');
			const attributes = {
				viewBox: '0 0 16 16',
				fill: 'none',
				stroke: 'currentColor',
				'stroke-width': '1.5',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round',
				'aria-hidden': 'true',
			};
			for (const name of Object.keys(attributes)) svg.setAttribute(name, attributes[name]);
			const path = doc.createElementNS(ns, 'path');
			path.setAttribute('d', 'M8 12.75v-9.5M4.25 7 8 3.25 11.75 7');
			svg.append(path);
			return svg;
		}
	}
}`;

const SOURCE_PROGRAM = String.raw`(path) => {
	try {
		const element = document.querySelector(path);
		if (!element) return null;
		for (let at = element, depth = 0; at && depth < 50; at = at.parentElement, depth += 1) {
			const loc = at.__svelte_meta && at.__svelte_meta.loc;
			if (loc && loc.file && typeof loc.line === 'number') {
				return loc.file + ':' + loc.line + ':' + (typeof loc.column === 'number' ? loc.column : 0);
			}
		}
		const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
		let fiber = fiberKey ? element[fiberKey] : null;
		for (let depth = 0; fiber && depth < 200; fiber = fiber.return, depth += 1) {
			const source = fiber._debugSource;
			if (source && source.fileName && typeof source.lineNumber === 'number') {
				return (
					source.fileName +
					':' +
					source.lineNumber +
					(typeof source.columnNumber === 'number' ? ':' + source.columnNumber : '')
				);
			}
		}
		for (let at = element, depth = 0; at && depth < 50; at = at.parentElement, depth += 1) {
			const component = at.__vueParentComponent;
			const file = component && component.type && component.type.__file;
			if (typeof file === 'string' && file.length > 0) return file;
		}
	} catch {}
	return null;
}`;
