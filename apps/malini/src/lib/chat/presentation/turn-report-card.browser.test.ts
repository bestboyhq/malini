import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTurnReport } from '$lib/chat/domain/turn-report';
import type { RenderItem, RunGroup } from './render-state';
import TurnReportCard from './TurnReportCard.svelte';
import { earlierTurns, finalTurnReport, type EarlierTurn } from './turn-result';

const REPORT = [
	'![Sticky header](.malini/sandbox/screenshots/header.png)',
	'',
	'- Changed: the header is `position: sticky`.',
	'- Verified: checked at 320 px and 1440 px.',
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

function render(
	text: string,
	{ needsOpen = true, history = [] }: { needsOpen?: boolean; history?: EarlierTurn[] } = {},
): { host: HTMLElement; opened: string[] } {
	const host = document.createElement('div');
	document.body.append(host);
	const opened: string[] = [];
	const app = mount(TurnReportCard, {
		target: host,
		props: {
			report: parseTurnReport(text),
			needsOpen,
			history,
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
			document
				.getElementById(element.getAttribute('aria-labelledby') ?? '')
				?.textContent?.trim() === name,
	);
	if (!match) throw new Error(`Nothing is named ${name}`);
	return match;
}

function named(host: ParentNode, selector: string, name: string): HTMLElement | null {
	return host.querySelector<HTMLElement>(`${selector}[aria-label="${name}"]`);
}

function click(element: HTMLElement | null | undefined): void {
	element?.click();
	flushSync();
}

describe('the result card at the end of a turn', () => {
	it('leads with the status and the outcome, then the screenshot and what the user must do', () => {
		const { host, opened } = render(REPORT);

		const card = host.querySelector('article[aria-label="Turn result"]');
		expect(named(host, '[role="img"]', 'Waiting on you')).not.toBeNull();
		expect(host.querySelector('[data-testid="turn-report-outcome"]')?.textContent?.trim()).toBe(
			'The header stays pinned while the page scrolls.',
		);
		click(named(host, '[role="button"]', 'Open image Sticky header in gallery'));
		expect(opened).toEqual(['.malini/sandbox/screenshots/header.png']);

		const needs = labelledBy(host, 'Your turn');
		expect([...needs.querySelectorAll('li')].map((need) => need.textContent?.trim())).toEqual([
			'Approve the new shadow',
			'Merge the pull request',
		]);
		expect(card?.textContent).not.toContain('Pin the site header');
		expect(card?.textContent).not.toContain('Keep the header in view');
	});

	it('peeks at the proof and folds the other notes behind it', () => {
		const { host } = render(REPORT);

		const notes = host.querySelector<HTMLDetailsElement>(
			'details:has([data-testid="turn-report-lead"])',
		);
		const lead = host.querySelector('[data-testid="turn-report-lead"]');
		expect(lead?.textContent).toContain('checked at 320 px and 1440 px.');
		expect(lead?.textContent).toContain('+1');
		expect(notes?.open).toBe(false);

		click(host.querySelector<HTMLElement>('[data-testid="turn-report-lead"]'));
		expect(notes?.open).toBe(true);
		expect(host.querySelector('[data-testid="turn-report-notes"]')?.textContent).toContain(
			'the header is position: sticky.',
		);
	});

	it('leads with a deferral and marks the turn as done with something deferred', () => {
		const { host } = render(
			'- Changed: signed builds update.\n- Deferred: notarization needs the Apple keys.\n\nOutcome: Builds self-update.\nNeeds: nothing',
		);

		expect(named(host, '[role="img"]', 'Done with something deferred')).not.toBeNull();
		expect(host.querySelector('[data-testid="turn-report-lead"]')?.textContent).toContain(
			'notarization needs the Apple keys.',
		);
	});

	it('shows several screenshots as one large image over a row of thumbnails', () => {
		const shots = ['canvas', 'panel', 'zoom', 'clips', 'export'];
		const { host, opened } = render(
			`${shots.map((shot) => `![${shot}](shots/${shot}.png)`).join('\n')}\n\nOutcome: Five surfaces.`,
		);

		const row = named(host, '[role="group"]', 'Report images');
		expect(
			[...(row?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')),
		).toEqual([
			'Show image canvas',
			'Show image panel',
			'Show image zoom',
			'Open image clips and 1 more in gallery',
		]);
		expect(named(host, 'button', 'Show image canvas')?.getAttribute('aria-pressed')).toBe('true');

		click(named(host, 'button', 'Show image zoom'));
		expect(named(host, '[role="button"]', 'Open image zoom in gallery')).not.toBeNull();
		expect(named(host, 'button', 'Show image zoom')?.getAttribute('aria-pressed')).toBe('true');
		expect(named(host, 'button', 'Show image canvas')?.getAttribute('aria-pressed')).toBe('false');

		click(named(host, 'button', 'Open image clips and 1 more in gallery'));
		expect(opened).toEqual(['shots/clips.png']);
	});

	it('shows the diagram that opens the report instead of folding it away', async () => {
		const { host } = render(
			'```\nfails ──▶ rerun ──▶ merge\n```\n\n- Changed: reruns once.\n\nOutcome: Reruns once.',
		);

		const lead = host.querySelector('[data-testid="turn-report-lead"]');
		await expect
			.poll(() => host.querySelector('article')?.textContent)
			.toContain('fails ──▶ rerun ──▶ merge');
		expect(lead?.textContent).not.toContain('fails');
	});

	it('leaves out the needs block and the notes when there are none', () => {
		const { host } = render('Outcome: Done.\nNeeds: nothing');

		expect(() => labelledBy(host, 'Your turn')).toThrow();
		expect(host.querySelector('details')).toBeNull();
		expect(named(host, '[role="img"]', 'Done')).not.toBeNull();
	});

	it('stops asking once the user has moved on or shipped the pull request', () => {
		const { host } = render(REPORT, { needsOpen: false });

		expect(() => labelledBy(host, 'Your turn')).toThrow();
		expect(named(host, '[role="img"]', 'Done')).not.toBeNull();
		expect(
			[...labelledBy(host, 'You were asked').querySelectorAll('li')].map((need) =>
				need.textContent?.trim(),
			),
		).toEqual(['Approve the new shadow', 'Merge the pull request']);
	});

	it('lists the earlier turns above the outcome, each opening onto its notes', () => {
		const earlier = (runId: string, text: string): EarlierTurn => ({
			runId,
			report: parseTurnReport(text),
		});
		const { host } = render(REPORT, {
			history: [
				earlier('run-1', '- Verified: at 2x.\n\nOutcome: The loupe refracts.'),
				earlier('run-2', '- Deferred: GIF export.\n\nOutcome: Clicks ripple.'),
			],
		});

		const list = named(host, 'ol', 'Earlier turns');
		const turns = [...(list?.querySelectorAll('li') ?? [])].filter(
			(li) => li.parentElement === list,
		);
		expect(
			turns.map((turn) => turn.querySelector('summary')?.textContent?.replace(/\s+/gu, ' ').trim()),
		).toEqual(['The loupe refracts. +1', 'Clicks ripple. +1']);
		expect(named(turns[1] ?? host, '[role="img"]', 'Done with something deferred')).not.toBeNull();

		click(turns[1]?.querySelector('summary'));
		expect(turns[1]?.querySelector('details')?.open).toBe(true);
		expect(turns[1]?.textContent).toContain('GIF export.');
	});
});

describe('which message becomes the result card', () => {
	const assistant = (key: string, text: string): RenderItem => ({
		kind: 'assistant',
		key,
		seq: 1,
		text,
	});
	const run = (
		terminal: RunGroup['terminal'],
		items: RenderItem[],
		runId = 'run-1',
		superseded = false,
	): RunGroup => ({
		runId,
		items,
		terminal,
		terminalText: '',
		superseded,
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

	it('lists the last three reported turns before a run as its earlier turns', () => {
		const reported = (runId: string, superseded = false): RunGroup =>
			run('completed', [assistant(`${runId}-a`, `Outcome: ${runId} done.`)], runId, superseded);
		const runs = [
			reported('r1'),
			reported('r2'),
			run('completed', [assistant('r3-a', 'Just an answer.')], 'r3'),
			reported('r4', true),
			reported('r5'),
			reported('r6'),
			reported('r7'),
			reported('r8'),
		];

		expect(earlierTurns(runs, 'r7').map((turn) => turn.runId)).toEqual(['r2', 'r5', 'r6']);
		expect(earlierTurns(runs, 'r1')).toEqual([]);
		expect(earlierTurns(runs, 'missing')).toEqual([]);
	});
});
