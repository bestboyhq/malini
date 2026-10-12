import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import { JobsSection } from '$lib/jobs/jobs.api';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

let platform: FakePlatform;
let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(async () => {
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
	Element.prototype.scrollIntoView = vi.fn<Element['scrollIntoView']>();
	host = document.createElement('div');
	document.body.append(host);
	app = mount(JobsSection, { target: host });
	await vi.waitFor(() => expect(host.textContent).toContain('Fix checks'));
	await vi.waitFor(() => expect(workstreamsAggregate.loaded).toBe(true));
	flushSync();
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	host.remove();
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	jobActionsStore.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
});

function accessibleName(element: Element): string {
	return (element.getAttribute('aria-label') ?? element.textContent ?? '')
		.replace(/\s+/gu, ' ')
		.trim();
}

function button(name: string): HTMLButtonElement {
	const found = [...host.querySelectorAll('button')].find(
		(element) => accessibleName(element) === name,
	);
	if (!found) throw new Error(`no button named ${name}`);
	return found;
}

function hasButton(name: string): boolean {
	return [...host.querySelectorAll('button')].some((element) => accessibleName(element) === name);
}

function field<T extends HTMLElement>(label: string, within: ParentNode, kind: new () => T): T {
	const owner = [...within.querySelectorAll('label')].find(
		(element) => element.querySelector('span')?.textContent?.trim() === label,
	);
	const control = owner?.querySelector('input, textarea, select');
	if (!(control instanceof kind)) throw new Error(`no field labelled ${label}`);
	return control;
}

function type(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	control.value = value;
	control.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function choose(control: HTMLSelectElement, value: string): void {
	control.value = value;
	control.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

function list(name: string): HTMLElement {
	const found = host.querySelector<HTMLElement>(`ul[aria-label="${name}"]`);
	if (!found) throw new Error(`no list named ${name}`);
	return found;
}

function rowNames(name: string): string[] {
	return [...list(name).querySelectorAll('li')].map(
		(item) => item.querySelector('span')?.textContent?.trim() ?? '',
	);
}

function form(): HTMLFormElement {
	const found = host.querySelector('form');
	if (!found) throw new Error('the job form is missing');
	return found;
}

function callsOf(command: CommandName): unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

async function createJob(
	name: string,
	options: { runsIn?: string; output?: string } = {},
): Promise<void> {
	type(field('Name', form(), HTMLInputElement), name);
	type(field('Instructions', form(), HTMLTextAreaElement), `Do ${name.toLowerCase()} carefully.`);
	if (options.runsIn) choose(field('Runs in', form(), HTMLSelectElement), options.runsIn);
	if (options.output) choose(field('When it finishes', form(), HTMLSelectElement), options.output);
	button('Create job').click();
	await vi.waitFor(() =>
		expect(host.querySelector('ul[aria-label="Your jobs"]')?.textContent).toContain(name),
	);
	flushSync();
}

describe('the Jobs section', () => {
	it('lists the built-in jobs with Reset and without Delete or Run', () => {
		expect(rowNames('Built-in jobs')).toEqual([
			'Fix checks',
			'Resolve conflicts',
			'Address bot review',
		]);
		expect(list('Built-in jobs').textContent).toContain('Built-in');
		expect(hasButton('Reset Fix checks')).toBe(true);
		expect(hasButton('Delete Fix checks')).toBe(false);
		expect(hasButton('Run Fix checks')).toBe(false);
		expect(host.textContent).toContain('No jobs of your own yet.');
	});

	it('creates a job from the builder and clears the form', async () => {
		await createJob('Nightly docs', { runsIn: 'new-workstream', output: 'draft' });

		expect(callsOf('jobs.save-definition')).toEqual([
			{
				name: 'Nightly docs',
				instructions: 'Do nightly docs carefully.',
				model: 'default',
				effort: 'medium',
				runsIn: 'new-workstream',
				output: 'draft',
			},
		]);
		expect(list('Your jobs').textContent).toContain('runs in a new workstream, opens a draft PR');
		expect(field('Name', form(), HTMLInputElement).value).toBe('');
	});

	it('refuses a job whose name or instructions are blank', () => {
		button('Create job').click();
		flushSync();
		expect(callsOf('jobs.save-definition')).toEqual([]);

		type(field('Name', form(), HTMLInputElement), '   ');
		type(field('Instructions', form(), HTMLTextAreaElement), 'Tidy the docs.');
		button('Create job').click();
		flushSync();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe('Give the job a name.');

		type(field('Name', form(), HTMLInputElement), 'Tidy docs');
		type(field('Instructions', form(), HTMLTextAreaElement), '  ');
		button('Create job').click();
		flushSync();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			'Tell the agent what the job does.',
		);
		expect(callsOf('jobs.save-definition')).toEqual([]);
	});

	it('edits a job in the builder', async () => {
		await createJob('Nightly docs');

		button('Edit Nightly docs').click();
		flushSync();
		expect(host.querySelector('#job-form-heading')?.textContent?.trim()).toBe('Edit Nightly docs');
		const name = field('Name', form(), HTMLInputElement);
		expect(name.value).toBe('Nightly docs');
		type(name, 'Weekly docs');
		button('Save changes').click();

		await vi.waitFor(() => expect(rowNames('Your jobs')).toEqual(['Weekly docs']));
		expect(callsOf('jobs.save-definition').at(-1)).toMatchObject({
			id: 'fake-job-1',
			name: 'Weekly docs',
		});
		expect(host.querySelector('#job-form-heading')?.textContent?.trim()).toBe('New job');
	});

	it('locks where a built-in job runs and what it ships', () => {
		button('Edit Fix checks').click();
		flushSync();

		expect(field('Runs in', form(), HTMLSelectElement).disabled).toBe(true);
		expect(field('When it finishes', form(), HTMLSelectElement).disabled).toBe(true);
		expect(field('Name', form(), HTMLInputElement).disabled).toBe(false);
	});

	it('resets an edited built-in job after a confirmation', async () => {
		button('Edit Fix checks').click();
		flushSync();
		type(field('Name', form(), HTMLInputElement), 'Fix the CI');
		button('Save changes').click();
		await vi.waitFor(() => expect(rowNames('Built-in jobs')[0]).toBe('Fix the CI'));

		button('Reset Fix the CI').click();
		flushSync();
		expect(callsOf('jobs.reset-definition')).toEqual([]);
		button('Confirm resetting Fix the CI').click();

		await vi.waitFor(() => expect(rowNames('Built-in jobs')[0]).toBe('Fix checks'));
		expect(callsOf('jobs.reset-definition')).toEqual([{ definitionId: 'fake-job-fix-checks' }]);
	});

	it('deletes a job only once the deletion is confirmed', async () => {
		await createJob('Nightly docs');

		button('Delete Nightly docs').click();
		flushSync();
		button('Keep').click();
		flushSync();
		expect(rowNames('Your jobs')).toEqual(['Nightly docs']);

		button('Delete Nightly docs').click();
		flushSync();
		button('Confirm deleting Nightly docs').click();

		await vi.waitFor(() => expect(host.querySelector('ul[aria-label="Your jobs"]')).toBeNull());
		expect(callsOf('jobs.delete-definition')).toEqual([{ definitionId: 'fake-job-1' }]);
	});

	it('runs a workstream job in the workstream the user picks', async () => {
		await createJob('Nightly docs');

		button('Run Nightly docs').click();
		flushSync();
		const target = host.querySelector('[role="group"][aria-label="Run Nightly docs"]');
		if (!target) throw new Error('the run target did not open');
		const workstream = field('Workstream', target, HTMLSelectElement);
		expect([...workstream.options].map((option) => option.textContent?.trim())).toEqual([
			'Signal Arc',
		]);
		button('Run job').click();

		await vi.waitFor(() => expect(callsOf('jobs.run')).toHaveLength(1));
		expect(callsOf('jobs.run')).toEqual([
			{ definitionId: 'fake-job-1', workstreamId: 'ws-signal', origin: 'manual' },
		]);
		expect(host.querySelector('[role="group"][aria-label="Run Nightly docs"]')).toBeNull();
	});

	it('runs a new-workstream job in the repository the user picks', async () => {
		await createJob('Nightly docs', { runsIn: 'new-workstream' });

		button('Run Nightly docs').click();
		flushSync();
		const target = host.querySelector('[role="group"][aria-label="Run Nightly docs"]');
		if (!target) throw new Error('the run target did not open');
		const repository = field('Repository', target, HTMLSelectElement);
		expect(repository.value).toBe('local:project-hutch');
		expect([...repository.options].map((option) => option.textContent?.trim())).toEqual([
			'rabbits/hutch',
		]);
		button('Run job').click();

		await vi.waitFor(() =>
			expect(callsOf('jobs.run')).toEqual([
				{ definitionId: 'fake-job-1', repositoryId: 'local:project-hutch', origin: 'manual' },
			]),
		);
	});

	it('explains a refusal in words, not error codes', async () => {
		await createJob('Nightly docs');
		platform.define('jobs.delete-definition', () =>
			Promise.reject({
				name: 'JobError',
				message: 'Nightly docs is queued or running. Cancel it first.',
				code: null,
				kind: 'busy',
				command: 'jobs.delete-definition',
			}),
		);
		platform.define('jobs.run', () =>
			Promise.reject({
				name: 'JobError',
				message: 'Workstream `ws-signal` not found.',
				code: null,
				kind: 'not-found',
				command: 'jobs.run',
			}),
		);

		button('Delete Nightly docs').click();
		flushSync();
		button('Confirm deleting Nightly docs').click();
		await vi.waitFor(() =>
			expect(list('Your jobs').querySelector('[role="alert"]')?.textContent).toBe(
				'Nightly docs is queued or running. Cancel it first.',
			),
		);

		button('Run Nightly docs').click();
		flushSync();
		button('Run job').click();
		await vi.waitFor(() =>
			expect(list('Your jobs').querySelector('[role="alert"]')?.textContent).toBe(
				'It no longer exists. Reload the Jobs page to see what is left.',
			),
		);
	});
});
