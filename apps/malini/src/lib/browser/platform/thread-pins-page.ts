import { GLYPHS, PAGE_PALETTE, SYSTEM_FONT } from './picker-page';

export type PinStatus = 'working' | 'waiting' | 'done' | 'failed';

export type PagePin = {
	readonly sessionId: string;
	readonly domPath: string;
	readonly prompt: string;
	readonly status: PinStatus;
	readonly outcome: string | null;
};

export type PinsCommand =
	{ readonly kind: 'show'; readonly pins: readonly PagePin[] } | { readonly kind: 'action' };

export function pinsScript(command: PinsCommand): string {
	return `(${PINS_PROGRAM})(${JSON.stringify(command)}, ${JSON.stringify(PINS_CSS)}, ${JSON.stringify(GLYPHS)})`;
}

const PIN_SIZE = 22;

const PINS_CSS = `
[hidden] { display: none !important; }
.layer {
	position: fixed; inset: 0; pointer-events: none;
	font: 13px/20px ${SYSTEM_FONT}; color: ${PAGE_PALETTE.text};
	-webkit-font-smoothing: antialiased; letter-spacing: normal; text-align: left;
}
.outline {
	position: fixed; top: 0; left: 0; box-sizing: border-box;
	border: 1.5px dashed ${PAGE_PALETTE.accent}; border-radius: 3px;
}
.pin {
	all: unset; position: fixed; top: 0; left: 0; box-sizing: border-box;
	display: grid; place-items: center; width: ${PIN_SIZE}px; height: ${PIN_SIZE}px; border-radius: 999px;
	border: 1px solid ${PAGE_PALETTE.border}; background: ${PAGE_PALETTE.surface}; color: ${PAGE_PALETTE.accent};
	box-shadow: 0 0 0 2px ${PAGE_PALETTE.shadowNear}, 0 4px 12px ${PAGE_PALETTE.shadow};
	pointer-events: auto; cursor: pointer; transition: scale 120ms ease-out, box-shadow 150ms ease-out;
}
.pin:hover { scale: 1.1; }
.pin:focus-visible, .pin[aria-expanded='true'] {
	box-shadow: 0 0 0 3px ${PAGE_PALETTE.accentRing}, 0 4px 12px ${PAGE_PALETTE.shadow};
}
.pin.waiting { border-color: transparent; background: ${PAGE_PALETTE.attention}; color: ${PAGE_PALETTE.sendText}; }
.pin.done { border-color: transparent; background: ${PAGE_PALETTE.success}; color: ${PAGE_PALETTE.sendText}; }
.pin.failed { border-color: transparent; background: ${PAGE_PALETTE.danger}; color: ${PAGE_PALETTE.sendText}; }
.pin svg { width: 14px; height: 14px; }
.pin.pop { animation: malini-pin-pop 320ms cubic-bezier(0.2, 0.9, 0.3, 1.4); }
.spinner {
	box-sizing: border-box; width: 12px; height: 12px; border-radius: 999px;
	border: 2px solid currentColor; border-right-color: transparent;
	animation: malini-spin 700ms linear infinite;
}
.card {
	position: fixed; top: 0; left: 0; display: flex; flex-direction: column; gap: 8px;
	box-sizing: border-box; width: 300px; max-width: calc(100vw - 16px); padding: 10px 12px 12px;
	border: 1px solid ${PAGE_PALETTE.border}; border-radius: 12px; background: ${PAGE_PALETTE.surface};
	box-shadow: 0 16px 40px ${PAGE_PALETTE.shadow}, 0 2px 8px ${PAGE_PALETTE.shadowNear};
	pointer-events: auto; animation: malini-card-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.state { flex: 1; display: flex; align-items: center; gap: 6px; font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 999px; background: ${PAGE_PALETTE.accent}; }
.dot.waiting { background: ${PAGE_PALETTE.attention}; }
.dot.done { background: ${PAGE_PALETTE.success}; }
.dot.failed { background: ${PAGE_PALETTE.danger}; }
.icon-button {
	all: unset; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
	color: ${PAGE_PALETTE.faint}; cursor: pointer;
}
.icon-button:hover { background: ${PAGE_PALETTE.raised}; color: ${PAGE_PALETTE.text}; }
.icon-button svg { width: 14px; height: 14px; }
.prompt {
	margin: 0; padding-left: 10px; border-left: 2px solid ${PAGE_PALETTE.border};
	color: ${PAGE_PALETTE.secondary}; white-space: pre-wrap; overflow-wrap: anywhere;
	display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.outcome { margin: 0; overflow-wrap: anywhere; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.button {
	all: unset; display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;
	height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer;
}
.button svg { width: 14px; height: 14px; }
.button.primary { background: ${PAGE_PALETTE.send}; color: ${PAGE_PALETTE.sendText}; }
.button.primary:hover { background: ${PAGE_PALETTE.sendHover}; }
.button.quiet { color: ${PAGE_PALETTE.secondary}; }
.button.quiet:hover { background: ${PAGE_PALETTE.raised}; color: ${PAGE_PALETTE.text}; }
.button:focus-visible, .icon-button:focus-visible { box-shadow: 0 0 0 2px ${PAGE_PALETTE.accent}; }
@keyframes malini-spin { to { transform: rotate(360deg); } }
@keyframes malini-pin-pop { from { scale: 0.4; opacity: 0; } }
@keyframes malini-card-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) {
	.pin { transition: none; }
	.pin.pop, .card { animation: none; }
	.spinner { animation-duration: 2s; }
}
`;

const PINS_PROGRAM = String.raw`(command, css, glyphs) => {
	const KEY = '__maliniPins';
	const pins = globalThis[KEY] || start();
	if (command.kind === 'show') {
		pins.show(command.pins);
		return null;
	}
	return pins.next();

	function start() {
		const doc = document;
		const SIZE = ${PIN_SIZE};
		const MARGIN = 6;
		const STATES = {
			working: 'Working…',
			waiting: 'Needs you',
			done: 'Done',
			failed: 'Failed',
		};
		const host = doc.createElement('malini-pins');
		const root = host.attachShadow({ mode: 'open' });
		adopt(root);
		const layer = part('div', 'layer');
		const outline = part('div', 'outline');
		const card = part('div', 'card');
		card.setAttribute('role', 'dialog');
		const head = part('div', 'head');
		const state = part('div', 'state');
		const dot = part('span', 'dot');
		const stateText = part('span', 'state-text');
		state.append(dot, stateText);
		const collapseButton = button('icon-button', glyphs.close, '');
		collapseButton.setAttribute('aria-label', 'Close');
		head.append(state, collapseButton);
		const quote = part('p', 'prompt');
		const outcome = part('p', 'outcome');
		const actions = part('div', 'actions');
		const openButton = button('button primary', glyphs.chat, 'Open chat');
		const dismissButton = button('button quiet', '', 'Dismiss');
		actions.append(openButton, dismissButton);
		card.append(head, quote, outcome, actions);
		layer.append(outline, card);
		root.append(layer);
		outline.hidden = true;
		card.hidden = true;
		hide(false);
		doc.documentElement.append(host);

		const items = new Map();
		const queued = [];
		let waiter = null;
		let open = null;
		let hovered = null;
		let scheduled = false;
		let poll = null;

		for (const type of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown']) {
			host.addEventListener(type, (event) => event.stopPropagation());
		}
		collapseButton.addEventListener('click', () => collapse(true));
		openButton.addEventListener('click', () => {
			if (!open) return;
			act({ kind: 'open', sessionId: open });
			collapse(false);
		});
		dismissButton.addEventListener('click', () => {
			if (!open) return;
			const sessionId = open;
			act({ kind: 'dismiss', sessionId });
			collapse(false);
			remove(sessionId);
		});
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') collapse(true);
		});
		window.addEventListener(
			'pointerdown',
			(event) => {
				if (open && !event.composedPath().includes(host)) collapse(false);
			},
			true,
		);
		window.addEventListener('scroll', schedule, { capture: true, passive: true });
		window.addEventListener('resize', schedule, { passive: true });

		const api = { show, next, hide };
		globalThis[KEY] = api;
		return api;

		function show(next) {
			if (!host.isConnected) doc.documentElement.append(host);
			const seen = new Set();
			for (const pin of Array.isArray(next) ? next : []) {
				seen.add(pin.sessionId);
				let item = items.get(pin.sessionId);
				if (!item) {
					item = { pin: null, element: makePin(pin.sessionId) };
					items.set(pin.sessionId, item);
				}
				const fresh = item.pin === null || item.pin.status !== pin.status;
				item.pin = pin;
				paint(item, fresh);
			}
			for (const sessionId of [...items.keys()]) {
				if (!seen.has(sessionId)) remove(sessionId);
			}
			if (open && items.has(open)) fill(items.get(open));
			follow();
			update();
		}

		function follow() {
			if (items.size > 0 && poll === null) {
				// ponytail: polls anchors every 400ms to follow layout an edit moves; observe mutations if it costs
				poll = setInterval(schedule, 400);
			} else if (items.size === 0 && poll !== null) {
				clearInterval(poll);
				poll = null;
			}
		}

		function next() {
			if (waiter) waiter(null);
			return new Promise((resolve) => {
				const action = queued.shift();
				if (action) {
					resolve(action);
					return;
				}
				waiter = (value) => {
					waiter = null;
					resolve(value);
				};
			});
		}

		function hide(hidden) {
			host.style.cssText =
				'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: none !important; display: ' +
				(hidden ? 'none' : 'block') +
				' !important;';
		}

		function act(action) {
			if (waiter) waiter(action);
			else queued.push(action);
		}

		function makePin(sessionId) {
			const element = doc.createElement('button');
			element.type = 'button';
			element.className = 'pin';
			element.setAttribute('aria-haspopup', 'dialog');
			element.setAttribute('aria-expanded', 'false');
			element.addEventListener('click', () => {
				if (open === sessionId) collapse(true);
				else expand(sessionId);
			});
			element.addEventListener('pointerenter', () => {
				hovered = sessionId;
				schedule();
			});
			element.addEventListener('pointerleave', () => {
				if (hovered === sessionId) hovered = null;
				schedule();
			});
			element.addEventListener('animationend', () => element.classList.remove('pop'));
			layer.insertBefore(element, card);
			return element;
		}

		function paint(item, fresh) {
			const { element, pin } = item;
			element.className = 'pin ' + pin.status;
			if (fresh) {
				element.replaceChildren(
					pin.status === 'working'
						? part('span', 'spinner')
						: glyph(pin.status === 'done' ? glyphs.check : glyphs.alert),
				);
				void element.offsetWidth;
				element.classList.add('pop');
			}
			element.setAttribute('aria-label', 'Thread: ' + pin.prompt + ' · ' + STATES[pin.status]);
		}

		function remove(sessionId) {
			const item = items.get(sessionId);
			if (!item) return;
			item.element.remove();
			items.delete(sessionId);
			if (open === sessionId) collapse(false);
			if (hovered === sessionId) hovered = null;
			follow();
			schedule();
		}

		function expand(sessionId) {
			const item = items.get(sessionId);
			if (!item) return;
			if (open && items.has(open)) items.get(open).element.setAttribute('aria-expanded', 'false');
			open = sessionId;
			item.element.setAttribute('aria-expanded', 'true');
			fill(item);
			card.hidden = false;
			update();
			openButton.focus({ preventScroll: true });
		}

		function collapse(refocus) {
			const item = open ? items.get(open) : null;
			open = null;
			card.hidden = true;
			if (item) {
				item.element.setAttribute('aria-expanded', 'false');
				if (refocus) item.element.focus({ preventScroll: true });
			}
			schedule();
		}

		function fill(item) {
			const { pin } = item;
			dot.className = 'dot ' + pin.status;
			stateText.textContent = STATES[pin.status];
			card.setAttribute('aria-label', 'Thread, ' + STATES[pin.status]);
			quote.textContent = pin.prompt;
			const detail =
				pin.status === 'waiting' ? 'It asks you something. Open the chat to answer.' : pin.outcome;
			outcome.textContent = detail || '';
			outcome.hidden = !detail;
		}

		function schedule() {
			if (scheduled) return;
			scheduled = true;
			if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
			else setTimeout(update, 16);
		}

		function update() {
			scheduled = false;
			const stacks = new Map();
			let openRect = null;
			let outlined = null;
			for (const [sessionId, item] of items) {
				const anchor = resolve(item.pin.domPath);
				const rect = anchor ? anchor.getBoundingClientRect() : null;
				const line = anchor ? anchor.getClientRects()[0] || rect : null;
				const visible =
					rect !== null &&
					rect.bottom >= 0 &&
					rect.top <= innerHeight &&
					rect.right >= 0 &&
					rect.left <= innerWidth;
				item.element.hidden = !visible;
				if (!visible) {
					if (open === sessionId) collapse(false);
					continue;
				}
				const stacked = stacks.get(anchor) || 0;
				stacks.set(anchor, stacked + 1);
				const left = clamp(
					line.right - SIZE / 2 - stacked * (SIZE + 4),
					MARGIN,
					innerWidth - SIZE - MARGIN,
				);
				const top = clamp(line.top - SIZE / 2, MARGIN, innerHeight - SIZE - MARGIN);
				item.element.style.translate = left + 'px ' + top + 'px';
				if (open === sessionId) openRect = { left, top };
				if (open === sessionId || hovered === sessionId) outlined = rect;
			}
			outline.hidden = outlined === null;
			if (outlined) {
				outline.style.translate = outlined.left - 3 + 'px ' + (outlined.top - 3) + 'px';
				outline.style.width = outlined.width + 6 + 'px';
				outline.style.height = outlined.height + 6 + 'px';
			}
			if (openRect) placeCard(openRect);
		}

		function placeCard(pin) {
			const width = card.offsetWidth;
			const height = card.offsetHeight;
			const below = pin.top + SIZE + 8;
			const top = below + height <= innerHeight - MARGIN ? below : pin.top - 8 - height;
			card.style.translate =
				clamp(pin.left + SIZE - width, MARGIN, innerWidth - width - MARGIN) +
				'px ' +
				clamp(top, MARGIN, innerHeight - height - MARGIN) +
				'px';
		}

		function resolve(domPath) {
			const exact = String(domPath).split(' > ');
			const unclassed = exact.map((piece) => piece.replace(/^([^.#:]+)(?:\.[\w-]+)+/, '$1'));
			for (let depth = exact.length; depth > 0; depth -= 1) {
				for (const parts of [exact, unclassed]) {
					try {
						const found = doc.querySelector(parts.slice(0, depth).join(' > '));
						if (found) return found;
					} catch {}
				}
			}
			return null;
		}

		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), Math.max(min, max));
		}

		function button(className, path, label) {
			const element = doc.createElement('button');
			element.type = 'button';
			element.className = className;
			if (path) element.append(glyph(path));
			if (label) element.append(doc.createTextNode(label));
			return element;
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
				'stroke-width': '1.75',
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
