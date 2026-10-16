import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import JobsPage from './JobsPage.svelte';

const fixture = () => import('$shared/router/fixtures/FixturePage.svelte');

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: 'jobs',
			page: fixture,
			children: [
				{ segment: 'new', page: fixture },
				{ segment: 'routines', page: fixture },
				{ segment: ':jobId', page: fixture },
			],
		},
	],
};

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;
let stopRouter: (() => void) | null = null;

beforeEach(async () => {
	setPlatformForTest(createFakePlatform());
	window.history.replaceState(null, '', '#/jobs');
	stopRouter = router.start({ routes, notFound: fixture });
	await settle();
	host = document.createElement('div');
	document.body.append(host);
	app = mount(JobsPage, { target: host });
	await vi.waitFor(() => expect(host.textContent).toContain('Fix checks'));
	flushSync();
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	host.remove();
	stopRouter?.();
	stopRouter = null;
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
});

async function settle(): Promise<void> {
	for (let attempt = 0; attempt < 50 && router.navigating; attempt += 1) {
		await router.navigating.complete;
	}
	flushSync();
}

async function visit(path: string): Promise<void> {
	await goto(path);
	await settle();
}

function tab(name: string): HTMLAnchorElement {
	const found = [
		...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Jobs and routines"] a'),
	].find((link) => link.textContent?.trim() === name);
	if (!found) throw new Error(`no tab named ${name}`);
	return found;
}

describe('the Jobs page', () => {
	it('keeps jobs and routines under one Jobs title, one tab each', async () => {
		expect(host.querySelector('h1')?.textContent?.trim()).toBe('Jobs');
		expect(tab('Jobs').getAttribute('aria-current')).toBe('page');
		expect(tab('Routines').getAttribute('aria-current')).toBeNull();
		expect(host.querySelector('nav[aria-label="Jobs"]')).not.toBeNull();

		await visit('/jobs/routines');

		expect(tab('Routines').getAttribute('aria-current')).toBe('page');
		expect(host.querySelector('nav[aria-label="Jobs"]')).toBeNull();
		expect(host.querySelector('h1')?.textContent?.trim()).toBe('Jobs');
		expect(host.textContent).toContain('Routines');
	});

	it('opens the job its address names, and the new job editor', async () => {
		await visit('/jobs/fake-job-update-from-main');
		expect(host.querySelector('article h2')?.textContent?.trim()).toBe('Update from main');
		expect(
			host.querySelector('a[aria-current="page"][href="/jobs/fake-job-update-from-main"]'),
		).not.toBeNull();

		await visit('/jobs/new');
		expect(host.querySelector('article h2')?.textContent?.trim()).toBe('New job');
		expect(host.querySelector('a[aria-current="page"][href="/jobs/new"]')).not.toBeNull();
	});
});
