import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticEntry } from '$contract/diagnostics';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import RuntimePage from './RuntimePage.svelte';

let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
	setPlatformForTest(null);
});

function entry(overrides: Partial<DiagnosticEntry>): DiagnosticEntry {
	return {
		occurredAt: '2026-09-23T08:00:00.000Z',
		process: 'main',
		level: 'error',
		source: 'console',
		message: '',
		detail: null,
		errorName: null,
		code: null,
		command: null,
		durationMs: null,
		suppressedRepeats: 0,
		workstreamId: null,
		viewing: null,
		route: null,
		...overrides,
	};
}

function render(platform: FakePlatform): HTMLElement {
	setPlatformForTest(platform);
	const host = document.createElement('div');
	document.body.append(host);
	const page = mount(RuntimePage, { target: host });
	flushSync();
	stop = () => {
		void unmount(page);
		host.remove();
	};
	return host;
}

function rows(host: HTMLElement): string[] {
	return [...host.querySelectorAll('[data-testid="recent-diagnostic"]')].map(
		(row) => row.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
	);
}

describe('the runtime page in a development build', () => {
	it('lists the latest errors, warnings and toasts, newest first, with the real message', async () => {
		const platform = createFakePlatform();
		const limits: number[] = [];
		platform.define('app.recent-diagnostics', (args) => {
			limits.push(args.limit);
			return [
				entry({
					occurredAt: '2026-09-23T08:00:02.000Z',
					process: 'renderer',
					source: 'toast',
					message:
						'Could not archive Neon Circuit · Its checkout could not be moved aside (permission denied), so nothing was removed.',
					workstreamId: 'ws-9',
					viewing: 'ws-4',
					route: '/workstreams/ws-4',
				}),
				entry({
					occurredAt: '2026-09-23T08:00:01.000Z',
					source: 'ipc-command',
					command: 'repositories.archive-workstream',
					errorName: 'WorkstreamRemovalError',
					code: 'EACCES',
					message:
						'Its checkout could not be moved aside (permission denied), so nothing was removed',
					workstreamId: 'ws-9',
				}),
				entry({ level: 'warn', message: 'malini: base sync skipped' }),
			];
		});

		const host = render(platform);

		await expect.poll(() => rows(host).length).toBe(3);
		const [toastRow, commandRow, warningRow] = rows(host);
		expect(toastRow).toContain(
			'renderer toast workstream ws-9 viewing ws-4 Could not archive Neon Circuit · Its checkout could not be moved aside (permission denied), so nothing was removed.',
		);
		expect(commandRow).toContain(
			'ipc-command repositories.archive-workstream workstream ws-9 WorkstreamRemovalError [EACCES]: Its checkout could not be moved aside',
		);
		expect(commandRow).not.toContain('viewing');
		expect(warningRow).toContain('warn');
		expect(warningRow).toContain('malini: base sync skipped');
		expect(limits).toEqual([50]);
		expect(host.querySelector('section[aria-labelledby]')?.textContent).toContain(
			'Errors, warnings and toasts',
		);
	});

	it('refreshes on demand and says so when nothing was recorded', async () => {
		const platform = createFakePlatform();
		let answers: DiagnosticEntry[][] = [[], [entry({ message: 'a fresh failure' })]];
		platform.define('app.recent-diagnostics', () => {
			const [next, ...rest] = answers;
			answers = rest;
			return next ?? [];
		});

		const host = render(platform);
		await expect
			.poll(() => host.textContent)
			.toContain('No errors, warnings or toasts recorded yet.');

		const refresh = [...host.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Refresh',
		);
		refresh?.click();

		await expect.poll(() => rows(host)).toEqual([expect.stringContaining('a fresh failure')]);
	});

	it('shows the cause under a failure and how many identical ones were not logged', async () => {
		const platform = createFakePlatform();
		platform.define('app.recent-diagnostics', () => [
			entry({
				source: 'ipc-command',
				command: 'pull-requests.status',
				level: 'warn',
				errorName: 'GhError',
				code: 'auth-required',
				message: 'not logged in to github.com',
				detail: 'caused by Error: gh exited with code 4\n  run gh auth login',
				suppressedRepeats: 11,
				workstreamId: 'ws-9',
			}),
		]);

		const host = render(platform);

		await expect.poll(() => rows(host).length).toBe(1);
		expect(rows(host)[0]).toContain('+11 identical not logged before this');
		expect(
			host.querySelector('[data-testid="recent-diagnostic-detail"]')?.textContent?.trim(),
		).toBe('caused by Error: gh exited with code 4\n  run gh auth login');
	});

	it('shows why the diagnostics could not be read', async () => {
		const platform = createFakePlatform();
		platform.define('app.recent-diagnostics', () => {
			throw new Error('diagnostics log is not a file');
		});

		const host = render(platform);

		await expect
			.poll(() => host.querySelector('[role="alert"]')?.textContent?.trim())
			.toBe('diagnostics log is not a file');
	});
});
