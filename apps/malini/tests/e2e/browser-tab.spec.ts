import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	settleAnimations,
} from './harness';

async function openTab(page: Page, origin: string, path: string): Promise<void> {
	await page.getByRole('button', { name: 'Open inspector panel' }).click();
	await page.getByRole('menuitem', { name: 'New browser tab' }).click();
	const address = page.getByRole('textbox', { name: 'Page address' }).last();
	await address.fill(`${origin}${path}`);
	await address.press('Enter');
}

test('browser tabs show only once opened, each with its own page and close button, keep the inspector width on every tab, and closing one closes only its page', async () => {
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

		const split = page.getByRole('separator', { name: 'Resize workstream-transcript' });
		const browserWidth = await split.getAttribute('aria-valuenow');
		await inspector.getByRole('tab', { name: 'Files' }).click();
		await expect(inspector.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
		await expect(split).toHaveAttribute('aria-valuenow', browserWidth ?? '');
		await expect(page.getByRole('button', { name: 'Close Files', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Close Lobby music', exact: true })).toHaveCount(
			1,
		);

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

test('a new browser tab takes the cursor and explains itself, keeps its page under the menus, picks only while pressed, and reopens its page after a restart', async () => {
	test.setTimeout(180_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Admin</title><button>Save</button>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const first = await launchMalini();
	let workstreamId = '';
	try {
		const { page, electronApp } = first;
		const pageShown = () =>
			electronApp.evaluate(({ BrowserWindow }) =>
				(BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).some((view) =>
					view.getVisible(),
				),
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(first.root),
			'e2e-browser-restart-ws',
			'Browser restart',
		);
		workstreamId = seeded.workstreamId;
		await openWorkstream(page, workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'New browser tab' }).click();
		const address = page.getByRole('textbox', { name: 'Page address' });
		await expect(address).toBeFocused();
		await expect(inspector.getByText('Open a page')).toBeVisible();
		await expect(
			inspector.getByText('Type a URL above, or ask the agent to open your dev server.'),
		).toBeVisible();

		await address.fill(`${origin}/admin`);
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Admin', selected: true })).toBeVisible();
		await expect(inspector.getByText('Open a page')).toHaveCount(0);
		await expect.poll(pageShown).toBe(true);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await expect(page.getByRole('menuitem', { name: 'New browser tab' })).toBeVisible();
		await expect.poll(pageShown).toBe(false);
		await settleAnimations(page);
		const menuHeading = page
			.getByTestId('extension-inspector-panel-picker')
			.getByText('Open panel');
		expect(
			await menuHeading.evaluate((heading) => {
				const box = heading.getBoundingClientRect();
				const hit = heading.ownerDocument.elementFromPoint(
					box.x + box.width / 2,
					box.y + box.height / 2,
				);
				return (
					hit !== null &&
					heading.contains(hit) &&
					heading.closest('[role="menu"]')?.getAnimations().length === 0
				);
			}),
		).toBe(true);
		await captureFlow(first, 'browser-tab-still-under-menu');
		await page.keyboard.press('Escape');
		await expect.poll(pageShown).toBe(true);

		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeEnabled();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		server.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await inspector.getByRole('tab', { name: 'Admin' }).click();
		await expect(page.getByRole('textbox', { name: 'Page address' })).toHaveValue(
			`${origin.replace('http://', '')}/admin`,
		);
		await expect(inspector.getByText('Open a page')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a page the agent opens shows up as its own tab, named by its title, without taking the cursor', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Lobby music</title><h1>Lobby music</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-agent-ws',
			'Browser agent',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab')).toHaveCount(1);

		await sendPrompt(page, `Open the lobby BROWSER_OPEN:${origin}/lobby`);
		await expectAssistantReply(page);

		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Files', selected: false })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Page address' })).not.toBeFocused();
		await captureFlow(app, 'browser-tab-agent-opened');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
