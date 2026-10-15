import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

test('the sidebar reads out what malini uses and opens stats on its runs, tabs and memory', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Served page</title><h1>Served page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-stats-ws', 'Stats');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Count this run');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'New browser tab' }).click();
		const address = page.getByRole('textbox', { name: 'Page address' }).last();
		await address.fill(`${origin}/`);
		await address.press('Enter');

		const readout = page.getByRole('button', { name: /^Stats: \d+(\.\d)? (MB|GB) · \S+% CPU$/u });
		await expect(readout).toBeVisible({ timeout: 20_000 });
		await readout.click();

		const stats = page.getByRole('dialog', { name: 'Stats' });
		const rightNow = stats.getByRole('region', { name: 'Right now' });
		await expect(rightNow.getByRole('listitem').filter({ hasText: 'malini' })).toBeVisible();
		await expect(rightNow.getByRole('listitem').filter({ hasText: 'Browser tabs' })).toBeVisible({
			timeout: 20_000,
		});

		const activity = stats.getByRole('region', { name: 'Activity' });
		await expect(activity.getByText('agent runs')).toBeVisible();
		await expect(
			activity.getByRole('img', { name: 'Runs per day: 1 day in the last 6 months' }),
		).toBeVisible();
		await expect(
			activity.getByRole('list', { name: 'Runs by repository' }).getByRole('listitem'),
		).toHaveText([/1$/u]);
		await expect(activity.getByRole('list', { name: 'Activity at a glance' })).toContainText(
			'1 run',
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
