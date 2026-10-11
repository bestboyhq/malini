import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import JobsPage from './JobsPage.svelte';

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	setPlatformForTest(createFakePlatform());
	host = document.createElement('div');
	document.body.append(host);
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	host.remove();
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
});

function nameOf(section: Element): string {
	const id = section.getAttribute('aria-labelledby');
	if (id === null) return section.getAttribute('aria-label') ?? '';
	return document.getElementById(id)?.textContent?.trim() ?? '';
}

describe('the Jobs page', () => {
	it('holds the jobs and then the routines, under one Jobs title without repeating it', async () => {
		app = mount(JobsPage, { target: host });
		await vi.waitFor(() => expect(host.textContent).toContain('Fix checks'));
		flushSync();

		expect(host.querySelector('h1')?.textContent?.trim()).toBe('Jobs');
		expect(host.querySelector('a[aria-label="Back to workstreams"]')?.getAttribute('href')).toBe(
			'/',
		);
		const topSections = [...host.querySelectorAll('main section')].filter(
			(section) => section.parentElement?.closest('section') === null,
		);
		expect(topSections.map(nameOf)).toEqual(['Jobs', 'Routines']);
		expect([...host.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())).toEqual(
			expect.arrayContaining(['Your jobs', 'Built-in jobs', 'New job', 'Routines']),
		);
		expect(
			[...host.querySelectorAll('h2')].map((heading) => heading.textContent?.trim()),
		).not.toContain('Jobs');
	});
});
