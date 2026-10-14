import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('the Browser tab shows only once opened, and closing it closes its page', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Served page</title><h1>Served page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const webPages = () =>
			electronApp.evaluate(({ webContents }) =>
				webContents
					.getAllWebContents()
					.map((contents) => contents.getURL())
					.filter((url) => url.startsWith('http')),
			);
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-tab-ws', 'Browser tab');
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab', { name: 'Browser' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Open Browser' }).click();
		const address = page.getByRole('textbox', { name: 'Page address' });
		await address.fill(origin);
		await address.press('Enter');
		await expect.poll(webPages).toEqual([`${origin}/`]);

		await page.getByRole('button', { name: 'Close Browser', exact: true }).click();
		await expect(inspector.getByRole('tab', { name: 'Browser' })).toHaveCount(0);
		await expect.poll(webPages).toEqual([]);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Open Browser' }).click();
		await expect(inspector.getByText('Open a page')).toBeVisible();
		expect(await webPages()).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
