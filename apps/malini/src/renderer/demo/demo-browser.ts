import type {
	BrowserBounds,
	BrowserPickArgs,
	BrowserState,
	BrowserTabArgs,
	BrowserThreadStarted,
} from '$contract/browser';
import type { DemoEmit, DemoHandlers } from './demo-bridge';
import { startThread } from './demo-live';
import { demoMediaUrl } from './demo-media';

/* eslint-disable @malini/desktop/no-literal-product-colors */
const PAGE_CSS = `
:host { all: initial; position: fixed; z-index: 2147483000; }
[hidden] { display: none !important; }
.frame {
	position: fixed; overflow: hidden; border-radius: 16px; background: #161616;
	font: 13px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
	color: #ece9e6; -webkit-font-smoothing: antialiased;
}
.site { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; }
.logo { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 14px; }
.logo i { width: 14px; height: 14px; border-radius: 50%; background: linear-gradient(135deg, #6d5cf6, #ff6a2b); }
header nav { display: flex; gap: 16px; color: #8d8985; font-size: 12px; }
main {
	flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 10px; padding: 12px 22px 28px; text-align: center;
}
h1 { margin: 0; font-size: 26px; line-height: 32px; font-weight: 650; letter-spacing: -0.02em; }
main p { margin: 0 0 10px; color: #8d8985; }
main img { width: 100%; max-width: 440px; border-radius: 12px; }
footer {
	display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
	padding: 14px 22px 18px; border-top: 1px solid #262524; color: #6f6b68; font-size: 12px;
}
footer nav { display: flex; align-items: baseline; gap: 14px; }
footer a { color: #8d8985; text-decoration: none; }
footer a.changelog {
	color: #ffffff; font-size: 14px; font-weight: 650; text-decoration: underline;
	text-underline-offset: 3px; transition: color 400ms ease;
}
footer a.changelog.fixed { color: #8d8985; font-size: 12px; font-weight: 400; text-decoration: none; }
footer a.changelog.fixed:hover { text-decoration: underline; }
.picking .site { cursor: crosshair; }
.box {
	position: absolute; top: 0; left: 0; box-sizing: border-box; pointer-events: none;
	border: 1.5px solid #3e9df3; border-radius: 3px; background: #3e9df31f;
	transition: transform 80ms ease-out, width 80ms ease-out, height 80ms ease-out;
}
.box.locked { border-width: 2px; background: transparent; box-shadow: 0 0 0 3px #3e9df359; }
.tag {
	position: absolute; top: 0; left: 0; display: flex; gap: 6px; padding: 2px 7px; pointer-events: none;
	border: 1px solid #42403f; border-radius: 6px; background: #312f2d; color: #f7f5f3;
	box-shadow: 0 2px 8px #00000033; font: 500 11px/16px ui-monospace, 'SF Mono', Menlo, monospace;
	white-space: nowrap;
}
.tag span { color: #86817e; font-weight: 400; }
.hint {
	position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px;
	padding: 6px 12px; border: 1px solid #42403f; border-radius: 999px; background: #312f2d;
	color: #f7f5f3; box-shadow: 0 8px 24px #00000066; font-size: 12px; line-height: 16px;
	white-space: nowrap; pointer-events: none;
}
.hint span { color: #86817e; }
.panel {
	position: absolute; top: 0; left: 0; display: flex; flex-direction: column; box-sizing: border-box;
	width: 300px; max-width: calc(100% - 16px); overflow: hidden;
	border: 1px solid #42403f; border-radius: 12px; background: #2a2927; color: #f7f5f3;
	box-shadow: 0 16px 40px #00000066, 0 2px 8px #00000033;
	animation: picker-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.chips { display: flex; padding: 10px 12px 0; }
.chip {
	display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 7px 0 6px;
	border: 1px solid #42403f; border-radius: 6px; background: #312f2d; color: #b8b5b2;
	font: 12px/16px ui-monospace, 'SF Mono', Menlo, monospace; white-space: nowrap;
}
.chip svg, .send svg, .pin svg, .open svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.chip svg { width: 12px; height: 12px; color: #86817e; }
.field {
	all: unset; display: block; box-sizing: border-box; width: 100%; min-height: 48px; padding: 8px 14px 4px;
	font-size: 14px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text;
}
.field::placeholder { color: #74706d; }
.foot {
	display: flex; align-items: center; justify-content: space-between; height: 44px;
	box-sizing: border-box; padding: 0 8px 4px;
}
.model { padding: 0 8px; color: #b8b5b2; font-size: 12px; }
.send {
	all: unset; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px;
	background: #fcfbfb; color: #161413; cursor: pointer;
}
.send:disabled { background: transparent; color: #696563; cursor: default; }
.send svg { width: 16px; height: 16px; }
.pin {
	all: unset; position: absolute; top: 0; left: 0; display: grid; place-items: center;
	box-sizing: border-box; width: 22px; height: 22px; border-radius: 999px;
	border: 1px solid #42403f; background: #2a2927; color: #3e9df3; cursor: pointer;
	box-shadow: 0 0 0 2px #00000033, 0 4px 12px #00000066;
	animation: pin-pop 320ms cubic-bezier(0.2, 0.9, 0.3, 1.4);
}
.pin.done { border-color: transparent; background: #4eda84; color: #161413; }
.pin svg { width: 14px; height: 14px; }
.spinner {
	box-sizing: border-box; width: 12px; height: 12px; border-radius: 999px;
	border: 2px solid currentColor; border-right-color: transparent; animation: spin 700ms linear infinite;
}
.outline {
	position: absolute; top: 0; left: 0; box-sizing: border-box; pointer-events: none;
	border: 1.5px dashed #3e9df3; border-radius: 3px;
}
.card {
	position: absolute; top: 0; left: 0; display: flex; flex-direction: column; gap: 8px;
	box-sizing: border-box; width: 280px; max-width: calc(100% - 16px); padding: 10px 12px 12px;
	border: 1px solid #42403f; border-radius: 12px; background: #2a2927; color: #f7f5f3;
	box-shadow: 0 16px 40px #00000066, 0 2px 8px #00000033;
	animation: picker-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.state { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 999px; background: #3e9df3; }
.dot.done { background: #4eda84; }
.prompt {
	margin: 0; padding-left: 10px; border-left: 2px solid #42403f; color: #b8b5b2;
	display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.outcome { margin: 0; }
.open {
	all: unset; display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
	height: 28px; padding: 0 10px; border-radius: 8px; background: #fcfbfb; color: #161413;
	font-size: 12px; font-weight: 500; cursor: pointer;
}
.open svg { width: 14px; height: 14px; }
@keyframes picker-in { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@keyframes pin-pop { from { scale: 0.4; opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
`;
/* eslint-enable @malini/desktop/no-literal-product-colors */

const GLYPHS = {
	arrowUp: 'M8 12.75v-9.5M4.25 7 8 3.25 11.75 7',
	element:
		'M2.25 3.5V2.25H3.5M6 2.25h1M9.5 2.25h1.25V3.5M2.25 6v1M2.25 9.5v1.25H3.5M6.75 6.75 13.5 9.25 10.5 10.5 9.25 13.5Z',
	check: 'M3.25 8.25l3 3 6.5-6.5',
	chat: 'M13.25 9.75a2 2 0 0 1-2 2H5.5l-2.75 2v-9a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2Z',
} as const;

const glyph = (name: keyof typeof GLYPHS): string =>
	`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GLYPHS[name]}"/></svg>`;

const SITE = (hero: string): string => `
	<div class="site">
		<header>
			<span class="logo" data-pick="span.logo"><i></i>Tony</span>
			<nav><span data-pick="a.docs">Docs</span><span data-pick="a.download">Download</span></nav>
		</header>
		<main>
			<h1 data-pick="h1">Talk to your Mac.</h1>
			<p data-pick="p.lede">Tony listens, then does what you said.</p>
			${hero ? `<img data-pick="img.hero" src="${hero}" alt="">` : ''}
		</main>
		<footer>
			<span data-pick="span.copyright">© 2026 Bestboy</span>
			<nav>
				<a data-pick="a" href="#privacy">Privacy</a>
				<a data-pick="a" href="#terms">Terms</a>
				<a class="changelog" data-pick="a.changelog" href="#changelog">Changelog</a>
			</nav>
		</footer>
	</div>`;

type Pick = Readonly<{
	args: BrowserPickArgs;
	resolve: (started: BrowserThreadStarted | null) => void;
}>;

const states = new Map<string, BrowserState>();
const keyOf = (tab: BrowserTabArgs): string => `${tab.workstreamId}/${tab.tabId}`;
let shown: string | null = null;
let pending: Pick | null = null;
let locked: HTMLElement | null = null;
let page: ShadowRoot | null = null;

function blank(tab: BrowserTabArgs): BrowserState {
	return {
		workstreamId: tab.workstreamId,
		tabId: tab.tabId,
		url: '',
		title: '',
		favicon: null,
		loading: false,
		canGoBack: false,
		canGoForward: false,
		failure: null,
	};
}

function part<Tag extends keyof HTMLElementTagNameMap>(
	tag: Tag,
	className: string,
	html = '',
): HTMLElementTagNameMap[Tag] {
	const element = document.createElement(tag);
	element.className = className;
	element.innerHTML = html;
	return element;
}

function root(): ShadowRoot {
	if (page) return page;
	const host = document.createElement('div');
	host.dataset['demoPage'] = '';
	page = host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	style.textContent = PAGE_CSS;
	const frame = part('div', 'frame', SITE(demoMediaUrl('tony-hero-after.webp') ?? ''));
	frame.hidden = true;
	page.append(style, frame);
	document.body.append(host);
	return page;
}

function frameOf(): HTMLElement {
	const frame = root().querySelector<HTMLElement>('.frame');
	if (!frame) throw new Error('the demo page has no frame');
	return frame;
}

function place(bounds: BrowserBounds): void {
	const frame = frameOf();
	Object.assign(frame.style, {
		left: `${bounds.x}px`,
		top: `${bounds.y}px`,
		width: `${bounds.width}px`,
		height: `${bounds.height}px`,
	});
	frame.hidden = false;
}

type Box = Readonly<{ left: number; top: number; width: number; height: number }>;

function boxOf(element: Element): Box {
	const frame = frameOf().getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	return {
		left: rect.left - frame.left,
		top: rect.top - frame.top,
		width: rect.width,
		height: rect.height,
	};
}

function at(element: HTMLElement, box: Box): void {
	Object.assign(element.style, {
		transform: `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`,
		width: `${Math.round(box.width)}px`,
		height: `${Math.round(box.height)}px`,
	});
}

function moveTo(element: HTMLElement, left: number, top: number): void {
	element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function clear(selector: string): void {
	for (const element of frameOf().querySelectorAll(selector)) element.remove();
}

function hover(target: Element | null): void {
	if (locked) return;
	const element = target?.closest<HTMLElement>('[data-pick]') ?? null;
	const frame = frameOf();
	let box = frame.querySelector<HTMLElement>('.box');
	let tag = frame.querySelector<HTMLElement>('.tag');
	if (!element) {
		box?.remove();
		tag?.remove();
		return;
	}
	box ??= frame.appendChild(part('div', 'box'));
	tag ??= frame.appendChild(part('div', 'tag'));
	const rect = boxOf(element);
	at(box, rect);
	tag.innerHTML = `${element.dataset['pick'] ?? ''}<span>${Math.round(rect.width)}×${Math.round(rect.height)}</span>`;
	moveTo(tag, rect.left, rect.top - 24 < 4 ? rect.top + rect.height + 6 : rect.top - 24);
}

function endPick(): void {
	pending = null;
	locked = null;
	frameOf().classList.remove('picking');
	clear('.box, .tag, .hint, .panel');
}

function lock(emit: DemoEmit, element: HTMLElement): void {
	const pick = pending;
	if (!pick) return;
	locked = element;
	const frame = frameOf();
	clear('.hint, .tag');
	frame.querySelector('.box')?.classList.add('locked');
	const panel = part(
		'div',
		'panel',
		`<div class="chips"><span class="chip">${glyph('element')}${element.dataset['pick'] ?? ''}</span></div>
		<textarea class="field" rows="2" placeholder="Describe a change, or ask about it…" aria-label="Prompt"></textarea>
		<div class="foot"><span class="model">${pick.args.models.find((model) => model.id === pick.args.model)?.label ?? 'Opus'}</span>
		<button class="send" type="button" aria-label="Send" disabled>${glyph('arrowUp')}</button></div>`,
	);
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-label', `Ask about ${element.dataset['pick'] ?? 'element'}`);
	frame.append(panel);
	const rect = boxOf(element);
	const width = panel.offsetWidth;
	const height = panel.offsetHeight;
	const below = rect.top + rect.height + 10;
	moveTo(
		panel,
		Math.min(Math.max(8, rect.left + rect.width - width), frame.clientWidth - width - 8),
		below + height < frame.clientHeight - 8 ? below : rect.top - height - 10,
	);
	const field = panel.querySelector('textarea');
	const send = panel.querySelector('button');
	if (!field || !send) return;
	field.addEventListener('input', () => (send.disabled = field.value.trim() === ''));
	const submit = (): void => {
		const prompt = field.value.trim();
		if (!prompt) return;
		const sessionId = startThread(emit, pick.args.workstreamId, prompt, pick.args.model);
		endPick();
		pinOn(emit, element, pick.args.workstreamId, sessionId, prompt);
		pick.resolve({ sessionId, provider: pick.args.provider, model: pick.args.model });
	};
	send.addEventListener('click', submit);
	field.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') cancel();
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		submit();
	});
	field.focus({ preventScroll: true });
}

function cancel(): void {
	const pick = pending;
	endPick();
	pick?.resolve(null);
}

function pinOn(
	emit: DemoEmit,
	element: HTMLElement,
	workstreamId: string,
	sessionId: string,
	prompt: string,
): void {
	const frame = frameOf();
	const rect = boxOf(element);
	const outline = frame.appendChild(part('div', 'outline'));
	at(outline, rect);
	const pin = frame.appendChild(part('button', 'pin', '<span class="spinner"></span>'));
	pin.setAttribute('aria-label', `Thread: ${prompt} · Working`);
	moveTo(pin, rect.left + rect.width - 4, rect.top - 18);
	let outcome = '';
	const stop = window.malini.on('chat:agent-event', (envelope) => {
		if (envelope.sessionId !== sessionId) return;
		const event = envelope.event;
		const text = 'text' in event ? event.text : null;
		if (event.type === 'assistant.message' && typeof text === 'string') {
			outcome = /^Outcome: (.*)$/mu.exec(text)?.[1] ?? outcome;
		}
		if (event.type !== 'run.completed') return;
		stop();
		element.classList.add('fixed');
		const fixed = boxOf(element);
		at(outline, fixed);
		moveTo(pin, fixed.left + fixed.width - 4, fixed.top - 18);
		pin.classList.add('done');
		pin.innerHTML = glyph('check');
		pin.setAttribute('aria-label', `Thread: ${prompt} · Done`);
	});
	pin.addEventListener('click', () => {
		frame.querySelector('.card')?.remove();
		const done = pin.classList.contains('done');
		const card = part(
			'div',
			'card',
			`<div class="state"><span class="dot${done ? ' done' : ''}"></span>${done ? 'Done' : 'Working…'}</div>
			<p class="prompt"></p>${done && outcome ? '<p class="outcome"></p>' : ''}
			<button class="open" type="button">${glyph('chat')}Open chat</button>`,
		);
		card.setAttribute('role', 'dialog');
		const quoted = card.querySelector('.prompt');
		if (quoted) quoted.textContent = prompt;
		const said = card.querySelector('.outcome');
		if (said) said.textContent = outcome;
		frame.append(card);
		const now = boxOf(element);
		moveTo(
			card,
			Math.max(
				8,
				Math.min(now.left + now.width - card.offsetWidth, frame.clientWidth - card.offsetWidth - 8),
			),
			Math.max(8, now.top - card.offsetHeight - 26),
		);
		card.querySelector('.open')?.addEventListener('click', () => {
			card.remove();
			emit('browser:thread-opened', { workstreamId, sessionId });
		});
	});
}

export function pagePart(selector: string): HTMLElement | null {
	return root().querySelector<HTMLElement>(selector);
}

export function openPage(emit: DemoEmit, workstreamId: string, url: string): void {
	const tab = { workstreamId, tabId: `tab-${workstreamId}` };
	const state: BrowserState = { ...blank(tab), url, title: 'Tony' };
	states.set(keyOf(tab), state);
	emit('browser:tab-opened', tab);
	emit('browser:state-changed', state);
}

export const browserHandlers = (emit: DemoEmit): DemoHandlers => {
	const listen = (): void => {
		const frame = frameOf();
		frame.addEventListener('pointermove', (event) => {
			if (pending) hover(event.target instanceof Element ? event.target : null);
		});
		frame.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!pending) {
				if (target?.closest('a')) event.preventDefault();
				return;
			}
			if (locked || target?.closest('.panel')) return;
			const element = target?.closest<HTMLElement>('[data-pick]');
			event.preventDefault();
			if (element) lock(emit, element);
		});
		addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && pending && !locked) cancel();
		});
	};
	let listening = false;
	const ready = (): void => {
		if (listening) return;
		listening = true;
		listen();
	};
	return {
		'browser.state': (tab) => states.get(keyOf(tab)) ?? blank(tab),
		'browser.navigate': ({ url, ...tab }) => {
			const state: BrowserState = { ...blank(tab), url, title: 'Tony' };
			states.set(keyOf(tab), state);
			emit('browser:state-changed', state);
		},
		'browser.show': ({ bounds, ...tab }) => {
			if (!states.get(keyOf(tab))?.url) return;
			ready();
			shown = keyOf(tab);
			place(bounds);
		},
		'browser.hide': (tab) => {
			if (shown !== keyOf(tab)) return;
			shown = null;
			frameOf().hidden = true;
		},
		'browser.snapshot': () => null,
		'browser.reload': () => undefined,
		'browser.go-back': () => undefined,
		'browser.go-forward': () => undefined,
		'browser.resized': () => undefined,
		'browser.close': (tab) => {
			states.delete(keyOf(tab));
		},
		'browser.cancel-pick': () => cancel(),
		'browser.pick-element': (args) =>
			new Promise<BrowserThreadStarted | null>((resolve) => {
				cancel();
				ready();
				pending = { args, resolve };
				const frame = frameOf();
				frame.classList.add('picking');
				frame.append(
					part('div', 'hint', 'Click an element to ask about it<span>Esc to cancel</span>'),
				);
			}),
	};
};
