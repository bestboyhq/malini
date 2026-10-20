import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const SHORT_NAME = 'Short name';
const LONG_NAME =
	'Rework the onboarding flow so a first clone lands on a ready workstream with its checks green';

async function hoverName(page: Page, name: string): Promise<void> {
	await page.mouse.move(0, 0);
	await page.getByTestId('sidebar-workstream').filter({ hasText: name }).getByText(name).hover();
}

test('a sidebar name shows its full text in a tooltip only when the row cuts it off', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-short-name-ws', SHORT_NAME);
		await seedWorkstream(page, source, 'e2e-long-name-ws', LONG_NAME);
		await openWorkstream(page, workstreamId);
		const tooltip = page.getByRole('tooltip');

		await hoverName(page, LONG_NAME);
		await expect(tooltip).toHaveText(LONG_NAME);
		await captureFlow(app, 'sidebar-truncated-name-tooltip');

		await hoverName(page, SHORT_NAME);
		await page.waitForTimeout(1_000);
		await expect(tooltip).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
