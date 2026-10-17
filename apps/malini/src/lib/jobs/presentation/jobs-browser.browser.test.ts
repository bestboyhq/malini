import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import { JobsBrowser } from '$lib/jobs/jobs.api';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

type Selection = Readonly<{ selectedJobId: string | null; creating: boolean }>;

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
	host = document.createElement('div');
	document.body.append(host);
	await show({ selectedJobId: null, creating: false });
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

async function show(selection: Selection): Promise<void> {
	if (app) await unmount(app, { outro: false });
	app = mount(JobsBrowser, { target: host, props: selection });
	await vi.waitFor(() => expect(listed('Built in')).toContain('Name chats'));
	flushSync();
}

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

function section(heading: string): HTMLElement {
	const found = [...host.querySelectorAll('section')].find(
		(element) => element.querySelector('h2')?.textContent?.trim() === heading,
	);
	if (!found) throw new Error(`no section headed ${heading}`);
	return found;
}

function listed(heading: string): string[] {
	const found = [...host.querySelectorAll('section')].find(
		(element) => element.querySelector('h2')?.textContent?.trim() === heading,
	);
	return [...(found?.querySelectorAll('a') ?? [])].map(
		(link) => link.querySelector('span span')?.textContent?.trim() ?? '',
	);
}

function current(): string {
	return host.querySelector('a[aria-current="page"] span span')?.textContent?.trim() ?? '';
}

function heading(): string {
	return host.querySelector('article h2')?.textContent?.trim() ?? '';
}

function field<T extends HTMLElement>(label: string, within: ParentNode, kind: new () => T): T {
	const owner = [...within.querySelectorAll('label')].find(
		(element) => element.querySelector('span')?.textContent?.trim() === label,
	);
	const control = owner?.querySelector('input, textarea, select');
	if (!(control instanceof kind)) throw new Error(`no field labelled ${label}`);
	return control;
}

function hasField(label: string): boolean {
	return [...host.querySelectorAll('label')].some(
		(element) => element.querySelector('span')?.textContent?.trim() === label,
	);
}

function form(): HTMLFormElement {
	const found = host.querySelector('form');
	if (!found) throw new Error('the job editor is missing');
	return found;
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

function callsOf(command: CommandName): unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

async function createJob(name: string, options: { runsIn?: string } = {}): Promise<void> {
	await show({ selectedJobId: null, creating: true });
	type(field('Name', form(), HTMLInputElement), name);
	type(field('Instructions', form(), HTMLTextAreaElement), `Do ${name.toLowerCase()} carefully.`);
	if (options.runsIn) choose(field('Runs in', form(), HTMLSelectElement), options.runsIn);
	button('Create job').click();
	await vi.waitFor(() => expect(listed('Yours')).toContain(name));
	await show({ selectedJobId: 'fake-job-1', creating: false });
}

describe('the Jobs browser', () => {
	it('lists the built-in jobs first and opens the first one', () => {
		expect(listed('Built in')).toEqual([
			'Name chats',
			'Fix checks',
			'Update from main',
			'Address bot review',
		]);
		expect(section('Yours').textContent).toContain('Jobs you make show up here.');
		expect(current()).toBe('Name chats');
		expect(heading()).toBe('Name chats');
		expect(host.textContent).toContain(
			'Runs on its own when you send the first message in a chat.',
		);
		expect(hasButton('Run Name chats')).toBe(false);
		expect(hasButton('Reset Name chats')).toBe(true);
		expect(hasButton('Delete Name chats')).toBe(false);
		expect(hasField('Effort')).toBe(false);
	});

	it('runs a built-in job by hand in the workstream the user picks', async () => {
		await show({ selectedJobId: 'fake-job-fix-checks', creating: false });
		expect(hasField('Runs in')).toBe(false);

		button('Run Fix checks').click();
		flushSync();
		const target = host.querySelector('[role="group"][aria-label="Run Fix checks"]');
		if (!target) throw new Error('the run target did not open');
		expect(
			[...field('Workstream', target, HTMLSelectElement).options].map((option) =>
				option.textContent?.trim(),
			),
		).toEqual(['Signal Arc']);
		button('Run job').click();

		await vi.waitFor(() =>
			expect(callsOf('jobs.run')).toEqual([
				{ definitionId: 'fake-job-fix-checks', workstreamId: 'ws-signal', origin: 'manual' },
			]),
		);
	});

	it('creates a job, and refuses one whose name or instructions are blank', async () => {
		await show({ selectedJobId: null, creating: true });
		type(field('Name', form(), HTMLInputElement), '   ');
		type(field('Instructions', form(), HTMLTextAreaElement), 'Tidy the docs.');
		button('Create job').click();
		flushSync();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe('Give the job a name.');
		expect(callsOf('jobs.save-definition')).toEqual([]);

		await createJob('Nightly docs', { runsIn: 'new-workstream' });

		expect(callsOf('jobs.save-definition')).toEqual([
			{
				name: 'Nightly docs',
				instructions: 'Do nightly docs carefully.',
				model: 'opus',
				effort: 'medium',
				runsIn: 'new-workstream',
				output: 'none',
				skillPresetId: null,
			},
		]);
		expect(current()).toBe('Nightly docs');
		expect(section('Yours').textContent).toContain('When you run it, in a new workstream');
	});

	it('saves an edit only once something changed', async () => {
		await createJob('Nightly docs');
		expect(button('Save changes').disabled).toBe(true);

		type(field('Name', form(), HTMLInputElement), 'Weekly docs');
		expect(button('Save changes').disabled).toBe(false);
		button('Save changes').click();

		await vi.waitFor(() => expect(listed('Yours')).toEqual(['Weekly docs']));
		expect(callsOf('jobs.save-definition').at(-1)).toMatchObject({
			id: 'fake-job-1',
			name: 'Weekly docs',
		});
	});

	it('resets a built-in job and deletes your own only after a confirmation', async () => {
		await show({ selectedJobId: 'fake-job-fix-checks', creating: false });
		button('Reset Fix checks').click();
		flushSync();
		expect(callsOf('jobs.reset-definition')).toEqual([]);
		button('Confirm resetting Fix checks').click();
		await vi.waitFor(() =>
			expect(callsOf('jobs.reset-definition')).toEqual([{ definitionId: 'fake-job-fix-checks' }]),
		);

		await createJob('Nightly docs');
		button('Delete Nightly docs').click();
		flushSync();
		button('Keep').click();
		flushSync();
		expect(callsOf('jobs.delete-definition')).toEqual([]);
		button('Delete Nightly docs').click();
		flushSync();
		button('Confirm deleting Nightly docs').click();

		await vi.waitFor(() => expect(listed('Yours')).toEqual([]));
		expect(callsOf('jobs.delete-definition')).toEqual([{ definitionId: 'fake-job-1' }]);
	});

	it('explains a refusal in words, not error codes', async () => {
		await createJob('Nightly docs');
		platform.define('jobs.run', () =>
			Promise.reject({
				name: 'JobError',
				message: 'Workstream `ws-signal` not found.',
				code: null,
				kind: 'not-found',
				command: 'jobs.run',
			}),
		);

		button('Run Nightly docs').click();
		flushSync();
		button('Run job').click();

		await vi.waitFor(() =>
			expect(host.querySelector('article [role="alert"]')?.textContent).toBe(
				'It no longer exists. Reload the Jobs page to see what is left.',
			),
		);
	});
});
