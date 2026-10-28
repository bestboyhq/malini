import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { JobRunRecord } from '../../src/contract/jobs';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openJobs,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const LEAD = 'Move apps to Logdash';
const CHILD = 'Api analytics';
const WAKE = `Wake “${LEAD}” with this report`;
const CHILD_PROMPT = `TITLE="${CHILD}" TURN_OUTCOME="The analytics endpoint answers" TURN_NEEDS="Pick the Logdash project"`;
const RESENT = 'Rename the settings button';
const GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

type Decision = Readonly<{ id: string; status: string; decidedBy: string; channel: string }>;

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function transcript(page: Page) {
	return page.getByTestId('transcript-pane');
}

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

function holdCheckpointsUntilTheBridgeStops(app: LaunchedApp): void {
	const shim = join(app.bin, 'git');
	writeFileSync(
		shim,
		`#!/bin/sh
if [ -f "$HOME/hold-checkpoints" ]; then
  case "$*" in *refs/malini/checkpoints/*)
    i=0
    while [ $i -lt 300 ] && pgrep -f '${app.bridgeScript}' >/dev/null; do sleep 0.05; i=$((i + 1)); done ;;
  esac
fi
exec '${GIT}' "$@"
`,
	);
	chmodSync(shim, 0o755);
}

function reconcilerPicks(app: LaunchedApp, choice: string): void {
	writeFileSync(join(app.home, 'malini-choice.txt'), choice);
}

function askedChoices(app: LaunchedApp): Array<Readonly<{ prompt: string; pick: number }>> {
	const log = join(app.home, 'malini-choices.jsonl');
	if (!existsSync(log)) return [];
	return readFileSync(log, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function allowOnce(page: Page, heading: string): Promise<void> {
	await sendPrompt(page, 'MALINI_TOOL');
	await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20_000 });
	await page
		.getByRole('group', { name: 'Permission decision' })
		.getByRole('button', { name: 'Allow once' })
		.last()
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Allowed once' })).not.toHaveCount(0, {
		timeout: 20_000,
	});
}

async function leadStartsChild(app: LaunchedApp): Promise<void> {
	const { page } = app;
	const api = await createSourceRepo(app.root, 'acme/api');
	await seedWorkstream(page, `file://${api}`, 'e2e-reconcile-api', 'Api work');
	await page.reload();
	const before = page.url();
	await sidebar(page).getByRole('button', { name: 'New chat', exact: true }).click();
	await expect.poll(() => page.url()).not.toBe(before);
	await expect(transcript(page)).toBeVisible({ timeout: 20_000 });
	await sendPrompt(page, `Plan it TITLE="${LEAD}"`);
	await expect(leadRow(page)).toBeVisible({ timeout: 20_000 });
	agentCalls(app, {
		tool: 'workstreams_create',
		input: { repository: 'acme/api', prompt: CHILD_PROMPT },
	});
	await allowOnce(page, 'Start a workstream in ‘acme/api’');
}

function leadRow(page: Page) {
	return sidebar(page).getByTestId('sidebar-chat').filter({ hasText: LEAD });
}

function childRow(page: Page) {
	return sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: CHILD });
}

async function decisions(page: Page): Promise<Decision[]> {
	return invoke<Decision[]>(page, 'jobs.list-decisions', undefined);
}

function wokenBy(page: Page, from: string) {
	return transcript(page)
		.getByTestId('chat-prompt-from')
		.filter({ hasText: `Prompt from ${from}` });
}

test('a lead chat hears back once a workstream it started ends a turn, and Activity and the Explorer say why', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'Wake');
		await leadStartsChild(app);

		await expect(wokenBy(page, CHILD)).toBeVisible({ timeout: 60_000 });
		await expect(
			transcript(page).getByText(/^Malini woke you: work you started moved on/u),
		).toBeVisible();
		await expect(
			transcript(page)
				.getByText(/Needs: Pick the Logdash project/u)
				.last(),
		).toBeVisible();
		const [asked] = askedChoices(app);
		expect(asked?.prompt).toContain(`Event: the chat “${CHILD}” finished a turn.`);
		expect(asked?.prompt).toContain(`Candidates:\n1. Do nothing\n2. ${WAKE}\n3. Ask you`);
		expect(asked?.pick).toBe(2);
		await captureFlow(app, 'reconciler-woken-lead');

		await openJobs(page, '#/jobs/activity');
		const row = page.getByRole('button', {
			name: `Show why Malini decided: ${WAKE}, Done`,
		});
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.click();
		await expect(
			page
				.getByRole('list', { name: 'What Malini could do' })
				.getByRole('listitem')
				.filter({ hasText: 'Picked by the model' }),
		).toContainText(WAKE);
		await captureFlow(app, 'reconciler-activity');

		await openJobs(page, '#/jobs/explorer');
		const explorer = page.getByTestId('automations-explorer');
		const map = explorer.getByRole('region', { name: 'System map' });
		await map.getByRole('button', { name: 'Choose a reaction: 1 decision' }).click();
		await explorer
			.getByRole('list', { name: 'Choose a reaction' })
			.getByRole('button', { name: new RegExp(`^${WAKE}, Api analytics, `, 'u') })
			.click();
		const chain = explorer.getByRole('list', { name: 'One chain' });
		await expect(
			chain.getByRole('button', {
				name: /^Turn finished: The analytics endpoint answers, Api analytics, /u,
			}),
		).toBeVisible();
		await expect(
			chain.getByRole('button', { name: /^Malini woke you: work you started moved on/u }),
		).toBeVisible();
		await expect(
			chain.getByRole('listitem').filter({ hasText: 'Choose a reaction woke it' }),
		).toHaveCount(1);
		await captureFlow(app, 'reconciler-explorer');
		await explorer.getByRole('button', { name: 'Show all' }).click();
		await map.getByRole('button', { name: /^Turn finished: \d+ events?$/u }).click();
		await expect(
			explorer.getByRole('list', { name: 'Turn finished' }).getByRole('button', {
				name: /^Turn finished: The analytics endpoint answers, Api analytics, /u,
			}),
		).toBeVisible();
		await map.getByRole('button', { name: /^Reconciler: \d+ events?$/u }).click();
		const reconciled = explorer.getByRole('list', { name: 'Reconciler' });
		await expect(
			reconciled.getByRole('button', {
				name: /^Turn finished: The analytics endpoint answers, Api analytics, /u,
			}),
		).toBeVisible();
		await expect(
			reconciled.getByRole('button', { name: new RegExp(`^${WAKE}, `, 'u') }),
		).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Malini asks before it acts when the model says so, and does what you pick in Activity', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'Ask you');
		await leadStartsChild(app);

		await expect
			.poll(async () => (await decisions(page)).map((decision) => decision.status), {
				timeout: 60_000,
			})
			.toEqual(['asking']);
		await expect(page.getByTestId('sidebar-jobs-needs-you-count')).toHaveText('1');
		await openJobs(page, '#/jobs/activity');
		const ask = page.getByRole('group', {
			name: `Malini asks: “${CHILD}” needs you: Pick the Logdash project`,
		});
		await expect(ask).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'reconciler-asks-you');
		await ask.getByRole('button', { name: WAKE }).click();

		await expect(ask).toHaveCount(0);
		await expect
			.poll(async () => (await decisions(page))[0], { timeout: 30_000 })
			.toMatchObject({ status: 'done', decidedBy: 'you' });
		await page.getByRole('button', { name: `Show why Malini decided: ${WAKE}, Done` }).click();
		await expect(
			page
				.getByRole('list', { name: 'What Malini could do' })
				.getByRole('listitem')
				.filter({ hasText: 'Picked by you' }),
		).toContainText(WAKE);
		await page.goBack();
		await leadRow(page).click();
		await expect(wokenBy(page, CHILD)).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a lead answers what its workstream needs with workstreams_send, into that chat, and can always allow it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await leadStartsChild(app);
		await expect(childRow(page)).toBeVisible({ timeout: 60_000 });
		await expect
			.poll(async () => (await decisions(page)).map((decision) => decision.status), {
				timeout: 60_000,
			})
			.toEqual(['done']);

		agentCalls(app, {
			tool: 'workstreams_send',
			input: { workstream: CHILD, prompt: 'Report to the acme Logdash project.' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		await expect(page.getByRole('heading', { name: `Send a prompt to ‘${CHILD}’` })).toBeVisible({
			timeout: 20_000,
		});
		await page
			.getByRole('group', { name: 'Permission decision' })
			.getByRole('button', { name: 'Always allow' })
			.last()
			.click();
		await page
			.getByRole('menu', { name: 'Always allow' })
			.getByRole('menuitem', { name: 'Allow for this chat' })
			.click();
		await expect(
			page.getByRole('status').filter({ hasText: 'Allowed for this chat' }),
		).not.toHaveCount(0, { timeout: 20_000 });

		await childRow(page).click();
		await expect(
			transcript(page).getByText('Report to the acme Logdash project.', { exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(wokenBy(page, LEAD)).toHaveCount(2);
		await captureFlow(app, 'reconciler-lead-replies');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('when the model gives no answer, Malini still wakes the lead, and Activity says its rules picked', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'FAIL');
		await leadStartsChild(app);

		await expect(wokenBy(page, CHILD)).toBeVisible({ timeout: 60_000 });
		await expect(
			transcript(page)
				.getByText(/Needs: Pick the Logdash project/u)
				.last(),
		).toBeVisible();
		expect(askedChoices(app).map(({ pick }) => pick)).toEqual([null]);
		await expect
			.poll(async () => (await decisions(page))[0], { timeout: 30_000 })
			.toMatchObject({ status: 'done', decidedBy: 'rules' });

		await openJobs(page, '#/jobs/activity');
		const row = page.getByRole('button', { name: `Show why Malini decided: ${WAKE}, Done` });
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.click();
		await expect(
			page
				.getByRole('list', { name: 'What Malini could do' })
				.getByRole('listitem')
				.filter({ hasText: "Picked by Malini's rules" }),
		).toContainText(WAKE);
		await captureFlow(app, 'reconciler-default-wake');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a turn a restart cut short goes on once the Resume rule hears Malini started, and the Explorer says why', async () => {
	test.setTimeout(240_000);
	const first = await launchMalini();
	try {
		const { page } = first;
		const source = await createSourceRepo(first.root, 'acme/resume');
		await seedWorkstream(page, `file://${source}`, 'e2e-resume-ws', 'Resume work');
		await openWorkstream(page, 'e2e-resume-ws');
		await sendPrompt(page, 'HANG until Malini restarts');
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName(
			'Stop current run',
			{ timeout: 20_000 },
		);
		await expect
			.poll(
				async () =>
					(await listEvents(page, currentSessionId(page) ?? '')).some(
						({ event }) => event.type === 'run.started',
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openWorkstream(page, 'e2e-resume-ws');
		await expect(
			transcript(page).getByText(/^Malini restarted while you were working/u),
		).toBeVisible({ timeout: 30_000 });
		await expectAssistantReply(page);

		await openJobs(page, '#/jobs/explorer');
		const explorer = page.getByTestId('automations-explorer');
		const map = explorer.getByRole('region', { name: 'System map' });
		await expect(map.getByRole('button', { name: 'Malini started: 2 events' })).toBeVisible();
		await map.getByRole('button', { name: 'Resume: 1 started' }).click();
		const resumed = explorer
			.getByRole('list', { name: 'Resume' })
			.getByRole('listitem')
			.filter({ hasText: 'Malini resumed it' });
		await expect(resumed).toHaveCount(1);
		await resumed.getByRole('button').first().click();
		await expect(
			explorer
				.getByRole('list', { name: 'One chain' })
				.getByRole('button', { name: /^HANG until Malini restarts, Resume work, /u }),
		).toBeVisible();
		await captureFlow(app, 'malini-started-resume');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Malini updating starts Check compatibility through the Compatibility rule, and the Explorer says why', async () => {
	test.setTimeout(240_000);
	const first = await launchMalini();
	try {
		const { page } = first;
		const source = await createSourceRepo(first.root, 'acme/compat');
		await seedWorkstream(page, `file://${source}`, 'e2e-compat-ws', 'Compat work');
		await invoke(page, 'app.set-setting', { key: 'app.last-seen-version', value: '0.0.1' });
		await invoke(page, 'app.set-setting', {
			key: 'app.last-seen-contract',
			value: JSON.stringify({ 'jobs:run-changed': 'type JobRunChangedEvent = unknown;' }),
		});
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		const checks = async (): Promise<JobRunRecord[]> =>
			(await invoke<JobRunRecord[]>(page, 'jobs.list-runs', undefined)).filter(
				(run) => run.title === 'Check compatibility',
			);
		await expect.poll(async () => (await checks()).length, { timeout: 30_000 }).toBe(1);
		await openJobs(page, '#/jobs/explorer');
		const explorer = page.getByTestId('automations-explorer');
		const map = explorer.getByRole('region', { name: 'System map' });
		await expect(map.getByRole('button', { name: 'Malini started: 2 events' })).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'explorer-malini-updated');

		expect((await checks())[0]).toMatchObject({
			origin: 'compatibility',
			workstreamId: 'e2e-compat-ws',
		});
		await expect(map.getByRole('button', { name: 'Malini updated: 1 event' })).toBeVisible();
		await map.getByRole('button', { name: 'Compatibility: 1 started' }).click();
		await expect(
			explorer
				.getByRole('list', { name: 'Compatibility' })
				.getByRole('listitem')
				.filter({ hasText: 'Check compatibility' })
				.filter({ hasText: 'Compatibility heard Malini updated' }),
		).toHaveCount(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

for (const cut of ['before Claude Code got it', 'before Claude replied'] as const) {
	test(`a prompt a quit cut ${cut} is sent again once the Resume rule hears Malini started`, async () => {
		test.setTimeout(240_000);
		const first = await launchMalini();
		const hold = join(
			first.home,
			cut === 'before Claude Code got it' ? 'hold-checkpoints' : 'hold-agent-runs',
		);
		try {
			const { page } = first;
			holdCheckpointsUntilTheBridgeStops(first);
			const source = await createSourceRepo(first.root, 'acme/resend');
			await seedWorkstream(page, `file://${source}`, 'e2e-resend-ws', 'Resend work');
			await openWorkstream(page, 'e2e-resend-ws');
			writeFileSync(hold, '');
			await sendPrompt(page, RESENT);
			await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName(
				'Stop current run',
				{ timeout: 20_000 },
			);
			if (cut === 'before Claude replied') {
				await expect
					.poll(
						async () =>
							(await listEvents(page, currentSessionId(page) ?? '')).some(
								({ event }) => event.type === 'run.started',
							),
						{ timeout: 20_000 },
					)
					.toBe(true);
			}
			await first.quit();
		} catch (error) {
			await first.close();
			throw error;
		}
		rmSync(hold);

		const app = await launchMalini({ profile: first.root });
		try {
			const { page } = app;
			await openWorkstream(page, 'e2e-resend-ws');
			await expectAssistantReply(page);
			await expect(
				page.getByTestId('chat-message-bubble-user').filter({ hasText: RESENT }),
			).toHaveCount(2);
			await expect(transcript(page).getByText('Run paused')).toBeVisible();
			await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
			await expect(
				transcript(page).getByText(/^Malini restarted while you were working/u),
			).toHaveCount(0);
			await captureFlow(
				app,
				cut === 'before Claude Code got it'
					? 'resume-resends-undelivered'
					: 'resume-resends-unanswered',
			);

			await openJobs(page, '#/jobs/explorer');
			const explorer = page.getByTestId('automations-explorer');
			await explorer
				.getByRole('region', { name: 'System map' })
				.getByRole('button', { name: 'Resume: 1 started' })
				.click();
			await expect(
				explorer
					.getByRole('list', { name: 'Resume' })
					.getByRole('listitem')
					.filter({ hasText: 'Malini resumed it' })
					.filter({ hasText: RESENT }),
			).toHaveCount(1);
			expectCleanConsole(app);
		} finally {
			await app.close();
		}
	});
}
