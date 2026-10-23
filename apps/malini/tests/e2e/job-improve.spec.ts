import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openJobs,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

type JobRow = Readonly<{ name: string; model: string; builtin: string | null }>;

async function nameAChat(page: Page, source: string, slug: string, prompt: string): Promise<void> {
	const { workstreamId } = await seedWorkstream(page, source, slug, slug);
	await openWorkstream(page, workstreamId);
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	await expect(
		page.getByTestId('chat-agent-tabs').getByRole('tab', { name: /Investigating failed deploy/u }),
	).toBeVisible({ timeout: 20_000 });
}

test('Name chats keeps every name, scores it against its rules, and an experiment replays its runs until you use the better setup', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({
		env: {
			FAKE_BRIDGE_TITLE: 'Investigating failed deploy',
			FAKE_BRIDGE_TITLES_BY_MODEL: JSON.stringify({ sonnet: 'Deploy failure' }),
		},
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await nameAChat(page, source, 'e2e-improve-a', 'we merged the site but it never deployed');
		await nameAChat(page, source, 'e2e-improve-b', 'the deploy failed again after the merge');

		await openJobs(page);
		await page.getByRole('link', { name: 'Name chats', exact: true }).click();
		const lastWeeks = page.getByRole('region', { name: 'Last 2 weeks' });
		await expect(lastWeeks).toContainText('names in 2 weeks');
		await expect(lastWeeks).toContainText('broke a rule');
		const broke = page.getByRole('region', { name: 'Names that broke a rule this week' });
		await expect(broke.getByRole('listitem')).toHaveCount(2);
		await expect(broke.getByRole('listitem').first()).toContainText('Starts with a verb');
		await expect(lastWeeks.getByRole('img')).toHaveAccessibleName(
			'2 names in the last 2 weeks, 2 broke a rule',
		);

		await page.getByRole('link', { name: 'Improve' }).click();
		await expect(page).toHaveURL(/#\/jobs\/[^/]+\/improve$/u);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Improve Name chats');
		const experiments = page.getByRole('list', { name: 'Experiments' });
		const today = experiments.getByRole('article', { name: 'Today' });
		await expect(today).toContainText('Not run yet');
		await today.getByRole('button', { name: 'Run Today again' }).click();
		await expect(today).toContainText('2 of 2 broke a rule', { timeout: 20_000 });

		await page.getByRole('button', { name: 'New experiment' }).click();
		const first = experiments.getByRole('article', { name: 'Experiment 1' });
		await expect(first.getByRole('button', { name: 'Show Experiment 1' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		const setup = page.getByRole('region', { name: 'Experiment 1 setup' });
		await setup.getByRole('combobox', { name: 'Model' }).selectOption({ label: 'Sonnet' });
		await expect(first).toContainText('Sonnet');
		await setup.getByRole('button', { name: /^Run on 2 runs/u }).click();
		await expect(first).toContainText('0 of 2 broke a rule', { timeout: 20_000 });
		const results = page.getByRole('region', { name: 'Results on its last 2 runs' });
		await expect(results.getByRole('table')).toContainText('Deploy failure');
		await expect(
			results.getByRole('img', { name: 'Breaks a rule: Starts with a verb' }),
		).toHaveCount(2);

		await page.getByRole('button', { name: 'New experiment' }).click();
		const second = experiments.getByRole('article', { name: 'Experiment 2' });
		await expect(second).toBeVisible();
		await second.getByRole('button', { name: 'Delete Experiment 2' }).click();
		await expect(second).toHaveCount(0);
		await expect(today.getByRole('button', { name: 'Delete Today' })).toHaveCount(0);

		await first.getByRole('button', { name: 'Show Experiment 1' }).click();
		await captureFlow(app, 'job-improve-experiments');
		await page.getByRole('button', { name: 'Use Experiment 1' }).click();
		await expect(page).toHaveURL(/#\/jobs\/[^/]+$/u);
		await expect
			.poll(
				async () =>
					(await invoke<JobRow[]>(page, 'jobs.list-definitions', undefined)).find(
						({ builtin }) => builtin === 'name-chats',
					)?.model,
			)
			.toBe('sonnet');
		await expect(lastWeeks).toContainText('Applied today · expected 100% to follow every rule');
		await captureFlow(app, 'job-improve-applied');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
