import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
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

type PageInput =
	| {
			type: 'mouseMove' | 'mouseDown' | 'mouseUp';
			x: number;
			y: number;
			button?: 'left';
			clickCount?: number;
	  }
	| { type: 'char' | 'keyDown' | 'keyUp'; keyCode: string };

interface WebPage {
	inPage(code: string): Promise<unknown>;
	input(events: readonly PageInput[]): Promise<void>;
	clickAt(element: string): Promise<void>;
}

const PINS = `document.querySelector('malini-pins')?.shadowRoot`;

function webPage(electronApp: ElectronApplication, origin: string): WebPage {
	const inPage = (code: string): Promise<unknown> =>
		electronApp.evaluate(
			({ webContents }, { code, origin }) =>
				webContents
					.getAllWebContents()
					.find((contents) => contents.getURL().startsWith(origin))
					?.executeJavaScript(code),
			{ code, origin },
		);
	const input = (events: readonly PageInput[]): Promise<void> =>
		electronApp.evaluate(
			async ({ webContents }, { events, origin }) => {
				const contents = webContents
					.getAllWebContents()
					.find((candidate) => candidate.getURL().startsWith(origin));
				if (!contents) throw new Error(`no page at ${origin}`);
				for (const event of events) {
					contents.sendInputEvent(event);
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
			},
			{ events, origin },
		);
	const clickAt = async (element: string): Promise<void> => {
		const point = (await inPage(`(() => {
			const box = (${element}).getBoundingClientRect();
			return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
		})()`)) as { x: number; y: number };
		await input([
			{ type: 'mouseMove', ...point },
			{ type: 'mouseDown', ...point, button: 'left', clickCount: 1 },
			{ type: 'mouseUp', ...point, button: 'left', clickCount: 1 },
		]);
	};
	return { inPage, input, clickAt };
}

async function askAboutElement(
	page: Page,
	web: WebPage,
	selector: string,
	prompt: string,
): Promise<void> {
	await expect.poll(() => web.inPage('document.readyState')).toBe('complete');
	const pick = page.getByRole('button', { name: 'Pick an element', exact: true });
	await expect(pick).toBeEnabled();
	await pick.click();
	await expect(pick).toHaveAttribute('aria-pressed', 'true');
	await expect
		.poll(() => web.inPage(`Boolean(document.querySelector('malini-picker'))`))
		.toBe(true);
	await web.clickAt(`document.querySelector(${JSON.stringify(selector)})`);
	await expect
		.poll(() =>
			web.inPage(
				`document.querySelector('malini-picker').shadowRoot.activeElement?.getAttribute('aria-label')`,
			),
		)
		.toBe('Prompt');
	await web.input([...prompt].map((keyCode) => ({ type: 'char' as const, keyCode })));
	await web.input([
		{ type: 'keyDown', keyCode: 'Enter' },
		{ type: 'char', keyCode: '\r' },
		{ type: 'keyUp', keyCode: 'Enter' },
	]);
	await expect
		.poll(() => web.inPage(`${PINS}?.querySelector('button.pin')?.getAttribute('aria-label')`), {
			timeout: 30_000,
		})
		.toBe(`Thread: ${prompt} · Done`);
}

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
		await expect(page.getByRole('button', { name: 'Close Files', exact: true })).toHaveCount(1);
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

test('a browser tab says why its page did not load, hides the page meanwhile, and shows it once a reload reaches the server', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Late server</title><h1>Up</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const pageShown = () =>
			electronApp.evaluate(({ BrowserWindow }) =>
				(BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).some((view) =>
					view.getVisible(),
				),
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-failed-ws',
			'Browser failed',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/');
		const status = inspector.getByRole('status');
		await expect(status).toContainText(`Could not open ${new URL(origin).host}`);
		await expect(status).toContainText('ERR_CONNECTION_REFUSED');
		await expect.poll(pageShown).toBe(false);
		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeDisabled();

		await new Promise<void>((resolve) =>
			server.listen(Number(new URL(origin).port), 'localhost', resolve),
		);
		await page.getByRole('button', { name: 'Reload' }).click();
		await expect(inspector.getByRole('tab', { name: 'Late server' })).toBeVisible();
		await expect(status).toHaveCount(0);
		await expect.poll(pageShown).toBe(true);
		await expect(pick).toBeEnabled();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a browser tab opens files of its worktree, shows their latest edit on reload, and follows their links without a server', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-file-ws', 'Browser file');
		mkdirSync(join(seeded.worktree, 'docs'), { recursive: true });
		writeFileSync(
			join(seeded.worktree, 'docs', 'report.html'),
			'<!doctype html><script src="title.js"></script><a href="next.html">Next</a>',
		);
		writeFileSync(join(seeded.worktree, 'docs', 'title.js'), 'document.title = "Report";');
		writeFileSync(join(seeded.worktree, 'docs', 'next.html'), '<!doctype html><title>Next</title>');
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, '', './docs/report.html');
		await expect(inspector.getByRole('tab', { name: 'Report', exact: true })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Page address' }).last()).toHaveValue(
			'./docs/report.html',
		);

		writeFileSync(join(seeded.worktree, 'docs', 'title.js'), 'document.title = "Report edited";');
		await electronApp.evaluate(({ webContents }) => {
			webContents
				.getAllWebContents()
				.find((contents) => contents.getTitle() === 'Report')
				?.reload();
		});
		await expect(inspector.getByRole('tab', { name: 'Report edited', exact: true })).toBeVisible();

		await electronApp.evaluate(async ({ webContents }) => {
			const report = webContents
				.getAllWebContents()
				.find((contents) => contents.getTitle() === 'Report edited');
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

test('a picked element starts its own thread, pinned where you asked, that opens as its own tab and leaves the main chat alone', async () => {
	test.setTimeout(180_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			'<!doctype html><title>Pricing</title><main style="padding:80px"><h1>Pricing</h1><p>Plans for every team.</p></main>',
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const web = webPage(electronApp, origin);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-thread-ws',
			'Browser thread',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await sendPrompt(page, 'Hello main chat');
		await expectAssistantReply(page);
		const chatTabs = page.getByTestId('chat-agent-tab');
		await expect(chatTabs).toHaveCount(1);

		await openTab(page, origin, '/pricing');
		await expect(inspector.getByRole('tab', { name: 'Pricing', selected: true })).toBeVisible();
		await askAboutElement(page, web, 'h1', 'Make the title bigger');
		await expect(page.getByRole('button', { name: 'Pick an element' })).toHaveAttribute(
			'aria-pressed',
			'false',
		);
		await expect(chatTabs).toHaveCount(1);
		await expect(page.getByText('Make the title bigger')).toHaveCount(0);

		await web.clickAt(`${PINS}.querySelector('button.pin')`);
		await expect
			.poll(() => web.inPage(`${PINS}.querySelector('[role="dialog"]').hidden`))
			.toBe(false);
		await web.clickAt(
			`Array.from(${PINS}.querySelectorAll('button')).find((button) => button.textContent === 'Open chat')`,
		);
		await expect(chatTabs).toHaveCount(2);
		await expect(page.getByText('Make the title bigger').first()).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'browser-thread-opened');

		await page.locator('[data-testid="chat-agent-tab"][aria-selected="false"]').click();
		await expect(page.getByText('Hello main chat').first()).toBeVisible();
		await expect(page.getByText('Make the title bigger')).toHaveCount(0);
		await expect(chatTabs).toHaveCount(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a thread pin stays on its element when a Vite dev server hot-updates the page, changes its classes, or reloads it', async () => {
	test.setTimeout(180_000);
	const site = realpathSync(mkdtempSync(join(tmpdir(), 'malini-hmr-site-')));
	const writeIndex = (title: string): void =>
		writeFileSync(
			join(site, 'index.html'),
			`<!doctype html><title>${title}</title><style>main { padding: 80px; } h1 { display: inline-block; margin: 0; font: 700 36px system-ui; } h1.text-6xl { font-size: 60px; }</style><main><div id="app"></div></main><script type="module" src="/main.js"></script>`,
		);
	const writeApp = (size: string, line: string): void =>
		writeFileSync(
			join(site, 'main.js'),
			`document.querySelector('#app').innerHTML = '<h1 class="${size} font-bold">Pricing</h1><p>${line}</p>';\nimport.meta.hot?.accept();\n`,
		);
	writeIndex('Pricing');
	writeApp('text-4xl', 'Plans for every team.');
	const vite = await createViteServer({
		configFile: false,
		root: site,
		logLevel: 'error',
		server: { host: 'localhost', port: 0 },
	});
	await vite.listen();
	const origin = (vite.resolvedUrls?.local[0] ?? '').replace(/\/$/u, '');
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const web = webPage(electronApp, origin);
		const pinOnHeading = () =>
			web.inPage(`(() => {
				const pin = ${PINS}?.querySelector('button.pin');
				const heading = document.querySelector('h1')?.getClientRects()[0];
				if (!pin || pin.hidden || !heading) return false;
				const box = pin.getBoundingClientRect();
				return Math.abs(box.left + box.width / 2 - heading.right) <= box.width
					&& Math.abs(box.top + box.height / 2 - heading.top) <= box.height;
			})()`);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-hmr-ws',
			'Browser hot reload',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await openTab(page, origin, '/');
		await expect(inspector.getByRole('tab', { name: 'Pricing', selected: true })).toBeVisible();
		await askAboutElement(page, web, 'h1', 'Make the title bigger');
		await expect.poll(pinOnHeading).toBe(true);
		await web.inPage('window.stillThisDocument = true');

		writeApp('text-4xl', 'Plans for every team, billed yearly.');
		await expect
			.poll(() => web.inPage(`document.querySelector('p')?.textContent`))
			.toBe('Plans for every team, billed yearly.');
		expect(await web.inPage('window.stillThisDocument')).toBe(true);
		await expect.poll(pinOnHeading).toBe(true);

		writeApp('text-6xl', 'Plans for every team, billed yearly.');
		await expect
			.poll(() => web.inPage(`document.querySelector('h1')?.className`))
			.toBe('text-6xl font-bold');
		expect(await web.inPage('window.stillThisDocument')).toBe(true);
		await expect.poll(pinOnHeading).toBe(true);

		writeIndex('Pricing plans');
		await expect(
			inspector.getByRole('tab', { name: 'Pricing plans', selected: true }),
		).toBeVisible();
		expect(await web.inPage('window.stillThisDocument')).toBeUndefined();
		await expect.poll(pinOnHeading).toBe(true);
		await captureFlow(app, 'browser-thread-pin-after-reload');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await vite.close();
		rmSync(site, { recursive: true, force: true });
	}
});

test('picking an element on a page that is still loading waits for the page instead of failing', async () => {
	test.setTimeout(120_000);
	let respond = (): void => undefined;
	const responding = new Promise<void>((resolve) => {
		respond = resolve;
	});
	const server = createServer(async (_request, response) => {
		await responding;
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Late page</title><h1>Late page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const pickerShown = () =>
			electronApp.evaluate(
				({ webContents }, origin) =>
					webContents
						.getAllWebContents()
						.find((contents) => contents.getURL().startsWith(origin))
						?.executeJavaScript(`Boolean(document.querySelector('malini-picker'))`) ?? false,
				origin,
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-late-pick-ws',
			'Browser late pick',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/late');
		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeEnabled();
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		respond();

		await expect(inspector.getByRole('tab', { name: 'Late page', selected: true })).toBeVisible();
		await expect.poll(pickerShown).toBe(true);
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(pickerShown).toBe(false);
		expectCleanConsole(app);
	} finally {
		respond();
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

test('the agent resizes the browser tab you see by moving the divider, stops where the chat or the inspector keeps its width, and leaves a tab you do not see alone', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			'<!doctype html><title>Width</title><script>const name = () => (document.title = `Width ${innerWidth}`); addEventListener("resize", name); name();</script>',
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.setContentSize(1_600, 800),
		);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-resize-ws',
			'Browser resize',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await sendPrompt(page, `Open the ruler BROWSER_OPEN:${origin}/ruler`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: /^Width \d+$/u, selected: true })).toBeVisible({
			timeout: 20_000,
		});
		const split = page.getByRole('separator', { name: 'Resize workstream-transcript' });

		await sendPrompt(page, 'As narrow as it gets BROWSER_RESIZE:200');
		await expect(page.getByText(/the narrowest the inspector gets/u)).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'browser-resize-before');

		await sendPrompt(page, 'As wide as it gets BROWSER_RESIZE:5000');
		await expect(page.getByText(/allows while the chat keeps its minimum width/u)).toBeVisible({
			timeout: 20_000,
		});
		await expect(split).toHaveAttribute('aria-valuenow', '400');
		await captureFlow(app, 'browser-resize-after');

		await sendPrompt(page, 'Make it 700 wide BROWSER_RESIZE:700');
		await expect(page.getByText('The page is now 700px wide.')).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab', { name: 'Width 700', selected: true })).toBeVisible();
		const resized = await split.getAttribute('aria-valuenow');

		await inspector.getByRole('tab', { name: 'Files' }).click();
		await sendPrompt(page, 'Back to the widest BROWSER_RESIZE:5000');
		await expect(
			page.getByText(/The browser tab is not on screen, so its width did not change/u),
		).toBeVisible({ timeout: 20_000 });
		await expect(split).toHaveAttribute('aria-valuenow', resized ?? '');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
