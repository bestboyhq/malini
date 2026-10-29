// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { pinsScript, type PagePin, type PinsCommand } from './thread-pins-page';

const PAGE = `<main id="app"><h1 class="title">Pricing</h1><p class="quiet">No, really.</p></main>`;

const HARNESS = String.raw`(() => {
	const pins = () => {
		const host = document.querySelector('malini-pins');
		if (!host || !host.shadowRoot) throw new Error('no pins on the page');
		return host.shadowRoot;
	};
	const named = (name) => {
		const found = Array.from(pins().querySelectorAll('button')).find(
			(button) => button.textContent === name || button.getAttribute('aria-label') === name,
		);
		if (!found) throw new Error('no button named ' + name);
		return found;
	};
	const pin = () => pins().querySelector('button.pin');
	globalThis.__pinsTest = {
		setPage: (markup) => {
			document.body.innerHTML = markup;
		},
		page: () => document.body.innerHTML,
		pinCount: () => pins().querySelectorAll('button.pin').length,
		pinLabel: () => pin().getAttribute('aria-label'),
		pinExpanded: () => pin().getAttribute('aria-expanded'),
		pinHidden: () => pin().hidden,
		clickPin: () => pin().click(),
		click: (name) => named(name).click(),
		cardHidden: () => pins().querySelector('[role="dialog"]').hidden,
		cardText: () => pins().querySelector('[role="dialog"]').textContent,
	};
})()`;

const PIN: PagePin = {
	sessionId: 'session-1',
	domPath: 'main#app > p.quiet',
	prompt: 'Remove this line',
	status: 'working',
	outcome: null,
};

function inPage(code: string): unknown {
	return globalThis.eval(code);
}

function call(name: string, ...args: unknown[]): unknown {
	return inPage(`__pinsTest.${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
}

function run(command: PinsCommand): Promise<unknown> {
	return Promise.resolve(inPage(pinsScript(command)));
}

afterEach(async () => {
	await run({ kind: 'show', pins: [] });
	call('setPage', '');
});

describe('the pins a thread leaves on a page', () => {
	it('shows a collapsed pin that opens to the thread, and hands back what the user chose', async () => {
		inPage(HARNESS);
		call('setPage', PAGE);
		await run({ kind: 'show', pins: [PIN] });

		expect(call('pinLabel')).toBe('Thread: Remove this line · Working…');
		expect(call('pinExpanded')).toBe('false');
		expect(call('cardHidden')).toBe(true);

		call('clickPin');
		expect(call('pinExpanded')).toBe('true');
		expect(call('cardHidden')).toBe(false);
		expect(call('cardText')).toContain('Remove this line');

		const opening = run({ kind: 'action' });
		call('click', 'Open chat');
		await expect(opening).resolves.toEqual({ kind: 'open', sessionId: 'session-1' });
		expect(call('cardHidden')).toBe(true);
		expect(call('page')).toBe(PAGE);
	});

	it('follows the thread to done with its outcome, and dismisses it', async () => {
		inPage(HARNESS);
		call('setPage', PAGE);
		await run({ kind: 'show', pins: [PIN] });
		await run({
			kind: 'show',
			pins: [{ ...PIN, status: 'done', outcome: 'The quiet line is gone' }],
		});

		expect(call('pinLabel')).toBe('Thread: Remove this line · Done');
		call('clickPin');
		expect(call('cardText')).toContain('The quiet line is gone');

		call('click', 'Dismiss');
		await expect(run({ kind: 'action' })).resolves.toEqual({
			kind: 'dismiss',
			sessionId: 'session-1',
		});
		expect(call('pinCount')).toBe(0);
	});

	it('stays on the closest element left when the edit removes the one it was on', async () => {
		inPage(HARNESS);
		call('setPage', '<main id="app"><h1 class="title">Pricing</h1></main>');
		await run({ kind: 'show', pins: [PIN] });

		expect(call('pinHidden')).toBe(false);
	});
});
