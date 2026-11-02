export type PickerModel = {
	readonly id: string;
	readonly label: string;
	readonly provider: string;
	readonly providerName: string;
};

export type PickerCommand =
	| { readonly kind: 'select'; readonly reselect: boolean }
	| {
			readonly kind: 'prompt';
			readonly models: readonly PickerModel[];
			readonly provider: string;
			readonly model: string;
			readonly error: string | null;
	  }
	| { readonly kind: 'end' };

export function pickerScript(command: PickerCommand): string {
	return `(${PICKER_PROGRAM})(${JSON.stringify(command)}, ${JSON.stringify(PICKER_CSS)}, ${JSON.stringify(GLYPHS)})`;
}

export function sourceScript(domPath: string): string {
	return `(${SOURCE_PROGRAM})(${JSON.stringify(domPath)})`;
}

/* eslint-disable @malini/desktop/no-literal-product-colors */
export const PAGE_PALETTE = {
	surface: '#2a2927',
	raised: '#312f2d',
	border: '#42403f',
	borderSoft: '#42403f99',
	text: '#f7f5f3',
	secondary: '#b8b5b2',
	faint: '#86817e',
	placeholder: '#74706d',
	accent: '#3e9df3',
	accentFill: '#3e9df31f',
	accentRing: '#3e9df359',
	success: '#4eda84',
	attention: '#ffb224',
	danger: '#fa716f',
	send: '#fcfbfb',
	sendHover: '#ede9e7',
	sendText: '#161413',
	sendDisabledText: '#696563',
	shadow: '#00000066',
	shadowNear: '#00000033',
} as const;
/* eslint-enable @malini/desktop/no-literal-product-colors */

export const GLYPHS = {
	arrowUp: 'M8 12.75v-9.5M4.25 7 8 3.25 11.75 7',
	chevronDown: 'M4.25 6.25 8 10l3.75-3.75',
	check: 'M3.25 8.25l3 3 6.5-6.5',
	close: 'M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5',
	element:
		'M2.25 3.5V2.25H3.5M6 2.25h1M9.5 2.25h1.25V3.5M2.25 6v1M2.25 9.5v1.25H3.5M6.75 6.75 13.5 9.25 10.5 10.5 9.25 13.5Z',
	alert: 'M8 4.25v4.5M8 11.5h.01',
	chat: 'M13.25 9.75a2 2 0 0 1-2 2H5.5l-2.75 2v-9a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2Z',
} as const;

export const SYSTEM_FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
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
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 6px; background: ${PAGE_PALETTE.raised};
	box-shadow: 0 2px 8px ${PAGE_PALETTE.shadowNear};
	font: 500 11px/16px ${MONO_FONT}; white-space: nowrap;
}
.tag-name, .chip-name { overflow: hidden; text-overflow: ellipsis; }
.tag-size { flex: none; color: ${PAGE_PALETTE.faint}; font-weight: 400; }
.hint {
	position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
	display: flex; gap: 8px; padding: 6px 12px;
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 999px; background: ${PAGE_PALETTE.raised};
	box-shadow: 0 8px 24px ${PAGE_PALETTE.shadow}; font-size: 12px; line-height: 16px; white-space: nowrap;
}
.hint.bottom { top: auto; bottom: 12px; }
.hint-keys { color: ${PAGE_PALETTE.faint}; }
.panel {
	position: fixed; top: 0; left: 0; display: flex; flex-direction: column;
	box-sizing: border-box; overflow: hidden;
	border: 1px solid ${PAGE_PALETTE.borderSoft}; border-radius: 12px; background: ${PAGE_PALETTE.surface};
	box-shadow: 0 16px 40px ${PAGE_PALETTE.shadow}, 0 2px 8px ${PAGE_PALETTE.shadowNear};
	pointer-events: auto; transition: border-color 150ms ease-out;
	animation: malini-picker-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.panel:hover, .panel:focus-within { border-color: ${PAGE_PALETTE.border}; }
.chips { display: flex; padding: 10px 12px 0; }
.chip {
	display: inline-flex; align-items: center; gap: 5px; max-width: 100%; box-sizing: border-box;
	height: 22px; padding: 0 7px 0 6px; border: 1px solid ${PAGE_PALETTE.border}; border-radius: 6px;
	background: ${PAGE_PALETTE.raised}; color: ${PAGE_PALETTE.secondary};
	font: 12px/16px ${MONO_FONT}; white-space: nowrap;
}
.chip svg { flex: none; width: 12px; height: 12px; color: ${PAGE_PALETTE.faint}; }
.field {
	all: unset; display: block; box-sizing: border-box; width: 100%; min-height: 48px; max-height: 168px;
	overflow-y: auto; padding: 8px 14px 4px; color: ${PAGE_PALETTE.text}; font: inherit; font-size: 14px;
	line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; caret-color: ${PAGE_PALETTE.text};
	cursor: text;
}
.field::placeholder { color: ${PAGE_PALETTE.placeholder}; opacity: 1; }
.field:disabled { color: ${PAGE_PALETTE.secondary}; cursor: default; }
.error { padding: 2px 14px 0; color: ${PAGE_PALETTE.danger}; font-size: 12px; line-height: 16px; }
.foot {
	display: flex; align-items: center; justify-content: space-between; gap: 8px;
	height: 44px; box-sizing: border-box; padding: 0 8px 4px;
}
.model {
	position: relative; display: inline-flex; align-items: center; min-width: 0; max-width: 60%;
	height: 28px; border-radius: 6px; color: ${PAGE_PALETTE.secondary};
}
.model:hover { background: ${PAGE_PALETTE.raised}; }
.model svg { position: absolute; right: 6px; width: 12px; height: 12px; pointer-events: none; }
.model-select {
	all: unset; box-sizing: border-box; height: 28px; max-width: 100%; padding: 0 22px 0 8px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	font: 12px/28px ${SYSTEM_FONT}; color: inherit; cursor: pointer;
}
.model-select:focus-visible { border-radius: 6px; box-shadow: 0 0 0 2px ${PAGE_PALETTE.accent}; }
.model-select:disabled { cursor: default; }
.model-select option { background: ${PAGE_PALETTE.raised}; color: ${PAGE_PALETTE.text}; }
.send {
	all: unset; display: grid; place-items: center; flex: none; box-sizing: border-box;
	width: 28px; height: 28px; border-radius: 999px;
	background: ${PAGE_PALETTE.send}; color: ${PAGE_PALETTE.sendText}; cursor: pointer;
	transition: transform 100ms ease-out;
}
.send:hover:not(:disabled) { background: ${PAGE_PALETTE.sendHover}; }
.send:active:not(:disabled) { transform: scale(0.94); }
.send:focus-visible { box-shadow: 0 0 0 2px ${PAGE_PALETTE.surface}, 0 0 0 4px ${PAGE_PALETTE.accent}; }
.send:disabled { background: transparent; color: ${PAGE_PALETTE.sendDisabledText}; cursor: default; }
.send.busy:disabled { background: ${PAGE_PALETTE.send}; color: ${PAGE_PALETTE.sendText}; }
.send svg { width: 16px; height: 16px; }
.spinner {
	box-sizing: border-box; width: 14px; height: 14px; border-radius: 999px;
	border: 2px solid currentColor; border-right-color: transparent;
	animation: malini-spin 700ms linear infinite;
}
.live { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes malini-picker-in { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@keyframes malini-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
	.box, .send, .panel { transition: none; }
	.panel { animation: none; }
	.spinner { animation-duration: 2s; }
}
`;

const PICKER_PROGRAM = String.raw`(command, css, glyphs) => {
	const KEY = '__maliniPicker';
	const running = globalThis[KEY];
	if (command.kind === 'end') {
		if (running) running.end();
		return null;
	}
	if (command.kind === 'prompt') return running ? running.prompt(command) : null;
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
		const chips = part('div', 'chips');
		const chip = part('span', 'chip');
		const chipName = part('span', 'chip-name');
		chip.append(glyph(glyphs.element), chipName);
		chips.append(chip);
		const field = doc.createElement('textarea');
		field.className = 'field';
		field.rows = 2;
		field.maxLength = 4000;
		field.placeholder = 'Describe a change, or ask about it…';
		field.setAttribute('aria-label', 'Prompt');
		const error = part('div', 'error');
		error.setAttribute('role', 'alert');
		const foot = part('div', 'foot');
		const model = part('div', 'model');
		const modelSelect = doc.createElement('select');
		modelSelect.className = 'model-select';
		modelSelect.setAttribute('aria-label', 'Model');
		model.append(modelSelect, glyph(glyphs.chevronDown));
		const send = doc.createElement('button');
		send.type = 'button';
		send.className = 'send';
		foot.append(model, send);
		panel.append(chips, field, error, foot);
		const live = part('div', 'live');
		live.setAttribute('role', 'status');
		layer.append(box, tag, shield, hint, panel, live);
		root.append(layer);
		for (const piece of [box, tag, shield, hint, panel, error]) piece.hidden = true;
		doc.documentElement.append(host);
		hidePins(true);

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
		setBusy(false);

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

		function prompt(request) {
			return new Promise((resolve) => {
				finish(null);
				if (!locked || ended) {
					resolve(null);
					return;
				}
				pending = resolve;
				if (mode !== 'sending') side = null;
				mode = 'prompt';
				const name = describe(locked);
				chipName.textContent = name;
				chip.title = name + ' · ' + size(lockedRect);
				panel.setAttribute('aria-label', 'Ask about ' + name);
				fillModels(request.models, request.provider, request.model);
				error.textContent = request.error || '';
				error.hidden = !request.error;
				setBusy(false);
				panel.hidden = false;
				update();
				field.focus({ preventScroll: true });
				announce(
					request.error
						? 'Not sent: ' + request.error
						: 'Selected ' + name + '. Type a prompt, then press Enter to send.',
				);
			});
		}

		function fillModels(models, provider, model) {
			const choices = Array.isArray(models) ? models : [];
			const groups = new Map();
			for (const choice of choices) {
				const name = choice.providerName || choice.provider;
				const options = groups.get(name) || [];
				options.push(choice);
				groups.set(name, options);
			}
			modelSelect.replaceChildren(
				...Array.from(groups, ([name, options]) => {
					const group = doc.createElement('optgroup');
					group.label = name;
					group.append(
						...options.map((choice) => {
							const option = doc.createElement('option');
							option.value = JSON.stringify({ provider: choice.provider, model: choice.id });
							option.textContent = choice.label;
							return option;
						}),
					);
					return group;
				}),
			);
			modelSelect.value = JSON.stringify({ provider, model });
			model.hidden = choices.length === 0;
		}

		function setBusy(busy) {
			field.disabled = busy;
			modelSelect.disabled = busy;
			send.classList.toggle('busy', busy);
			send.replaceChildren(busy ? part('span', 'spinner') : glyph(glyphs.arrowUp));
			send.setAttribute('aria-label', busy ? 'Sending' : 'Send');
			refresh();
		}

		function hidePins(hidden) {
			const pins = globalThis.__maliniPins;
			if (pins && typeof pins.hide === 'function') pins.hide(hidden);
		}

		function end() {
			if (ended) return;
			ended = true;
			for (const type of Object.keys(guards)) window.removeEventListener(type, guards[type], true);
			host.remove();
			hidePins(false);
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
			mode = 'sending';
			error.hidden = true;
			setBusy(true);
			announce('Starting a thread…');
			let selection = { provider: '', model: modelSelect.value };
			try {
				selection = JSON.parse(modelSelect.value);
			} catch {}
			finish({ kind: 'send', prompt: text, provider: selection.provider, model: selection.model });
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
			if (mode === 'sending') {
				block(event);
				return;
			}
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
			if (
				event.key === 'Enter' &&
				!event.shiftKey &&
				!event.isComposing &&
				root.activeElement === field
			) {
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
			const stops = [field, modelSelect, send].filter(
				(stop) => !stop.disabled && !(stop === modelSelect && model.hidden),
			);
			const index = stops.indexOf(root.activeElement);
			const next = stops[(index + (backwards ? -1 : 1) + stops.length) % stops.length] || field;
			next.focus();
		}

		function refresh() {
			send.disabled = mode === 'sending' || field.value.trim().length === 0;
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
			} else if (mode === 'prompt' || mode === 'sending') {
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
			const width = Math.min(360, innerWidth - margin * 2);
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
				.filter(
					(value) =>
						/^[A-Za-z_][\w-]{0,31}$/.test(value) &&
						!value.startsWith('svelte-') &&
						!/^(?:s|css|sc|jsx)-(?=[\w-]*\d)[\w-]{5,}$/.test(value),
				)
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

		function glyph(path) {
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
			const line = doc.createElementNS(ns, 'path');
			line.setAttribute('d', path);
			svg.append(line);
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
