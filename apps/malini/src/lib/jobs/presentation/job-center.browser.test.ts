import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRunRecord } from '$contract/jobs';
import { JobCenter, JobsNavBadge } from '$lib/jobs/jobs.api';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { seedFakeJobRun, updateFakeJobRun } from '$shared/port/fake/jobs.fake';
import { setPlatformForTest } from '$shared/port/platform';
import {
	refreshWorkstreamsCommand,
	workstreamByIdQuery,
} from '$shared/repositories/repositories.api';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';

const VARIANT_KEY = 'malini.jobs.center-variant';

const routes: RouteNode = {
	segment: '',
	children: [
		{ segment: '', page: () => import('$shared/router/fixtures/FixturePage.svelte') },
		{
			segment: 'workstreams',
			children: [
				{
					segment: ':workstreamId',
					page: () => import('$shared/router/fixtures/FixturePage.svelte'),
				},
			],
		},
	],
};

let platform: FakePlatform;
let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(async () => {
	window.history.replaceState(null, '', '#/');
	platform = createFakePlatform({
		projects: [
			{
				id: 'project-hutch',
				name: 'hutch',
				repoPath: '/tmp/base/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
			},
		],
		workstreams: [
			{
				id: 'ws-signal',
				projectId: 'project-hutch',
				name: 'Signal Arc',
				path: '/tmp/worktrees/ws-signal',
				branch: 'malini/ws-signal',
				baseBranch: 'main',
				status: 'active',
			},
		],
	});
	setPlatformForTest(platform);
	host = document.createElement('div');
	document.body.append(host);
	refreshWorkstreamsCommand();
	await vi.waitFor(() => expect(workstreamByIdQuery.data('ws-signal')).not.toBeNull());
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	localStorage.removeItem(VARIANT_KEY);
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	jobActionsStore.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
});

function minutesAgo(minutes: number): string {
	return new Date(Date.now() - minutes * 60_000).toISOString();
}

function jobRun(id: string, patch: Partial<JobRunRecord>): JobRunRecord {
	return {
		id,
		definitionId: 'fake-job-fix-checks',
		title: 'Fix checks',
		workstreamId: 'ws-signal',
		repositoryId: null,
		sessionId: null,
		agentRunId: null,
		origin: 'merge-queue',
		status: 'queued',
		detail: null,
		createdAt: minutesAgo(10),
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function seedMixedRuns(): void {
	seedFakeJobRun(
		platform,
		jobRun('run-running', { status: 'running', sessionId: 'session-7', startedAt: minutesAgo(2) }),
	);
	seedFakeJobRun(platform, jobRun('run-queued', { title: 'Resolve conflicts' }));
	seedFakeJobRun(
		platform,
		jobRun('run-stuck', {
			title: 'Address bot review',
			status: 'needs-you',
			sessionId: 'session-8',
			detail: 'Gave up after 3 attempts on the same failure',
		}),
	);
	seedFakeJobRun(
		platform,
		jobRun('run-done', {
			title: 'Update the changelog',
			status: 'succeeded',
			sessionId: 'session-9',
			finishedAt: minutesAgo(30),
		}),
	);
}

async function mountCenter(variant?: 'pill' | 'docked' | 'stack'): Promise<void> {
	if (variant) localStorage.setItem(VARIANT_KEY, variant);
	app = mount(JobCenter, { target: host });
	await vi.waitFor(() =>
		expect(platform.calls.some(({ command }) => command === 'jobs.list-runs')).toBe(true),
	);
	await settle();
}

async function settle(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
	flushSync();
}

function accessibleName(element: Element): string {
	return (element.getAttribute('aria-label') ?? element.textContent ?? '')
		.replace(/\s+/gu, ' ')
		.trim();
}

function control(name: string | RegExp): HTMLElement | null {
	const candidates = [...document.querySelectorAll<HTMLElement>('button, a[href]')];
	return (
		candidates.find((element) =>
			typeof name === 'string'
				? accessibleName(element) === name
				: name.test(accessibleName(element)),
		) ?? null
	);
}

function requireControl(name: string | RegExp): HTMLElement {
	const element = control(name);
	if (!element) throw new Error(`no control named ${String(name)}`);
	return element;
}

function jobsRegion(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-testid="job-center"]');
}

function inertCards(container: ParentNode): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>('li')].filter((item) => item.inert);
}

function rowTexts(container: ParentNode): string[] {
	return [...container.querySelectorAll('li')].map((item) =>
		(item.textContent ?? '').replace(/\s+/gu, ' ').trim(),
	);
}

describe('the Job center', () => {
	it('stays hidden while there is no job, and appears when one starts', async () => {
		seedFakeJobRun(
			platform,
			jobRun('run-later', { status: 'cancelled', finishedAt: minutesAgo(60 * 30) }),
		);
		await mountCenter();
		expect(jobsRegion()).toBeNull();

		updateFakeJobRun(platform, 'run-later', {
			status: 'running',
			startedAt: minutesAgo(1),
			finishedAt: null,
		});
		await settle();

		expect(jobsRegion()).not.toBeNull();
		expect(requireControl('Jobs: 1 running').getAttribute('aria-expanded')).toBe('false');
	});

	it('as a pill, sums up the jobs and lists them in a popover', async () => {
		seedMixedRuns();
		await mountCenter();

		const pill = requireControl('Jobs: 1 running, 1 queued, 1 needs you');
		expect(pill.textContent).toContain('1 running');
		pill.click();
		flushSync();

		const dialog = document.querySelector('[role="dialog"][aria-label="Jobs"]');
		if (!dialog) throw new Error('the job list did not open');
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		const rows = rowTexts(dialog);
		expect(rows[0]).toContain('Address bot review · Signal Arc');
		expect(rows[0]).toContain('Needs you');
		expect(rows[0]).toContain('Gave up after 3 attempts on the same failure');
		expect(rows[1]).toContain('Fix checks · Signal Arc');
		expect(rows[1]).toContain('Running');
		expect(rows[2]).toContain('Resolve conflicts');
		expect(rows[2]).toContain('Queued');
		expect(rows[3]).toContain('Update the changelog');
		expect(rows[3]).toContain('Done · 30m ago');
	});

	it('docked, lists the jobs in place and folds away', async () => {
		seedMixedRuns();
		await mountCenter('docked');

		const toggle = requireControl('Jobs: 1 running, 1 queued, 1 needs you');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const region = jobsRegion();
		if (!region) throw new Error('the Job center is not on screen');
		expect(rowTexts(region)).toHaveLength(4);

		toggle.click();
		flushSync();

		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(rowTexts(region)).toHaveLength(0);
	});

	it('as a stack, shows the most urgent card and opens up on focus', async () => {
		seedMixedRuns();
		await mountCenter('stack');

		const region = jobsRegion();
		if (!region) throw new Error('the Job center is not on screen');
		const rows = rowTexts(region);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toContain('Address bot review');
		expect(control('Manage jobs')).toBeNull();
		expect(inertCards(region)).toHaveLength(3);

		requireControl(/^Open transcript: Address bot review/u).focus();
		flushSync();

		expect(control('Manage jobs')).not.toBeNull();
		expect(inertCards(region)).toHaveLength(0);
	});

	it('cancels a running job only after the second click', async () => {
		seedMixedRuns();
		await mountCenter('docked');

		requireControl('Cancel Fix checks').click();
		flushSync();
		expect(platform.calls.some(({ command }) => command === 'jobs.cancel-run')).toBe(false);

		const confirm = requireControl('Confirm cancelling Fix checks');
		expect(confirm.textContent?.trim()).toBe('Cancel job');
		confirm.click();
		await vi.waitFor(() =>
			expect(control(/^Open transcript: Fix checks · Signal Arc, Cancelled$/u)).not.toBeNull(),
		);

		expect(platform.calls).toContainEqual({
			command: 'jobs.cancel-run',
			args: { jobRunId: 'run-running' },
		});
		expect(control('Cancel Fix checks')).toBeNull();
	});

	it('offers no cancel once a job has finished or needs you', async () => {
		seedMixedRuns();
		await mountCenter('docked');

		expect(control('Cancel Address bot review')).toBeNull();
		expect(control('Cancel Update the changelog')).toBeNull();
		expect(control('Cancel Resolve conflicts')).not.toBeNull();
	});

	it('opens the transcript of a job that has one', async () => {
		seedMixedRuns();
		router.start({
			routes,
			notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
		});
		await mountCenter('docked');

		requireControl('Open transcript: Fix checks · Signal Arc, Running').click();
		await vi.waitFor(() => expect(router.page.url.pathname).toBe('/workstreams/ws-signal'));

		expect(router.page.url.searchParams.get('agent')).toBe('session-7');
	});

	it('cannot open a job that has not started its chat yet', async () => {
		seedMixedRuns();
		await mountCenter('docked');

		const queued = requireControl(/^Resolve conflicts · Signal Arc, Queued/u);
		expect(queued.tagName).toBe('BUTTON');
		expect(queued.hasAttribute('disabled')).toBe(true);
	});
});

describe('the sidebar Jobs link', () => {
	it('opens the Jobs page and counts the jobs that need you', async () => {
		seedMixedRuns();
		app = mount(JobsNavBadge, { target: host });
		await vi.waitFor(() => expect(host.textContent).toContain('1'));

		const link = requireControl('Jobs');
		expect(link.getAttribute('href')).toBe('/jobs');
		const description = document.getElementById(link.getAttribute('aria-describedby') ?? '');
		expect(description?.textContent).toBe('1 job needs you');

		updateFakeJobRun(platform, 'run-stuck', { status: 'failed', finishedAt: minutesAgo(0) });
		await settle();

		expect(link.hasAttribute('aria-describedby')).toBe(false);
	});
});
