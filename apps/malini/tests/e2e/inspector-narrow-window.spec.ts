import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('in a window too narrow for the side-by-side inspector, hiding it gives the chat the whole height', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-inspector-narrow-ws',
			'Narrow inspector workstream',
		);
		await openWorkstream(page, workstreamId);
		await electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.setContentSize(900, 800),
		);
		const chatBottom = async (): Promise<number> => {
			const box = await page.getByTestId('transcript-pane').boundingBox();
			return box ? Math.round(box.y + box.height) : 0;
		};
		const gapBelowChat = async (): Promise<number> => {
			const [, contentHeight = 0] = await electronApp.evaluate(
				({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [],
			);
			return contentHeight - (await chatBottom());
		};
		await expect.poll(chatBottom).toBeLessThan(600);

		await page.getByRole('button', { name: 'Hide inspector' }).click();

		await expect(page.getByRole('button', { name: 'Show inspector' })).toBeVisible();
		await expect.poll(gapBelowChat).toBe(0);
		await captureFlow(app, 'inspector-hidden-narrow-window');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
