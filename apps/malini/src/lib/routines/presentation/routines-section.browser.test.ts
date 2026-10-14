import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRecord } from '$contract/routines';
import { clearRoutineFormSeedCommand } from '$lib/routines/application/commands/clear-routine-form-seed.command';
import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import RoutinesSection from './RoutinesSection.svelte';

let fake: FakePlatform;
let host: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	fake = createFakePlatform();
	setPlatformForTest(fake);
});

afterEach(() => {
	if (app) void unmount(app);
	app = null;
	host.remove();
	clearRoutineFormSeedCommand();
	setPlatformForTest(null);
});

async function renderSection(): Promise<void> {
	host = document.createElement('div');
	document.body.append(host);
	app = mount(RoutinesSection, { target: host });
	flushSync();
	await vi.waitFor(() =>
		expect(fake.calls.map(({ command }) => command)).toContain('jobs.list-definitions'),
	);
	await vi.waitFor(() => expect(labelled<HTMLSelectElement>('Job for step 1').length).toBe(4));
}

function text(node: Element): string {
	return (node.textContent ?? '').replaceAll(/\s+/gu, ' ').trim();
}

function element<T extends Element>(selector: string, within: ParentNode = host): T {
	const found = within.querySelector<T>(selector);
	if (!found) throw new Error(`${selector} is not on screen`);
	return found;
}

function labelled<T extends Element>(name: string, within: ParentNode = host): T {
	return element<T>(`[aria-label="${name}"]`, within);
}

function choose(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function click(button: Element): void {
	button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

function submit(form: HTMLFormElement): void {
	form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
	flushSync();
}

function argsOf(command: string): unknown[] {
	return fake.calls.filter((call) => call.command === command).map(({ args }) => args);
}

function rowSteps(label: string): string[] {
	const list = labelled<HTMLOListElement>(`Steps of ${label}`);
	return [...list.querySelectorAll('li')].map(text);
}

function seedRoutine(): Promise<RoutineRecord> {
	return fake.invoke('routines.create-draft', {
		label: 'Fix then rebase',
		when: 'when I run it',
		steps: [{ job: 'fake-job-fix-checks' }, { job: 'fake-job-update-from-main' }],
	});
}

describe('the routine steps editor', () => {
	it('creates a draft whose ordered steps mix jobs and extension commands', async () => {
		await renderSection();
		const form = labelled<HTMLFormElement>('New routine');
		type(element('[data-testid="routine-form-label"]', form), 'Fix, refresh, rebase');
		choose(labelled('Job for step 1', form), 'fake-job-fix-checks');

		click(element('[data-testid="routine-step-add"]', form));
		choose(labelled('Kind of step 2', form), 'command');
		type(labelled('Command for step 2', form), 'malini.repository.refresh');

		click(element('[data-testid="routine-step-add"]', form));
		choose(labelled('Job for step 3', form), 'fake-job-update-from-main');
		click(labelled('Move step 3 up', form));
		click(labelled('Move step 1 down', form));

		submit(form);

		await vi.waitFor(() => expect(argsOf('routines.create-draft')).toHaveLength(1));
		expect(argsOf('routines.create-draft')[0]).toEqual({
			label: 'Fix, refresh, rebase',
			when: 'when I run it',
			steps: [
				{ job: 'fake-job-update-from-main' },
				{ job: 'fake-job-fix-checks' },
				{ command: 'malini.repository.refresh', args: [] },
			],
		});
		await vi.waitFor(() =>
			expect(rowSteps('Fix, refresh, rebase')).toEqual([
				'1. Job · Update from main',
				'2. Job · Fix checks',
				'3. Extension command · malini.repository.refresh',
			]),
		);
		expect(
			element<HTMLInputElement>('[data-testid="routine-form-label"]', labelled('New routine'))
				.value,
		).toBe('');
	});

	it('removes a step and refuses to save a job step without a job', async () => {
		await renderSection();
		const form = labelled<HTMLFormElement>('New routine');
		type(element('[data-testid="routine-form-label"]', form), 'Half finished');
		expect(labelled<HTMLButtonElement>('Remove step 1', form).disabled).toBe(true);
		click(element('[data-testid="routine-step-add"]', form));
		choose(labelled('Job for step 2', form), 'fake-job-fix-checks');
		click(labelled('Remove step 1', form));
		expect(form.querySelectorAll('[data-testid="routine-step"]')).toHaveLength(1);
		expect(labelled<HTMLSelectElement>('Job for step 1', form).value).toBe('fake-job-fix-checks');

		click(element('[data-testid="routine-step-add"]', form));
		submit(form);

		expect(element('[data-testid="routine-form-error"]', form).textContent).toContain(
			'Step 2: choose the job to run.',
		);
		expect(argsOf('routines.create-draft')).toEqual([]);
	});

	it('edits a routine in place and saves the reordered steps', async () => {
		await seedRoutine();
		await renderSection();
		await vi.waitFor(() =>
			expect(rowSteps('Fix then rebase')).toEqual([
				'1. Job · Fix checks',
				'2. Job · Update from main',
			]),
		);

		click(labelled('Edit Fix then rebase'));
		const form = labelled<HTMLFormElement>('Editing Fix then rebase');
		click(labelled('Move step 2 up', form));
		submit(form);

		await vi.waitFor(() => expect(argsOf('routines.update')).toHaveLength(1));
		expect(argsOf('routines.update')[0]).toMatchObject({
			label: 'Fix then rebase',
			when: 'when I run it',
			steps: [{ job: 'fake-job-update-from-main' }, { job: 'fake-job-fix-checks' }],
		});
		await vi.waitFor(() =>
			expect(host.querySelector('[aria-label="Editing Fix then rebase"]')).toBeNull(),
		);
		expect(rowSteps('Fix then rebase')).toEqual([
			'1. Job · Update from main',
			'2. Job · Fix checks',
		]);
	});

	it('turns a suggestion into a new agent job and a prefilled draft', async () => {
		fake.define('routines.list-suggestions', async () => [
			{
				id: 'suggestion-1',
				clusterKey: 'dependencies tests update',
				status: 'open',
				evidence: [
					{ kind: 'prompt', text: 'Update the dependencies and run the tests' },
					{ kind: 'prompt', text: 'update the dependencies and run the tests' },
				],
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);
		await renderSection();
		await vi.waitFor(() => labelled('Accept this suggestion as a draft routine'));
		click(labelled('Accept this suggestion as a draft routine'));

		await vi.waitFor(() => expect(argsOf('jobs.save-definition')).toHaveLength(1));
		expect(argsOf('jobs.save-definition')[0]).toEqual({
			name: 'Update the dependencies and run the tests',
			instructions: 'Update the dependencies and run the tests',
			model: 'default',
			effort: 'medium',
			runsIn: 'workstream',
			output: 'none',
		});
		await vi.waitFor(() =>
			expect(text(element('[data-testid="routine-draft-suggestion-chip"]'))).toContain(
				'keeps its 2 prompts as evidence',
			),
		);
		const form = labelled<HTMLFormElement>('New routine');
		expect(element<HTMLInputElement>('[data-testid="routine-form-label"]', form).value).toBe(
			'Update the dependencies and run the tests',
		);
		const jobId = labelled<HTMLSelectElement>('Job for step 1', form).value;
		expect(jobId).toMatch(/^fake-job-\d+$/u);

		submit(form);
		await vi.waitFor(() => expect(argsOf('routines.create-draft')).toHaveLength(1));
		expect(argsOf('routines.create-draft')[0]).toEqual({
			label: 'Update the dependencies and run the tests',
			when: 'when I run it',
			steps: [{ job: jobId }],
			origin: 'suggested',
			suggestionId: 'suggestion-1',
		});
	});

	it('deletes the job a suggestion made when the user stops accepting it', async () => {
		fake.define('routines.list-suggestions', async () => [
			{
				id: 'suggestion-1',
				clusterKey: 'dependencies tests update',
				status: 'open',
				evidence: [
					{ kind: 'prompt', text: 'Update the dependencies and run the tests' },
					{ kind: 'prompt', text: 'update the dependencies and run the tests' },
				],
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);
		await renderSection();
		await vi.waitFor(() => labelled('Accept this suggestion as a draft routine'));
		click(labelled('Accept this suggestion as a draft routine'));
		await vi.waitFor(() => element('[data-testid="routine-draft-suggestion-clear"]'));
		const jobId = labelled<HTMLSelectElement>('Job for step 1').value;

		click(element('[data-testid="routine-draft-suggestion-clear"]'));

		await vi.waitFor(() =>
			expect(argsOf('jobs.delete-definition')).toEqual([{ definitionId: jobId }]),
		);
		expect(argsOf('routines.create-draft')).toEqual([]);
	});
});

describe('run now', () => {
	it('runs a routine in the chosen workstream and shows why it failed', async () => {
		let finish: (error?: Error) => void = () => {};
		const runner = vi.fn(
			() =>
				new Promise<void>((resolve, reject) => {
					finish = (error) => (error ? reject(error) : resolve());
				}),
		);
		const disconnect = automationRulesStore.connectRunner(runner);
		const routine = await seedRoutine();
		await renderSection();
		await vi.waitFor(() =>
			expect(
				labelled<HTMLSelectElement>('Workstream to run Fix then rebase in').options.length,
			).toBeGreaterThan(1),
		);

		choose(labelled('Workstream to run Fix then rebase in'), 'fake-workstream-files');
		click(labelled('Run Fix then rebase now'));
		expect(runner).toHaveBeenCalledWith(
			expect.objectContaining({ id: routine.id, steps: routine.steps }),
			'fake-workstream-files',
		);
		expect(labelled<HTMLButtonElement>('Run Fix then rebase now').getAttribute('aria-busy')).toBe(
			'true',
		);

		finish(new Error('Job “Fix checks” failed: the tests are still red'));
		await vi.waitFor(() =>
			expect(element('[data-testid="routine-run-error"]').textContent).toContain(
				'Job “Fix checks” failed: the tests are still red',
			),
		);
		disconnect();
	});
});
