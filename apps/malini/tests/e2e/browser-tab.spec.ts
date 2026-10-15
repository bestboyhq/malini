import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

async function openTab(page: Page, origin: string, path: string): Promise<void> {
	await page.getByRole('button', { name: 'Open inspector panel' }).click();
	await page.getByRole('menuitem', { name: 'New browser tab' }).click();
	const address = page.getByRole('textbox', { name: 'Page address' }).last();
	await address.fill(`${origin}${path}`);
	await address.press('Enter');
}

test('browser tabs show only once opened, each with its own page, and closing one closes only its page', async () => {
	test.setTimeout(120_000);
	const server = createServer((request, response) => {
		const title = request.url === '/music' ? 'Lobby music' : 'Served page';
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const webPages = () =>
			electronApp.evaluate(({ webContents }) =>
				webContents
					.getAllWebContents()
					.map((contents) => contents.getURL())
					.filter((url) => url.startsWith('http'))
					.sort(),
			);
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-tab-ws', 'Browser tab');
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab')).toHaveCount(1);

		await openTab(page, origin, '/');
		await expect(inspector.getByRole('tab', { name: 'Served page' })).toBeVisible();
		await openTab(page, origin, '/music');
		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible();
		await expect.poll(webPages).toEqual([`${origin}/`, `${origin}/music`]);

		await inspector.getByRole('tab', { name: 'Served page' }).hover();
		await page.getByRole('button', { name: 'Close Served page', exact: true }).click();
		await expect(inspector.getByRole('tab', { name: 'Served page' })).toHaveCount(0);
		await expect.poll(webPages).toEqual([`${origin}/music`]);
		await expect(inspector.getByRole('tab', { name: 'Lobby music' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a browser tab opens files of its worktree and follows their links without a server', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-file-ws', 'Browser file');
		mkdirSync(join(seeded.worktree, 'docs'), { recursive: true });
		writeFileSync(
			join(seeded.worktree, 'docs', 'report.html'),
			'<!doctype html><title>Report</title><a href="next.html">Next</a>',
		);
		writeFileSync(join(seeded.worktree, 'docs', 'next.html'), '<!doctype html><title>Next</title>');
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, '', './docs/report.html');
		await expect(inspector.getByRole('tab', { name: 'Report', exact: true })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Page address' }).last()).toHaveValue(
			'./docs/report.html',
		);

		await electronApp.evaluate(async ({ webContents }) => {
			const report = webContents
				.getAllWebContents()
				.find((contents) => contents.getTitle() === 'Report');
			await report?.executeJavaScript('document.querySelector("a").click()');
		});
		await expect(inspector.getByRole('tab', { name: 'Next', exact: true })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
