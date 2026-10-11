import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTurnReport } from '$lib/chat/domain/turn-report';
import type { RenderItem, RunGroup } from './render-state';
import TurnReportCard from './TurnReportCard.svelte';
import { finalTurnReport } from './turn-result';

const REPORT = [
	'![Sticky header](.malini/sandbox/screenshots/header.png)',
	'',
	'- The header is `position: sticky`.',
	'- Checked at 320 px and 1440 px.',
	'',
	'Outcome: The header stays pinned while the page scrolls.',
	'Needs: Approve the new shadow; Merge the pull request',
	'Commit: Pin the site header',
	'Pull request: Keep the header in view',
].join('\n');

const unmounts: Array<() => void> = [];

afterEach(() => {
	while (unmounts.length > 0) unmounts.pop()?.();
});

function render(text: string): { host: HTMLElement; opened: string[] } {
	const host = document.createElement('div');
	document.body.append(host);
	const opened: string[] = [];
	const app = mount(TurnReportCard, {
		target: host,
		props: {
			report: parseTurnReport(text),
			imagesrc: () => null,
			onopenimage: (id: string) => opened.push(id),
		},
	});
	flushSync();
	unmounts.push(() => {
		void unmount(app);
		host.remove();
	});
	return { host, opened };
}

function labelledBy(host: HTMLElement, name: string): HTMLElement {
	const match = [...host.querySelectorAll<HTMLElement>('[aria-labelledby]')].find(
		(element) =>
			document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent === name,
	);
	if (!match) throw new Error(`Nothing is named ${name}`);
	return match;
}

describe('the result card at the end of a turn', () => {
	it('leads with the screenshot and the outcome, then what the user must do', () => {
		const { host, opened } = render(REPORT);

		const card = host.querySelector('article[aria-label="Turn result"]');
		expect(card).not.toBeNull();
		const image = host.querySelector<HTMLElement>(
			'[role="button"][aria-label="Open image Sticky header in gallery"]',
		);
		expect(image).not.toBeNull();
		image?.click();
		expect(opened).toEqual(['.malini/sandbox/screenshots/header.png']);

		expect(card?.textContent).toContain('The header stays pinned while the page scrolls.');
		const needs = labelledBy(host, 'Needs you');
		expect([...needs.querySelectorAll('li')].map((need) => need.textContent?.trim())).toEqual([
			'Approve the new shadow',
			'Merge the pull request',
		]);
		expect(card?.textContent).toContain('Pin the site header');
		expect(card?.textContent).toContain('Keep the header in view');
	});

	it('folds the rest of the write-up behind a closed Details disclosure', () => {
		const { host } = render(REPORT);

		const details = host.querySelector('details');
		expect(details?.querySelector('summary')?.textContent?.trim()).toBe('Details');
		expect(details?.open).toBe(false);
		details?.querySelector('summary')?.click();
		expect(details?.open).toBe(true);
		expect(details?.textContent).toContain('Checked at 320 px and 1440 px.');
	});

	it('leaves out the needs block when the agent needs nothing', () => {
		const { host } = render('Outcome: Done.\nNeeds: nothing');

		expect(() => labelledBy(host, 'Needs you')).toThrow();
		expect(host.querySelector('details')).toBeNull();
	});
});

describe('which message becomes the result card', () => {
	const assistant = (key: string, text: string): RenderItem => ({
		kind: 'assistant',
		key,
		seq: 1,
		text,
	});
	const run = (terminal: RunGroup['terminal'], items: RenderItem[]): RunGroup => ({
		runId: 'run-1',
		items,
		terminal,
		terminalText: '',
		superseded: false,
		obsoleted: false,
	});

	it('is only the last answer of a completed run that carries a report', () => {
		const completed = run('completed', [assistant('a1', 'Looking.'), assistant('a2', REPORT)]);

		expect(finalTurnReport(completed, 'a2', REPORT)?.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(finalTurnReport(completed, 'a1', 'Looking.')).toBeNull();
		expect(finalTurnReport(run('failed', [assistant('a2', REPORT)]), 'a2', REPORT)).toBeNull();
		expect(finalTurnReport(run(null, [assistant('a2', REPORT)]), 'a2', REPORT)).toBeNull();
		expect(
			finalTurnReport(run('completed', [assistant('a2', 'Plain prose.')]), 'a2', 'Plain prose.'),
		).toBeNull();
	});
});
