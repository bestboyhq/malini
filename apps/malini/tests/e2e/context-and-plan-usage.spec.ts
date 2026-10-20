import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const HOUR_MS = 3_600_000;

test('a plan limit past 90% shows in the composer and the panel breaks down the context window', async () => {
	test.setTimeout(120_000);
	const now = Date.now();
	const app = await launchMalini({
		env: {
			FAKE_BRIDGE_USAGE: JSON.stringify({
				contextTokens: 40_000,
				contextWindowTokens: 200_000,
				providerMetrics: {
					anthropic: {
						contextCategories: [
							{ name: 'System prompt', tokens: 4_000, kind: 'used' },
							{ name: 'Messages', tokens: 36_000, kind: 'used' },
							{ name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
						],
						rateLimits: [
							{
								label: '5-hour limit',
								utilization: 93,
								resetsAt: new Date(now + 2 * HOUR_MS).toISOString(),
							},
							{
								label: 'Weekly limit',
								utilization: 40,
								resetsAt: new Date(now + 72 * HOUR_MS).toISOString(),
							},
						],
						observedAt: new Date(now).toISOString(),
						account: 'e2e@example.com',
					},
				},
			}),
		},
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-plan-usage-ws',
			'Plan usage workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check usage');
		await expectAssistantReply(page);

		const trigger = page.getByRole('button', { name: /^View context and plan usage/u });
		await expect(trigger).toHaveAccessibleName(
			'View context and plan usage, 20% of the context window used, 5-hour limit 93% used',
		);

		await trigger.hover();
		const panel = page.getByRole('dialog', { name: 'Context and plan usage' });
		await expect(panel).toBeVisible();
		const breakdown = panel.getByRole('definition');
		await expect(panel.getByRole('term')).toHaveText([
			'Messages',
			'System prompt',
			'Autocompact buffer',
			'Free space',
		]);
		await expect(breakdown).toHaveText([
			'36K',
			'18.0%',
			'4K',
			'2.0%',
			'33K',
			'16.5%',
			'127K',
			'63.5%',
		]);
		await expect(panel.getByRole('progressbar', { name: '5-hour limit used' })).toHaveAttribute(
			'aria-valuenow',
			'93',
		);
		await expect(panel.getByRole('progressbar', { name: 'Weekly limit used' })).toHaveAttribute(
			'aria-valuenow',
			'40',
		);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
