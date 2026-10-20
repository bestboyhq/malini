// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickerScript, type PickerCommand } from './picker-page';

const PAGE = `<main id="app"><h1 class="title">Pricing</h1><button class="buy primary" type="button">Buy</button></main>`;

const HARNESS = String.raw`(() => {
	const pageEvents = [];
	const record = (event) => pageEvents.push(event.type);
	const watched = ['click', 'mousedown', 'pointerdown', 'keydown', 'input'];
	document.body.innerHTML = PAGE_MARKUP;
	for (const type of watched) document.addEventListener(type, record);
	const snapshot = document.documentElement.cloneNode(true);
	const picker = () => {
		const host = document.querySelector('malini-picker');
		return host ? host.shadowRoot : null;
	};
	const find = (selector) => {
		const inPicker = selector.startsWith('picker ');
		const scope = inPicker ? picker() : document;
		const found = scope ? scope.querySelector(inPicker ? selector.slice(7) : selector) : null;
		if (!found) throw new Error('nothing matches ' + selector);
		return found;
	};
	globalThis.__pickerTest = {
		pageEvents: () => pageEvents.slice(),
		pickerOnPage: () => picker() !== null,
		unchanged: () => document.documentElement.isEqualNode(snapshot),
		attribute: (selector, name) => find(selector).getAttribute(name),
		disabled: (selector) => find(selector).disabled === true,
		text: (selector) => find(selector).textContent,
		focused: () => {
			const active = picker() && picker().activeElement;
			return active ? active.getAttribute('aria-label') : null;
		},
		move: (selector) => {
			find(selector).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
		},
		click: (selector) => {
			const target = find(selector);
			for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
				target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true }));
			}
		},
		press: (selector, key, shiftKey) => {
			find(selector).dispatchEvent(
				new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, composed: true, cancelable: true }),
			);
		},
		type: (selector, text) => {
			const field = find(selector);
			field.value = text;
			field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		},
		reset: () => {
			for (const type of watched) document.removeEventListener(type, record);
			document.body.innerHTML = '';
		},
	};
})()`;

const FIELD = 'picker [aria-label="Prompt"]';
const SEND = 'picker [aria-label="Send"]';
const DIALOG = 'picker [role="dialog"]';
const STATUS = 'picker [role="status"]';

function inPage(code: string): unknown {
	return globalThis.eval(code);
}

function call(name: string, ...args: unknown[]): unknown {
	return inPage(`__pickerTest.${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
}

function run(command: PickerCommand): Promise<unknown> {
	return Promise.resolve(inPage(pickerScript(command)));
}

beforeEach(() => {
	inPage(HARNESS.replace('PAGE_MARKUP', JSON.stringify(PAGE)));
});

afterEach(async () => {
	await run({ kind: 'end' });
	call('reset');
});

describe('the in-page element picker', () => {
	it('picks a clicked element, takes a prompt, and leaves the page as it found it', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		call('move', 'button');
		call('click', 'button');

		await expect(selecting).resolves.toEqual({
			domPath: 'main#app > button.buy.primary',
			rect: { top: 0, left: 0, width: 0, height: 0 },
			html: '<button class="buy primary" type="button">Buy</button>',
			url: inPage('location.href'),
			viewport: { width: inPage('innerWidth'), height: inPage('innerHeight') },
		});

		const prompting = run({ kind: 'prompt' });
		let answered = false;
		void prompting.finally(() => {
			answered = true;
		});
		expect(call('attribute', DIALOG, 'aria-label')).toBe('Ask about button.buy.primary');
		expect(call('attribute', DIALOG, 'aria-modal')).toBe('true');
		expect(call('focused')).toBe('Prompt');
		expect(call('disabled', SEND)).toBe(true);

		call('type', FIELD, 'Make it green');
		expect(call('disabled', SEND)).toBe(false);

		call('press', FIELD, 'Tab', false);
		expect(call('focused')).toBe('Send');
		call('press', SEND, 'Tab', false);
		expect(call('focused')).toBe('Prompt');

		call('press', FIELD, 'Enter', true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(answered).toBe(false);

		call('press', FIELD, 'Enter', false);
		await expect(prompting).resolves.toEqual({ kind: 'send', prompt: 'Make it green' });

		expect(call('pageEvents')).toEqual([]);
		expect(call('pickerOnPage')).toBe(false);
		expect(call('unchanged')).toBe(true);
	});

	it('sends from the send button', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		call('click', 'h1');
		await selecting;

		const prompting = run({ kind: 'prompt' });
		call('type', FIELD, 'Tighter heading');
		call('click', SEND);

		await expect(prompting).resolves.toEqual({ kind: 'send', prompt: 'Tighter heading' });
		expect(call('pageEvents')).toEqual([]);
		expect(call('unchanged')).toBe(true);
	});

	it('cancels on Escape and removes itself', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		call('press', 'body', 'Escape', false);

		await expect(selecting).resolves.toBeNull();
		expect(call('pageEvents')).toEqual([]);
		expect(call('unchanged')).toBe(true);
	});

	it('picks with the keyboard and announces each element it moves to', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight']) {
			call('press', 'body', key, false);
		}
		expect(call('text', STATUS)).toBe('button.buy.primary');
		call('press', 'body', 'Enter', false);

		await expect(selecting).resolves.toMatchObject({ domPath: 'main#app > button.buy.primary' });
		expect(call('pageEvents')).toEqual([]);
	});

	it('switches to another element clicked while the prompt is open', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		call('click', 'button');
		await selecting;

		const prompting = run({ kind: 'prompt' });
		call('click', 'h1');
		await expect(prompting).resolves.toEqual({ kind: 'reselect' });

		await expect(run({ kind: 'select', reselect: true })).resolves.toMatchObject({
			domPath: 'main#app > h1.title',
		});
		expect(call('pageEvents')).toEqual([]);
	});

	it('ends an open pick when malini cancels it', async () => {
		const selecting = run({ kind: 'select', reselect: false });
		await run({ kind: 'end' });

		await expect(selecting).resolves.toBeNull();
		expect(call('pickerOnPage')).toBe(false);
		expect(call('unchanged')).toBe(true);
	});
});
