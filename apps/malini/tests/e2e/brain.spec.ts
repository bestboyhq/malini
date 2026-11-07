import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type {
	BrainCapture,
	BrainDocument,
	BrainEntry,
	BrainStatus,
} from '../../src/contract/brain';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	listSessions,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';
import { brainOnGithub, FAKE_BRAIN } from './fake-brain';

const SECRET = 'correct-horse-battery-staple';
const TOKEN = `ghp_${'a1B2'.repeat(9)}`;
const TODAY = localDay(new Date());
const LOG = `log/${TODAY}.md`;

type AutomationRow = Readonly<{
	id: string;
	builtin: string | null;
	trigger: Readonly<{ when: string; mode: string }> | null;
}>;

type RunRow = Readonly<{ id: string; status: string; workstreamId: string | null }>;

function localDay(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function typeAFinishedTurn(page: Page, workstreamId: string, prompt: string): Promise<void> {
	await openWorkstream(page, workstreamId);
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	await expect
		.poll(async () => (await listSessions(page, workstreamId)).map(({ status }) => status), {
			timeout: 20_000,
		})
		.not.toContain('running');
}

async function builtin(page: Page, name: string): Promise<AutomationRow> {
	const definitions = await invoke<AutomationRow[]>(
		page,
		'automations.list-definitions',
		undefined,
	);
	const definition = definitions.find((candidate) => candidate.builtin === name);
	if (!definition) throw new Error(`the built-in ${name} automation is missing`);
	return definition;
}

test('an archived chat lands redacted in the brain on GitHub, a deleted one never does, and the notes run only in the brain', async () => {
	test.setTimeout(300_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const github = await brainOnGithub(app, 'missing');
		await invoke(page, 'secrets.save', { values: { DEPLOY_PHRASE: SECRET }, repository: null });

		const status = await invoke<BrainStatus>(page, 'brain.set-up', { sync: true });
		expect(status).toMatchObject({ set: true, repository: FAKE_BRAIN, sync: true, problem: null });
		expect(status.workstreamId).toBeTruthy();
		expect((await builtin(page, 'capture-brain')).trigger?.mode).toBe('auto');
		expect((await builtin(page, 'write-brain-notes')).trigger?.mode).toBe('auto');

		const source = await createSourceRepo(app.root, 'web');
		const kept = await seedWorkstream(page, source, 'e2e-brain-kept', 'Deploy rotation');
		await typeAFinishedTurn(
			page,
			kept.workstreamId,
			`Deploy with ${SECRET} and ${TOKEN} TURN_OUTCOME="The deploy runs on Fridays"`,
		);
		await invoke(page, 'repositories.archive-workstream', { workstreamId: kept.workstreamId });

		await expect
			.poll(() => github.mainLog(LOG), { timeout: 60_000 })
			.toContain('Outcome: The deploy runs on Fridays');
		const log = github.mainLog(LOG);
		expect(log.startsWith(`# ${TODAY}\n\n## `)).toBe(true);
		expect(log).toContain('> Deploy with [secret] and [redacted-token]');
		expect(log).not.toContain(SECRET);
		expect(log).not.toContain('ghp_');
		expect(log).not.toContain('Hello from the fake bridge');
		expect(log).not.toContain('Needs:');
		expect(github.mainSubjects()[0]).toBe('Capture 1 chat');
		await expect
			.poll(async () => invoke<BrainStatus>(page, 'brain.status', undefined))
			.toMatchObject({ unpushed: 0, problem: null, syncedAt: expect.any(String) });

		const thrown = await seedWorkstream(page, source, 'e2e-brain-thrown', 'Throwaway plan');
		await typeAFinishedTurn(page, thrown.workstreamId, 'Never keep this plan TURN_OUTCOME="Gone"');
		await invoke(page, 'repositories.delete-workstream', { workstreamId: thrown.workstreamId });
		expect(await invoke<BrainCapture>(page, 'brain.capture', undefined)).toEqual({
			chats: 0,
			turns: 0,
			landed: false,
		});
		expect(github.mainLog(LOG)).toBe(log);
		expect(github.mainSubjects()).toHaveLength(2);

		const entries = await invoke<BrainEntry[]>(page, 'brain.list', undefined);
		expect(entries.map(({ path, kind }) => ({ path, kind }))).toEqual([{ path: LOG, kind: 'log' }]);
		const day = await invoke<BrainDocument>(page, 'brain.read', { path: LOG });
		expect(day.text).toBe(log);

		const elsewhere = await seedWorkstream(page, source, 'e2e-brain-elsewhere', 'Elsewhere');
		const notes = await invoke<RunRow>(page, 'automations.run', {
			definitionId: (await builtin(page, 'write-brain-notes')).id,
			workstreamId: elsewhere.workstreamId,
		});
		expect(notes.workstreamId).toBe(status.workstreamId);
		await expect
			.poll(
				async () =>
					(await invoke<RunRow[]>(page, 'automations.list-runs', undefined)).find(
						({ id }) => id === notes.id,
					)?.status,
				{ timeout: 60_000 },
			)
			.toBe('succeeded');
		expect(github.mainSubjects()).toHaveLength(2);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a public brain repository on GitHub is refused', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/e2e-user\/brain is public/u] });
	try {
		const { page } = app;
		await brainOnGithub(app, 'public');
		await expect(invoke(page, 'brain.set-up', { sync: true })).rejects.toThrow(
			'e2e-user/brain is public. Malini keeps a brain only in a private repository.',
		);
		expect(await invoke<BrainStatus>(page, 'brain.status', undefined)).toMatchObject({
			set: false,
			workstreamId: null,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('without GitHub the brain stays on this Mac and still captures an archived chat', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini({
		env: { E2E_GITHUB_SIGNED_OUT: '1' },
		allowedDiagnostics: [/no GitHub repository to sync with/u],
	});
	try {
		const { page } = app;
		const status = await invoke<BrainStatus>(page, 'brain.set-up', { sync: true });
		expect(status).toMatchObject({ set: true, repository: null, sync: false, problem: null });
		await expect(invoke(page, 'brain.set-sync', { sync: true })).rejects.toThrow(
			'This brain lives on this Mac only. It has no GitHub repository to sync with.',
		);

		const source = await createSourceRepo(app.root, 'web');
		const kept = await seedWorkstream(page, source, 'e2e-brain-local', 'Local notes');
		await typeAFinishedTurn(page, kept.workstreamId, 'Plan the week TURN_OUTCOME="Planned"');
		await invoke(page, 'repositories.archive-workstream', { workstreamId: kept.workstreamId });

		const location = status.location ?? '';
		await expect
			.poll(
				() => (existsSync(join(location, LOG)) ? readFileSync(join(location, LOG), 'utf8') : ''),
				{
					timeout: 60_000,
				},
			)
			.toContain('> Plan the week TURN_OUTCOME="Planned"\n\nOutcome: Planned');
		await expect
			.poll(async () => (await invoke<BrainStatus>(page, 'brain.status', undefined)).unpushed)
			.toBe(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
