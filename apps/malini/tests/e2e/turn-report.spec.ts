import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const OUTCOME = 'The header stays pinned while the page scrolls.';

test('a turn that ends with a report shows it as a result card that asks the user, then stops asking once they move on', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-turn-report-ws',
			'Turn report',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'CHAT_TURN_REPORT');
		const card = page.getByRole('article', { name: 'Turn result' });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card.getByRole('img', { name: 'Waiting on you' })).toBeVisible();
		await expect(card.getByTestId('turn-report-outcome')).toHaveText(OUTCOME);
		await expect(card.getByText('Your turn')).toBeVisible();
		await expect(card.getByRole('listitem')).toHaveText([
			'Approve the new shadow',
			'Merge the pull request',
		]);
		const lead = card.getByTestId('turn-report-lead');
		await expect(lead).toContainText('checked at 320 px and 1440 px.');
		await expect(card.getByTestId('turn-report-notes')).toBeHidden();
		await lead.click();
		await expect(card.getByTestId('turn-report-notes')).toContainText(
			'the header is position: sticky.',
		);
		await captureFlow(app, 'turn-report-card');

		await sendPrompt(page, 'CHAT_TURN_REPORT again');
		await expect(card).toHaveCount(2, { timeout: 30_000 });
		const first = card.first();
		await expect(first.getByRole('img', { name: 'Done' })).toBeVisible();
		await expect(first.getByText('You were asked')).toBeVisible();
		await expect(first.getByText('Your turn')).toHaveCount(0);
		const earlier = card.last().getByRole('list', { name: 'Earlier turns' });
		await expect(earlier).toContainText(OUTCOME);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
