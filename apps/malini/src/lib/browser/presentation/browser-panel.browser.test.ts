import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserElementPrompt } from '$contract/browser';
import { overlaySuppression } from '$hyper-ui/overlay';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import BrowserPanel from './BrowserPanel.svelte';

const SNAPSHOT = 'data:image/jpeg;base64,c25hcHNob3Q=';
const VIEWPORT = { x: 420, y: 92, width: 360, height: 600 };

const PICKED: BrowserElementPrompt = {
	prompt: 'Make this button primary',
	element: {
		url: 'http://localhost:5173/',
		domPath: 'main > button.save',
		rect: { top: 40, left: 24, width: 96, height: 32 },
		html: '<button class="save">Save</button>',
		source: 'src/App.svelte:12:3',
	},
	screenshot: { mediaType: 'image/png', base64: 'cG5n' },
};

type Harness = Readonly<{
	host: HTMLElement;
	platform: FakePlatform;
	prompts: Array<Readonly<{ workstreamId: string; picked: BrowserElementPrompt }>>;
	stop: () => void;
}>;

const mounted: Harness[] = [];
let nextWorkstream = 0;

beforeAll(() => {
	if (typeof HTMLImageElement.prototype.decode !== 'function') {
		HTMLImageElement.prototype.decode = async (): Promise<void> => undefined;
	}
});

afterEach(() => {
	while (mounted.length > 0) mounted.pop()?.stop();
	overlaySuppression.reset();
	vi.restoreAllMocks();
	setPlatformForTest(null);
});

describe('the browser panel', () => {
	it('explains how to open a page while nothing is loaded and keeps the native view hidden', async () => {
		const { host, platform } = render();

		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));

		expect(host.textContent).toContain(
			'Type a URL above, or ask the agent to open your dev server.',
		);
		expect(commands(platform, 'browser.show')).toEqual([]);
	});

	it('opens the address typed into the field and lays the page over the viewport', async () => {
		const { host, platform } = render();
		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));

		typeAddress(host, 'localhost:5173');

		const workstreamId = workstreamOf(platform);
		expect(commands(platform, 'browser.navigate')).toEqual([
			{ workstreamId, url: 'localhost:5173' },
		]);
		await vi.waitFor(() =>
			expect(commands(platform, 'browser.show')).toEqual([{ workstreamId, bounds: VIEWPORT }]),
		);
		expect(addressField(host).value).toBe('localhost:5173');
		expect(host.textContent).not.toContain('Open a page');
	});

	it('reopens the page a workstream showed before malini restarted', async () => {
		localStorage.setItem(
			`malini.browser.last-page:v1:browser-panel-${nextWorkstream + 1}`,
			'http://localhost:5173/admin',
		);
		const { host, platform } = render();

		const workstreamId = workstreamOf(platform);
		await vi.waitFor(() =>
			expect(commands(platform, 'browser.navigate')).toEqual([
				{ workstreamId, url: 'http://localhost:5173/admin' },
			]),
		);
		expect(addressField(host).value).toBe('localhost:5173/admin');
		expect(host.textContent).not.toContain('Open a page');
	});

	it('presses the pick toggle while a pick is open and hands the picked element on', async () => {
		const { host, platform, prompts } = render();
		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));
		typeAddress(host, 'http://localhost:5173/');
		let finishPick: (picked: BrowserElementPrompt | null) => void = () => undefined;
		platform.define(
			'browser.pick-element',
			() => new Promise<BrowserElementPrompt | null>((resolve) => (finishPick = resolve)),
		);
		const toggle = button(host, 'Pick an element');
		await vi.waitFor(() => expect(toggle.disabled).toBe(false));
		expect(toggle.getAttribute('aria-pressed')).toBe('false');

		toggle.click();
		flushSync();

		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		finishPick(PICKED);
		await vi.waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
		expect(prompts).toEqual([{ workstreamId: workstreamOf(platform), picked: PICKED }]);
	});

	it('shows a still of the page while a malini overlay covers it, then brings the page back', async () => {
		const { host, platform } = render();
		platform.define('browser.snapshot', async () => SNAPSHOT);
		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));
		typeAddress(host, 'http://localhost:5173/');
		await vi.waitFor(() => expect(commands(platform, 'browser.show')).toHaveLength(1));

		const releaseOverlay = overlaySuppression.suppress();

		await vi.waitFor(() => expect(commands(platform, 'browser.hide')).toHaveLength(1));
		expect(commands(platform, 'browser.snapshot')).toHaveLength(1);
		expect(host.querySelector('img')?.getAttribute('src')).toBe(SNAPSHOT);

		releaseOverlay();

		await vi.waitFor(() => expect(commands(platform, 'browser.show')).toHaveLength(2));
		await vi.waitFor(() => expect(host.querySelector('img')).toBeNull());
	});
});

function render(): Harness {
	const platform = createFakePlatform();
	setPlatformForTest(platform);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
		DOMRect.fromRect(VIEWPORT),
	);
	nextWorkstream += 1;
	const workstreamId = `browser-panel-${nextWorkstream}`;
	const prompts: Array<Readonly<{ workstreamId: string; picked: BrowserElementPrompt }>> = [];
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(BrowserPanel, {
		target: host,
		props: {
			workstreamId,
			onElementPrompt: (id: string, picked: BrowserElementPrompt) =>
				prompts.push({ workstreamId: id, picked }),
		},
	});
	flushSync();
	const harness: Harness = {
		host,
		platform,
		prompts,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
	mounted.push(harness);
	return harness;
}

function typeAddress(host: HTMLElement, address: string): void {
	const field = addressField(host);
	field.focus();
	field.value = address;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	flushSync();
}

function addressField(host: HTMLElement): HTMLInputElement {
	const field = host.querySelector<HTMLInputElement>('input[aria-label="Page address"]');
	if (!field) throw new Error('No page address field');
	return field;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
	const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
	if (!found) throw new Error(`No ${name} button`);
	return found;
}

function commands(platform: FakePlatform, command: string): unknown[] {
	return platform.calls.filter((call) => call.command === command).map((call) => call.args);
}

function workstreamOf(platform: FakePlatform): string {
	const call = platform.calls.find((candidate) => candidate.command === 'browser.state');
	const args = call?.args;
	if (typeof args !== 'object' || args === null || !('workstreamId' in args)) return '';
	return String(args.workstreamId);
}
