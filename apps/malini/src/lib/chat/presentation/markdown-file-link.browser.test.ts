import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import {
	linkifyFileMentions,
	markOpenableFileMentions,
	type FileMentionTarget,
} from './file-mention-links';
import MarkdownText from './MarkdownText.svelte';

type Harness = { host: HTMLElement; opened: FileMentionTarget[]; stop: () => void };

const mounted: Harness[] = [];

function render(text: string, canopenfile?: (path: string) => boolean): Harness {
	const host = document.createElement('div');
	document.body.append(host);
	const opened: FileMentionTarget[] = [];
	const app = mount(MarkdownText, {
		target: host,
		props: {
			text,
			mode: 'prose' as const,
			onopenfile: (target: FileMentionTarget) => opened.push(target),
			canopenfile,
		},
	});
	flushSync();
	const harness: Harness = {
		host,
		opened,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
	mounted.push(harness);
	return harness;
}

function fileLink(host: HTMLElement): HTMLAnchorElement {
	const anchor = host.querySelector<HTMLAnchorElement>('a[data-file-path]');
	if (!anchor) throw new Error(`No file link in: ${host.innerHTML}`);
	return anchor;
}

afterEach(() => {
	while (mounted.length > 0) mounted.pop()?.stop();
	vi.restoreAllMocks();
	setPlatformForTest(null);
});

describe('clicking a file the agent named', () => {
	it('hands the transcript the path and the line', () => {
		const { host, opened } = render('The stack points at `src/app.ts:42` in this run.');

		fileLink(host).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(opened).toEqual([{ path: 'src/app.ts', line: 42 }]);
	});

	it('opens the same file from the keyboard', () => {
		const { host, opened } = render('Look at src/lib/render-state.ts for the projector.');
		const anchor = fileLink(host);

		anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		anchor.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

		expect(opened).toEqual([
			{ path: 'src/lib/render-state.ts', line: null },
			{ path: 'src/lib/render-state.ts', line: null },
		]);
	});

	it('reaches the file even when the click lands on the code chip inside the link', () => {
		const { host, opened } = render('Rewrote `src/app.ts` today.');
		const chip = host.querySelector('a[data-file-path] > code');
		if (!chip) throw new Error('The mention did not keep its code span');

		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(opened).toEqual([{ path: 'src/app.ts', line: null }]);
	});

	it('still sends a real URL to the OS, and never to the file opener', () => {
		const platform = createFakePlatform();
		setPlatformForTest(platform);
		const { host, opened } = render('Docs are at https://example.com/guide for now.');
		const anchor = host.querySelector<HTMLAnchorElement>('a[href]');
		if (!anchor) throw new Error(`No external link in: ${host.innerHTML}`);

		anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(platform.calls.filter(({ command }) => command === 'app.open-external-url')).toEqual([
			{ command: 'app.open-external-url', args: { url: 'https://example.com/guide' } },
		]);
		expect(opened).toEqual([]);
		expect(anchor.hasAttribute('data-file-path')).toBe(false);
	});
});

describe('a file the agent named that the workstream does not have', () => {
	it('stays plain text the pointer and the keyboard cannot open', () => {
		const { host, opened } = render('Compare `src/app.ts` with `credentials.ts`.', (path) =>
			path.endsWith('app.ts'),
		);
		const named = [...host.querySelectorAll<HTMLElement>('a[data-file-path]')];

		expect(links(host)).toEqual(['Open src/app.ts']);
		const missing = named.find((anchor) => anchor.textContent === 'credentials.ts');
		if (!missing) throw new Error(`credentials.ts is gone from: ${host.innerHTML}`);
		missing.focus();
		expect(document.activeElement).not.toBe(missing);
		missing.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		missing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(opened).toEqual([]);
	});

	it('becomes a link once the workstream has it, and stops being one when it is gone', () => {
		const host = document.createElement('div');
		host.innerHTML = linkifyFileMentions('<p>See <code>remote.ts</code> and src/lib/app.ts.</p>');

		markOpenableFileMentions(host, () => false);
		expect(links(host)).toEqual([]);

		markOpenableFileMentions(host, (path) => path === 'remote.ts');
		expect(links(host)).toEqual(['Open remote.ts']);

		markOpenableFileMentions(host, undefined);
		expect(links(host)).toEqual(['Open remote.ts', 'Open src/lib/app.ts']);
	});
});

function links(host: HTMLElement): string[] {
	return [...host.querySelectorAll('[role="link"]')].map(
		(link) => link.getAttribute('aria-label') ?? '',
	);
}
